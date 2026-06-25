# Homebrew formula for TronBrowser. Intended for a tap:
#   brew install profullstack/tap/tronbrowser
# Bump `version` + sha256 on each release (automate via submit-packages.yml).
class Tronbrowser < Formula
  desc "Open-source, privacy-first, AI-native browser (Ungoogled Chromium fork)"
  homepage "https://tronbrowser.dev"
  version "0.1.0"
  license "MIT"

  on_macos do
    url "https://github.com/profullstack/tronbrowser.dev/releases/download/v0.1.0/tronbrowser-macos.zip"
    sha256 "4f928b90b83a34d90edf6f3b4f522c47b85090046424ce69cc535a0cb85d77d1"
  end

  on_linux do
    url "https://github.com/profullstack/tronbrowser.dev/releases/download/v0.1.0/tronbrowser-linux-x64.tar.gz"
    sha256 "d966a54a6369ec283203abd257f89e50844ff68551229a463f568dc638dcf4c7"
  end

  def install
    libexec.install Dir["tronbrowser/*"]
    bin.install_symlink libexec/"tronbrowser"
    bin.install_symlink libexec/"tronbrowser" => "tron"
  end

  test do
    assert_match "0.1.0", shell_output("#{bin}/tron version")
  end
end
