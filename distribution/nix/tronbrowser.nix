# Nix package — consumes the GitHub release tarball + wraps a Chromium runtime.
{ lib, stdenv, fetchurl, makeWrapper, chromium }:

stdenv.mkDerivation rec {
  pname = "tronbrowser";
  version = "3.19.2";

  src = fetchurl {
    url = "https://github.com/profullstack/tronbrowser.dev/releases/download/v${version}/tronbrowser-linux-x64.tar.gz";
    sha256 = "7cab61ded58efda9b3b10b45ccb9b5e6d76cd4d23fbf7577b34164580ab1d781";
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
