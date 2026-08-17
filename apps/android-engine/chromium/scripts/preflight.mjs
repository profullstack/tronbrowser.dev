#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statfsSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const SUPPORTED_CPUS = ['arm64', 'arm'];
const ALLOWED_CPUS = new Set(SUPPORTED_CPUS);
const REQUIRED_CONFIG_KEYS = [
  'chromiumVersion',
  'ungoogledChromiumTag',
  'releaseApproved',
  'ungoogledChromiumRepo',
  'depotToolsRepo',
  'targetOs',
  'targetCpus',
  'ninjaTargets',
  'torAndroid',
];
const REQUIRED_BRANDING_KEYS = [
  'COMPANY_FULLNAME',
  'PRODUCT_FULLNAME',
  'PRODUCT_SHORTNAME',
  'ANDROID_APP_ID',
];
const MIN_FREE_BYTES = 100 * 1024 ** 3;

function parseJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`cannot parse ${path}: ${error.message}`);
    return {};
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseSeries(path, errors) {
  if (!existsSync(path)) {
    errors.push('patches/series is missing');
    return [];
  }

  const entries = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (entries.length === 0) {
    errors.push('patches/series has no patch entries');
  }

  const seen = new Set();
  for (const entry of entries) {
    const normalized = entry.split('/').join(sep);
    if (
      isAbsolute(entry) ||
      normalized === '..' ||
      normalized.startsWith(`..${sep}`) ||
      normalized.includes(`${sep}..${sep}`) ||
      !entry.endsWith('.patch')
    ) {
      errors.push(`unsafe patch series entry: ${entry}`);
    }
    if (seen.has(entry)) {
      errors.push(`duplicate patch series entry: ${entry}`);
    }
    seen.add(entry);
  }

  return entries;
}

function brandingValues(path, errors) {
  if (!existsSync(path)) {
    errors.push('branding/BRANDING is missing');
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function hasBrandingAsset(directory) {
  if (!existsSync(directory)) return false;
  return readdirSync(directory, { withFileTypes: true }).some((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return hasBrandingAsset(path);
    return entry.isFile() && entry.name !== 'README.md' && statSync(path).size > 0;
  });
}

function gnStringValue(contents, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return contents.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
}

function nearestExistingDirectory(path) {
  let candidate = resolve(path);
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
  return candidate;
}

function hostBlockers(workdir) {
  const blockers = [];
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    blockers.push(
      `build host must be Linux x64 (current: ${process.platform} ${process.arch})`,
    );
  }

  const diskPath = nearestExistingDirectory(workdir);
  if (!diskPath) {
    blockers.push(`cannot find an existing parent directory for TB_WORKDIR=${workdir}`);
    return blockers;
  }

  try {
    const disk = statfsSync(diskPath, { bigint: true });
    const freeBytes = disk.bavail * disk.bsize;
    if (freeBytes < BigInt(MIN_FREE_BYTES)) {
      blockers.push(
        `TB_WORKDIR filesystem needs at least 100 GiB free (found ${Number(freeBytes / 1024n ** 3n)} GiB at ${diskPath})`,
      );
    }
  } catch (error) {
    blockers.push(`cannot inspect free space at ${diskPath}: ${error.message}`);
  }

  return blockers;
}

export function inspectAndroidEngine(
  root = DEFAULT_ROOT,
  { targetCpu = process.env.TB_TARGET_CPU ?? 'arm64', checkHost = false } = {},
) {
  const errors = [];
  const releaseBlockers = [];
  const checkoutBlockers = [];
  const configPath = join(root, 'config', 'version.json');
  const config = parseJson(configPath, errors);

  for (const key of REQUIRED_CONFIG_KEYS) {
    if (config[key] === undefined) errors.push(`config/version.json is missing ${key}`);
  }

  if (!/^\d+\.\d+\.\d+\.\d+$/.test(config.chromiumVersion ?? '')) {
    errors.push('chromiumVersion must be a four-part numeric version');
  }
  if (config.releaseApproved !== true) {
    releaseBlockers.push(
      `Chromium ${config.chromiumVersion ?? 'pin'} is not approved for an Android release`,
    );
  }
  if (
    typeof config.chromiumVersion === 'string' &&
    typeof config.ungoogledChromiumTag === 'string' &&
    !config.ungoogledChromiumTag.startsWith(`${config.chromiumVersion}-`)
  ) {
    errors.push('ungoogledChromiumTag must match the pinned Chromium version');
  }
  if (!isHttpsUrl(config.ungoogledChromiumRepo)) {
    errors.push('ungoogledChromiumRepo must be an HTTPS URL');
  }
  if (!isHttpsUrl(config.depotToolsRepo)) {
    errors.push('depotToolsRepo must be an HTTPS URL');
  }
  if (config.targetOs !== 'android') {
    errors.push('targetOs must be android');
  }

  if (!Array.isArray(config.targetCpus) || config.targetCpus.length === 0) {
    errors.push('targetCpus must be a non-empty array');
  } else {
    const uniqueCpus = new Set(config.targetCpus);
    if (uniqueCpus.size !== config.targetCpus.length) {
      errors.push('targetCpus must not contain duplicates');
    }
    for (const cpu of uniqueCpus) {
      if (!ALLOWED_CPUS.has(cpu)) errors.push(`unsupported target CPU: ${cpu}`);
    }
    if (
      uniqueCpus.size !== SUPPORTED_CPUS.length ||
      SUPPORTED_CPUS.some((cpu) => !uniqueCpus.has(cpu))
    ) {
      errors.push(`targetCpus must contain exactly: ${SUPPORTED_CPUS.join(', ')}`);
    }
    if (!uniqueCpus.has(targetCpu)) {
      errors.push(`TB_TARGET_CPU=${targetCpu} is not listed in targetCpus`);
    }
  }

  if (!Array.isArray(config.ninjaTargets) || config.ninjaTargets.length === 0) {
    errors.push('ninjaTargets must be a non-empty array');
  } else {
    for (const target of config.ninjaTargets) {
      if (typeof target !== 'string' || !/^[a-z0-9_]+$/.test(target)) {
        errors.push(`invalid ninja target: ${target}`);
      }
    }
    if (!config.ninjaTargets.includes('chrome_public_apk')) {
      errors.push('ninjaTargets must include chrome_public_apk');
    }
  }

  const entries = parseSeries(join(root, 'patches', 'series'), errors);
  const patchRoot = resolve(root, 'patches');
  for (const entry of entries) {
    const patchPath = resolve(patchRoot, entry);
    const insidePatchRoot = relative(patchRoot, patchPath);
    if (
      insidePatchRoot === '..' ||
      insidePatchRoot.startsWith(`..${sep}`) ||
      isAbsolute(insidePatchRoot)
    ) {
      continue;
    }
    if (!existsSync(patchPath) || statSync(patchPath).size === 0) {
      releaseBlockers.push(`patch body is missing or empty: patches/${entry}`);
    }
  }

  const branding = brandingValues(join(root, 'branding', 'BRANDING'), errors);
  for (const key of REQUIRED_BRANDING_KEYS) {
    if (!branding[key]) errors.push(`branding/BRANDING is missing ${key}`);
  }
  if (!hasBrandingAsset(join(root, 'branding', 'assets'))) {
    releaseBlockers.push('branding/assets has no non-empty Android icon assets');
  }

  const commonGnPath = join(root, 'config', 'gn-args', 'common.gni');
  if (!existsSync(commonGnPath)) {
    errors.push('config/gn-args/common.gni is missing');
  } else if (/\$\{TB_[A-Z0-9_]+\}/.test(readFileSync(commonGnPath, 'utf8'))) {
    errors.push('common.gni must not contain unresolved TB_* placeholders');
  }

  const androidGnPath = join(root, 'config', 'gn-args', 'android.gni');
  if (!existsSync(androidGnPath)) {
    errors.push('config/gn-args/android.gni is missing');
  } else {
    const androidGn = readFileSync(androidGnPath, 'utf8');
    if (!/^\s*target_cpu\s*=\s*"\$\{TB_TARGET_CPU\}"/m.test(androidGn)) {
      errors.push('android.gni must retain the TB_TARGET_CPU placeholder');
    }
    const unexpectedPlaceholders = [
      ...androidGn.matchAll(/\$\{(TB_[A-Z0-9_]+)\}/g),
    ]
      .map((match) => match[1])
      .filter((name) => name !== 'TB_TARGET_CPU');
    if (unexpectedPlaceholders.length > 0) {
      errors.push(
        `android.gni contains unsupported placeholders: ${[
          ...new Set(unexpectedPlaceholders),
        ].join(', ')}`,
      );
    }
    if (/^\s*enable_gvr_services\s*=/m.test(androidGn)) {
      errors.push('android.gni contains removed GN argument enable_gvr_services');
    }
    const manifestPackage = gnStringValue(
      androidGn,
      'chrome_public_manifest_package',
    );
    if (!manifestPackage) {
      errors.push('android.gni must set chrome_public_manifest_package');
    } else if (manifestPackage !== branding.ANDROID_APP_ID) {
      errors.push(
        'chrome_public_manifest_package must match branding ANDROID_APP_ID',
      );
    }
    if (gnStringValue(androidGn, 'android_channel') !== 'default') {
      errors.push('android.gni must explicitly set android_channel to default');
    }
  }

  const tor = config.torAndroid ?? {};
  if (!isHttpsUrl(tor.repo)) errors.push('torAndroid.repo must be an HTTPS URL');
  if (!Number.isInteger(tor.socksPort) || tor.socksPort < 1 || tor.socksPort > 65535) {
    errors.push('torAndroid.socksPort must be an integer from 1 to 65535');
  }
  if (!tor.version || !tor.artifacts || typeof tor.artifacts !== 'object') {
    releaseBlockers.push('torAndroid must pin a version and per-CPU artifacts');
  } else if (Array.isArray(config.targetCpus)) {
    for (const cpu of config.targetCpus) {
      const artifact = tor.artifacts[cpu];
      if (
        !artifact ||
        !isHttpsUrl(artifact.url) ||
        !/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? '')
      ) {
        releaseBlockers.push(
          `torAndroid artifact for ${cpu} needs an HTTPS URL and SHA-256`,
        );
      }
    }
  }
  if (tor.integrationReady !== true) {
    releaseBlockers.push('Tor Android artifact staging is not implemented');
  }

  if (checkHost) {
    checkoutBlockers.push(
      ...hostBlockers(
        process.env.TB_WORKDIR ||
          join(process.env.HOME ?? root, '.cache', 'tronbrowser-android-chromium'),
      ),
    );
  }

  return {
    errors,
    blockers: [...checkoutBlockers, ...releaseBlockers],
    checkoutBlockers,
    releaseBlockers,
    config,
  };
}

function parseArgs(args) {
  let mode = 'scaffold';
  let targetCpu = process.env.TB_TARGET_CPU ?? 'arm64';
  let json = false;

  const nextValue = (index, name) => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--release') mode = 'release';
    else if (arg === '--mode') mode = nextValue(index++, '--mode');
    else if (arg.startsWith('--mode=')) mode = arg.slice('--mode='.length);
    else if (arg === '--target-cpu') targetCpu = nextValue(index++, '--target-cpu');
    else if (arg.startsWith('--target-cpu=')) {
      targetCpu = arg.slice('--target-cpu='.length);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['scaffold', 'checkout', 'release'].includes(mode)) {
    throw new Error(`mode must be scaffold, checkout, or release; received: ${mode}`);
  }
  if (!targetCpu) throw new Error('target CPU is required');
  return { mode, targetCpu, json };
}

function reportFor(result, { mode, targetCpu }) {
  const fatalBlockers =
    mode === 'release'
      ? result.blockers
      : mode === 'checkout'
        ? result.checkoutBlockers
        : [];

  return {
    status:
      result.errors.length > 0
        ? 'invalid'
        : result.blockers.length > 0
          ? 'blocked'
          : 'ready',
    mode,
    targetCpu,
    chromiumVersion: result.config.chromiumVersion ?? null,
    errors: result.errors,
    blockers: result.blockers,
    checkoutBlockers: result.checkoutBlockers,
    releaseBlockers: result.releaseBlockers,
    fatalBlockers,
  };
}

export function runCli(
  args = process.argv.slice(2),
  {
    root = DEFAULT_ROOT,
    writeOut = (line) => console.log(line),
    writeError = (line) => console.error(line),
  } = {},
) {
  const jsonRequested = args.includes('--json');
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    if (jsonRequested) {
      writeOut(JSON.stringify({ status: 'invalid', errors: [error.message] }));
    } else {
      writeError(`preflight: ${error.message}`);
    }
    return 2;
  }

  const result = inspectAndroidEngine(root, {
    targetCpu: options.targetCpu,
    checkHost: options.mode !== 'scaffold',
  });
  const report = reportFor(result, options);

  if (options.json) {
    writeOut(JSON.stringify(report, null, 2));
  }

  if (result.errors.length > 0) {
    if (!options.json) {
      writeError('Android engine scaffold is invalid:');
      for (const error of result.errors) writeError(`  - ${error}`);
    }
    return 1;
  }

  if (!options.json) {
    writeOut(
      `Android engine scaffold is valid for ${options.targetCpu} (Chromium ${result.config.chromiumVersion}).`,
    );
    if (result.checkoutBlockers.length > 0) {
      writeOut(`Checkout blockers (${result.checkoutBlockers.length}):`);
      for (const blocker of result.checkoutBlockers) writeOut(`  - ${blocker}`);
    }
    if (result.releaseBlockers.length > 0) {
      const suffix =
        options.mode === 'checkout' ? ' (do not block source checkout)' : '';
      writeOut(`Release blockers (${result.releaseBlockers.length})${suffix}:`);
      for (const blocker of result.releaseBlockers) writeOut(`  - ${blocker}`);
    }
    if (result.blockers.length === 0) {
      writeOut('No readiness blockers found.');
    }
  }

  if (report.fatalBlockers.length > 0) {
    const action = options.mode === 'checkout' ? 'checkout' : 'heavy build';
    if (!options.json) {
      writeError(`preflight: refusing the ${action} until its blockers are resolved`);
    }
    return 1;
  }
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) process.exitCode = runCli();
