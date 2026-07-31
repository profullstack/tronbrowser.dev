#!/bin/sh
# Test double for the `tronbrowser` shim: exec-replaces into the Node CDP mock so
# tron-session tracks the mock's pid exactly like Chromium does on Linux.
exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/cdp-mock-server.mjs"
