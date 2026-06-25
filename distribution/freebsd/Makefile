# FreeBSD port — www/tronbrowser. Consumes the GitHub release tarball.
PORTNAME=	tronbrowser
DISTVERSION=	0.1.1
CATEGORIES=	www

MASTER_SITES=	https://github.com/profullstack/tronbrowser.dev/releases/download/v${DISTVERSION}/
DISTNAME=	tronbrowser-linux-x64

MAINTAINER=	security@profullstack.com
COMMENT=	Privacy-first, AI-native browser (Ungoogled Chromium fork)
WWW=		https://tronbrowser.dev

LICENSE=	MIT
LICENSE_FILE=	${WRKSRC}/LICENSE

RUN_DEPENDS=	chrome:www/chromium

NO_BUILD=	yes
NO_ARCH=	yes
WRKSRC=		${WRKDIR}/tronbrowser

do-install:
	@${MKDIR} ${STAGEDIR}${PREFIX}/lib/tronbrowser
	(cd ${WRKSRC} && ${COPYTREE_SHARE} . ${STAGEDIR}${PREFIX}/lib/tronbrowser)
	@${CHMOD} +x ${STAGEDIR}${PREFIX}/lib/tronbrowser/tronbrowser
	${LN} -sf ${PREFIX}/lib/tronbrowser/tronbrowser ${STAGEDIR}${PREFIX}/bin/tron
	${LN} -sf ${PREFIX}/lib/tronbrowser/tronbrowser ${STAGEDIR}${PREFIX}/bin/tronbrowser

.include <bsd.port.mk>
