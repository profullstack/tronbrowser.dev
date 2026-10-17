# Gentoo ebuild (binary) — consumes the GitHub release tarball.
EAPI=8
DESCRIPTION="Open-source, privacy-first, AI-native browser (Ungoogled Chromium fork)"
HOMEPAGE="https://tronbrowser.dev"
SRC_URI="https://github.com/profullstack/tronbrowser.dev/releases/download/v${PV}/tronbrowser-linux-x64.tar.gz -> ${P}.tar.gz"
LICENSE="MIT"
SLOT="0"
KEYWORDS="~amd64"
RDEPEND="www-client/chromium"
S="${WORKDIR}/tronbrowser"

src_install() {
	insinto /usr/lib/tronbrowser
	doins -r "${S}"/.
	dodir /usr/bin
	dosym /usr/lib/tronbrowser/tronbrowser /usr/bin/tron
	dosym /usr/lib/tronbrowser/tronbrowser /usr/bin/tronbrowser
	fperms +x /usr/lib/tronbrowser/tronbrowser
	dodoc "${S}/LICENSE"
}
