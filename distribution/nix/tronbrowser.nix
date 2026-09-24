# Nix package — consumes the GitHub release tarball + wraps a Chromium runtime.
{ lib, stdenv, fetchurl, makeWrapper, chromium }:

stdenv.mkDerivation rec {
  pname = "tronbrowser";
  version = "3.16.0";

  src = fetchurl {
    url = "https://github.com/profullstack/tronbrowser.dev/releases/download/v${version}/tronbrowser-linux-x64.tar.gz";
    sha256 = "890dc050ad080174f94a8e54275fc64072dff515a6237bb4bd0d66fce8d31fe5";
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
