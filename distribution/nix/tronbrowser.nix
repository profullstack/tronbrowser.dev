# Nix package — consumes the GitHub release tarball + wraps a Chromium runtime.
{ lib, stdenv, fetchurl, makeWrapper, chromium }:

stdenv.mkDerivation rec {
  pname = "tronbrowser";
  version = "3.19.4";

  src = fetchurl {
    url = "https://github.com/profullstack/tronbrowser.dev/releases/download/v${version}/tronbrowser-linux-x64.tar.gz";
    sha256 = "88ac1fe22cf745dcd620a05ae6a47501f7d3e6bdcc1fdf78bf6530514ba0177f";
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
