# Nix package — consumes the GitHub release tarball + wraps a Chromium runtime.
{ lib, stdenv, fetchurl, makeWrapper, chromium }:

stdenv.mkDerivation rec {
  pname = "tronbrowser";
  version = "3.19.3";

  src = fetchurl {
    url = "https://github.com/profullstack/tronbrowser.dev/releases/download/v${version}/tronbrowser-linux-x64.tar.gz";
    sha256 = "6ef3ee87b0ed49eaeb5e2dc1a547d3019eb02ab418c2469b9bc4709da7aa3bd2";
  };

  nativeBuildInputs = [ makeWrapper ];
  sourceRoot = "tronbrowser";

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/tronbrowser $out/bin
    cp -r ./. $out/lib/tronbrowser/
    makeWrapper $out/lib/tronbrowser/tronbrowser $out/bin/tron \
      --prefix PATH : ${lib.makeBinPath [ chromium ]}
    ln -s $out/bin/tron $out/bin/tronbrowser
    runHook postInstall
  '';

  meta = with lib; {
    description = "Open-source, privacy-first, AI-native browser (Ungoogled Chromium fork)";
    homepage = "https://tronbrowser.dev";
    license = licenses.mit;
    platforms = platforms.linux;
    mainProgram = "tron";
  };
}
