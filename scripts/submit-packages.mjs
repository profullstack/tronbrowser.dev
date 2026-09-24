#!/usr/bin/env node
// Refresh package-manager manifests for a release and (optionally) submit them.
// Mirrors pairux.com's scripts/submit-packages.ts approach, kept in this monorepo.
//
// Usage:
//   node scripts/submit-packages.mjs -v 0.1.0 -p homebrew -p aur [--dry-run]
//   node scripts/submit-packages.mjs -v 0.1.0 -p all --dry-run
//
// It fetches the GitHub release asset checksums and rewrites version + sha256 in
// the checked-in manifests under distribution/. Actual submission (push to a tap
// repo / scoop bucket / AUR / winget-pkgs PR / choco push) is gated on the
// relevant secret being present and is intentionally a no-op without it.
//
// 2026-09-24: "submission is gated on the secret" described an intention, not
// code. There was no submit path at all — no push, no PR, no upload — so every
// run only rewrote files under distribution/ and exited. Channels that we own
// outright (a tap, a bucket, AUR, Chocolatey, Snap) now really do publish; the
// ones that are a pull request into somebody else's monorepo (winget, flathub,
// nixpkgs, gentoo, freebsd) still cannot be automated end to end and say so
// rather than reporting success.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.TRONBROWSER_REPO || "profullstack/tronbrowser.dev";
const ALL = [
  "homebrew",
  "scoop",
  "winget",
  "aur",
  "apt",
  "rpm",
  "gentoo",
  "nix",
  "chocolatey",
  "snap",
  "flatpak",
  "appimage",
  "freebsd",
];

const args = process.argv.slice(2);
let version = "";
let dryRun = false;
const pms = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-v") version = (args[++i] || "").replace(/^v/, "");
  else if (args[i] === "-p") pms.push(args[++i]);
  else if (args[i] === "--dry-run") dryRun = true;
}
if (!version) {
  console.error("usage: submit-packages.mjs -v <version> -p <pm> [--dry-run]");
  process.exit(1);
}
const targets = pms.includes("all") || pms.length === 0 ? ALL : pms;

const ASSET = {
  linux: `tronbrowser-linux-x64.tar.gz`,
  macos: `tronbrowser-macos.zip`,
  windows: `tronbrowser-win-x64.zip`,
};

async function sha256(asset) {
  const url = `https://github.com/${REPO}/releases/download/v${version}/${asset}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return createHash("sha256").update(buf).digest("hex");
}

function patch(file, replacers) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return console.log(`  skip (missing): ${file}`);
  let s = readFileSync(path, "utf8");
  for (const [re, val] of replacers) s = s.replace(re, val);
  if (dryRun) console.log(`  [dry-run] would update ${file}`);
  else {
    writeFileSync(path, s);
    console.log(`  updated ${file}`);
  }
}

const sums = {};
for (const [k, a] of Object.entries(ASSET)) sums[k] = await sha256(a);

for (const pm of targets) {
  console.log(`\n== ${pm} ==`);
  switch (pm) {
    case "homebrew":
      patch("distribution/homebrew/tronbrowser.rb", [
        [/version "[^"]+"/, `version "${version}"`],
        [
          /download\/v[^/]+\/tronbrowser-macos\.zip/g,
          `download/v${version}/tronbrowser-macos.zip`,
        ],
        [
          /download\/v[^/]+\/tronbrowser-linux-x64\.tar\.gz/g,
          `download/v${version}/tronbrowser-linux-x64.tar.gz`,
        ],
        ...(sums.macos
          ? [
              [
                /sha256 "[0-9a-f]{64}"\n{2} {2}on_linux/,
                `sha256 "${sums.macos}"\n\n  on_linux`,
              ],
            ]
          : []),
        ...(sums.linux
          ? [
              [
                /sha256 "[0-9a-f]{64}"\n {2}end\n{2} {2}def/,
                `sha256 "${sums.linux}"\n  end\n\n  def`,
              ],
            ]
          : []),
      ]);
      break;
    case "aur":
      patch("distribution/aur/PKGBUILD", [
        [/pkgver=[^\n]+/, `pkgver=${version}`],
        ...(sums.linux
          ? [[/sha256sums=\('[0-9a-f]{64}'\)/, `sha256sums=('${sums.linux}')`]]
          : []),
      ]);
      break;
    case "nix":
      patch("distribution/nix/tronbrowser.nix", [
        [/version = "[^"]+"/, `version = "${version}"`],
        ...(sums.linux
          ? [[/sha256 = "[0-9a-f]{64}"/, `sha256 = "${sums.linux}"`]]
          : []),
      ]);
      break;
    case "gentoo":
      console.log(
        `  rename distribution/gentoo/tronbrowser-bin-${version}.ebuild and bump SRC_URI (uses \${PV})`,
      );
      break;
    case "scoop":
      patch("distribution/scoop/tronbrowser.json", [
        [/"version": "[^"]+"/, `"version": "${version}"`],
        [
          /download\/v[^/]+\/tronbrowser-win-x64\.zip/g,
          `download/v${version}/tronbrowser-win-x64.zip`,
        ],
        ...(sums.windows
          ? [[/"hash": "[^"]+"/, `"hash": "${sums.windows}"`]]
          : []),
      ]);
      break;
    case "winget":
      patch("distribution/winget/Profullstack.TronBrowser.installer.yaml", [
        [/PackageVersion: .*/, `PackageVersion: ${version}`],
        [
          /download\/v[^/]+\/tronbrowser-win-x64\.zip/g,
          `download/v${version}/tronbrowser-win-x64.zip`,
        ],
        ...(sums.windows
          ? [
              [
                /InstallerSha256: .*/,
                `InstallerSha256: ${sums.windows.toUpperCase()}`,
              ],
            ]
          : []),
      ]);
      break;
    case "chocolatey":
      patch("distribution/chocolatey/tronbrowser.nuspec", [
        [/<version>[^<]+<\/version>/, `<version>${version}</version>`],
      ]);
      patch("distribution/chocolatey/tools/chocolateyinstall.ps1", [
        [
          /download\/v[^/]+\/tronbrowser-win-x64\.zip/g,
          `download/v${version}/tronbrowser-win-x64.zip`,
        ],
        ...(sums.windows
          ? [[/checksum64\s+= '[^']+'/, `checksum64     = '${sums.windows}'`]]
          : []),
      ]);
      break;
    case "snap":
      patch("distribution/snap/snapcraft.yaml", [
        [/version: '[^']+'/, `version: '${version}'`],
        [
          /download\/v[^/]+\/tronbrowser-linux-x64\.tar\.gz/g,
          `download/v${version}/tronbrowser-linux-x64.tar.gz`,
        ],
      ]);
      break;
    case "flatpak":
      patch("distribution/flatpak/dev.tronbrowser.TronBrowser.yml", [
        [
          /download\/v[^/]+\/tronbrowser-linux-x64\.tar\.gz/g,
          `download/v${version}/tronbrowser-linux-x64.tar.gz`,
        ],
        ...(sums.linux
          ? [
              [
                /sha256: (__SHA256_LINUX__|[0-9a-f]{64})/,
                `sha256: ${sums.linux}`,
              ],
            ]
          : []),
      ]);
      break;
    case "freebsd":
      patch("distribution/freebsd/Makefile", [
        [/DISTVERSION=\t[^\n]+/, `DISTVERSION=\t${version}`],
      ]);
      break;
    case "apt":
    case "rpm":
      console.log(
        `  built by distribution/deb-rpm/build.sh (nfpm) during release; nothing to template`,
      );
      break;
    case "appimage":
      console.log(
        `  built by distribution/appimage/build.sh during release; attached to the GitHub release`,
      );
      break;
    default:
      console.log(`  unknown package manager: ${pm}`);
  }
}

// ---------------------------------------------------------------------------
// Submission.
//
// Everything above only rewrites files. What follows actually ships them.
// Each channel is gated on its own secret: absent, it prints why it skipped and
// returns cleanly, so a repo with no credentials still gets a green run and a
// refreshed manifest. A channel that has its secret and then fails is a real
// failure and is allowed to break the build — a silent success here is what let
// TronBrowser go three months believing it was published.

const TAP_REPO = process.env.HOMEBREW_TAP_REPO || "profullstack/homebrew-tap";
const SCOOP_REPO = process.env.SCOOP_BUCKET_REPO || "profullstack/scoop-bucket";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: opts.capture ? "pipe" : "inherit",
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `tron-${prefix}-`));
}

/**
 * Write one file into a repo we own and push it.
 *
 * Authenticated with a per-repo ssh deploy key rather than a PAT. A PAT carries
 * the whole account: any token able to push to the tap could also push here, and
 * GitHub has no API to mint one, so it would have to be pasted in by hand and
 * rotated by hand. A deploy key is scoped to exactly one repository, can be
 * created through the API, and is revoked by deleting it from that repo.
 */
function pushFileToRepo({ repo, sshKey, file, dest, message }) {
  const dir = tmp(dest.replace(/[^a-z0-9]+/gi, "-"));
  const keyfile = join(dir, "..", `key-${repo.replace(/\W+/g, "-")}`);
  writeFileSync(keyfile, sshKey.endsWith("\n") ? sshKey : `${sshKey}\n`, {
    mode: 0o600,
  });
  const env = {
    GIT_SSH_COMMAND: `ssh -i ${keyfile} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`,
  };
  run("git", ["clone", "--depth", "1", `ssh://git@github.com/${repo}.git`, dir], {
    cwd: ROOT,
    env,
  });
  // The tap holds Casks/ and Formula/ side by side and the bucket holds bucket/;
  // a first push into a directory that does not exist yet has to create it.
  run("mkdir", ["-p", dirname(join(dir, dest))]);
  run("cp", [join(ROOT, file), join(dir, dest)], { cwd: ROOT });
  run("git", ["config", "user.name", "github-actions[bot]"], { cwd: dir });
  run("git", [
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ], { cwd: dir });
  const changed = run("git", ["status", "--porcelain"], {
    cwd: dir,
    capture: true,
  }).trim();
  if (!changed) {
    console.log(`  ${repo} already current, nothing to push`);
    return;
  }
  run("git", ["add", dest], { cwd: dir });
  run("git", ["commit", "-m", message], { cwd: dir });
  run("git", ["push"], { cwd: dir, env });
  console.log(`  pushed ${dest} to ${repo}`);
}

/** Channels that are a PR into a third party's monorepo. */
function upstreamPr(pm, repo, doc) {
  console.log(
    `  ${pm}: needs a pull request into ${repo}, which is a human review queue.`,
  );
  console.log(`  manifest refreshed; open the PR by hand: ${doc}`);
}

const SUBMITTERS = {
  homebrew: () => {
    const sshKey = process.env.HOMEBREW_TAP_SSH_KEY;
    if (!sshKey) return skip("homebrew", "HOMEBREW_TAP_SSH_KEY");
    // distribution/homebrew/tronbrowser.rb is a Formula, not a Cask, so it goes
    // in Formula/ — the tap's existing Casks/nightcell7.rb is a separate thing
    // and a tap carries both directories quite happily.
    pushFileToRepo({
      repo: TAP_REPO,
      sshKey,
      file: "distribution/homebrew/tronbrowser.rb",
      dest: "Formula/tronbrowser.rb",
      message: `tronbrowser ${version}`,
    });
  },

  scoop: () => {
    const sshKey = process.env.SCOOP_BUCKET_SSH_KEY;
    if (!sshKey) return skip("scoop", "SCOOP_BUCKET_SSH_KEY");
    pushFileToRepo({
      repo: SCOOP_REPO,
      sshKey,
      file: "distribution/scoop/tronbrowser.json",
      dest: "bucket/tronbrowser.json",
      message: `tronbrowser ${version}`,
    });
  },

  aur: () => {
    const key = process.env.AUR_SSH_KEY;
    if (!key) return skip("aur", "AUR_SSH_KEY");
    const dir = tmp("aur");
    const keyfile = join(dir, "aur_key");
    writeFileSync(keyfile, key.endsWith("\n") ? key : `${key}\n`, {
      mode: 0o600,
    });
    // AUR only speaks ssh, and the runner has never seen the host before.
    const ssh = `ssh -i ${keyfile} -o StrictHostKeyChecking=accept-new`;
    const repoDir = join(dir, "tronbrowser-bin");
    run("git", ["clone", "ssh://aur@aur.archlinux.org/tronbrowser-bin.git", repoDir], {
      cwd: ROOT,
      env: { GIT_SSH_COMMAND: ssh },
    });
    run("cp", [join(ROOT, "distribution/aur/PKGBUILD"), join(repoDir, "PKGBUILD")]);
    // .SRCINFO is generated, and the AUR rejects a push whose .SRCINFO disagrees
    // with the PKGBUILD. makepkg is not on a GitHub runner, so write it from the
    // PKGBUILD we already have rather than shelling out to a tool that is absent.
    writeSrcinfo(repoDir);
    run("git", ["config", "user.name", "TronBrowser CI"], { cwd: repoDir });
    run("git", ["config", "user.email", "bot@tronbrowser.dev"], { cwd: repoDir });
    const changed = run("git", ["status", "--porcelain"], {
      cwd: repoDir,
      capture: true,
    }).trim();
    if (!changed) return console.log("  AUR already current, nothing to push");
    run("git", ["add", "PKGBUILD", ".SRCINFO"], { cwd: repoDir });
    run("git", ["commit", "-m", `tronbrowser-bin ${version}`], { cwd: repoDir });
    run("git", ["push"], { cwd: repoDir, env: { GIT_SSH_COMMAND: ssh } });
    console.log("  pushed PKGBUILD to the AUR");
  },

  chocolatey: () => {
    const key = process.env.CHOCOLATEY_API_KEY;
    if (!key) return skip("chocolatey", "CHOCOLATEY_API_KEY");
    const dir = join(ROOT, "distribution/chocolatey");
    run("choco", ["pack", "tronbrowser.nuspec", "--outputdirectory", dir], {
      cwd: dir,
    });
    run("choco", [
      "push",
      join(dir, `tronbrowser.${version}.nupkg`),
      "--source",
      "https://push.chocolatey.org/",
      "--api-key",
      key,
    ], { cwd: dir });
    console.log("  pushed to Chocolatey");
  },

  snap: () => {
    const creds = process.env.SNAPCRAFT_STORE_CREDENTIALS;
    if (!creds) return skip("snap", "SNAPCRAFT_STORE_CREDENTIALS");
    // snapcraft reads the credentials straight out of the environment; building
    // the snap itself needs LXD and happens in the release job, not here.
    const snap = process.env.SNAP_FILE;
    if (!snap || !existsSync(snap)) {
      console.log(
        "  snap: SNAPCRAFT_STORE_CREDENTIALS is set but no built .snap was passed",
      );
      console.log("  set SNAP_FILE to the artifact built by the release job");
      return;
    }
    run("snapcraft", ["upload", "--release", "stable", snap]);
    console.log("  uploaded to the Snap Store");
  },

  winget: () =>
    upstreamPr(
      "winget",
      "microsoft/winget-pkgs",
      "https://github.com/microsoft/winget-pkgs/blob/master/CONTRIBUTING.md",
    ),
  flatpak: () =>
    upstreamPr(
      "flatpak",
      "flathub/flathub",
      "https://docs.flathub.org/docs/for-app-authors/submission",
    ),
  nix: () =>
    upstreamPr(
      "nix",
      "NixOS/nixpkgs",
      "https://github.com/NixOS/nixpkgs/blob/master/CONTRIBUTING.md",
    ),
  gentoo: () =>
    upstreamPr(
      "gentoo",
      "an ebuild overlay",
      "https://wiki.gentoo.org/wiki/Ebuild_repository",
    ),
  freebsd: () =>
    upstreamPr(
      "freebsd",
      "freebsd/freebsd-ports",
      "https://docs.freebsd.org/en/books/porters-handbook/",
    ),

  // Built and attached to the GitHub release itself; there is no downstream.
  apt: () => console.log("  apt: attached to the GitHub release, nothing to submit"),
  rpm: () => console.log("  rpm: attached to the GitHub release, nothing to submit"),
  appimage: () =>
    console.log("  appimage: attached to the GitHub release, nothing to submit"),
};

function skip(pm, secret) {
  console.log(`  ${pm}: ${secret} not set, manifest refreshed but not submitted`);
}

/**
 * Write .SRCINFO from the PKGBUILD.
 *
 * Only the handful of fields our PKGBUILD actually sets — enough for the AUR to
 * accept the push and for a helper to resolve the package. If PKGBUILD grows
 * fields beyond these, this needs to grow with it.
 */
function writeSrcinfo(repoDir) {
  const pkgbuild = readFileSync(join(repoDir, "PKGBUILD"), "utf8");
  const field = (name) => {
    const m = pkgbuild.match(new RegExp(`^${name}=(.+)$`, "m"));
    return m ? m[1].replace(/^['"(]+|['")]+$/g, "") : "";
  };
  const lines = [
    `pkgbase = ${field("pkgname")}`,
    `\tpkgdesc = ${field("pkgdesc")}`,
    `\tpkgver = ${field("pkgver")}`,
    `\tpkgrel = ${field("pkgrel")}`,
    `\turl = ${field("url")}`,
    `\tarch = ${field("arch")}`,
    `\tlicense = ${field("license")}`,
    `\tsource = ${field("source")}`,
    `\tsha256sums = ${field("sha256sums")}`,
    "",
    `pkgname = ${field("pkgname")}`,
    "",
  ];
  writeFileSync(join(repoDir, ".SRCINFO"), lines.join("\n"));
}

if (!dryRun) {
  for (const pm of targets) {
    const submit = SUBMITTERS[pm];
    if (!submit) continue;
    console.log(`\n== submit ${pm} ==`);
    submit();
  }
}

console.log(`\nDone (${dryRun ? "dry run" : "manifests updated and submitted"}).`);
