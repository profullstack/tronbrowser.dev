# Homebrew formula for TronBrowser. Intended for a tap:
#   brew install profullstack/tap/tronbrowser
# Bump `version` + sha256 on each release (automate via submit-packages.yml).
class Tronbrowser < Formula
  desc "Open-source, privacy-first, AI-native browser (Ungoogled Chromium fork)"
  homepage "https://tronbrowser.dev"
  version "3.19.4"
  license "MIT"

  on_macos do
    url "https://github.com/profullstack/tronbrowser.dev/releases/download/v3.19.4/tronbrowser-macos.zip"
    sha256 "4f928b90b83a34d90edf6f3b4f522c47b85090046424ce69cc535a0cb85d77d1"
  end

  on_linux do
    url "https://github.com/profullstack/tronbrowser.dev/releases/download/v3.19.4/tronbrowser-linux-x64.tar.gz"
    sha256 "88ac1fe22cf745dcd620a05ae6a47501f7d3e6bdcc1fdf78bf6530514ba0177f"
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
