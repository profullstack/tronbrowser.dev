# @tronbrowser/auth

Authentication and session primitives, including **CoinPay OAuth** sign-in.

CoinPay OAuth lets a user connect their CoinPay account so TronBrowser can
authorize x402 payments (see [`@tronbrowser/payments`](../payments)) from their
CoinPay global wallet addresses. Keys stay custodial in CoinPay.

```ts
import { CoinPayOAuthProvider } from '@tronbrowser/auth';

const provider = new CoinPayOAuthProvider({
  clientId: process.env.COINPAY_CLIENT_ID!,
  redirectUri: 'tronbrowser://oauth/coinpay',
  // authorizeUrl/tokenUrl default to hosted CoinPay; override for self-hosted.
});
const url = provider.authorizeUrl(state, codeChallenge); // PKCE
```

## Modules

- `oauth.ts` — generic OAuth 2.0 (Authorization Code + PKCE) contracts
- `coinpay-oauth.ts` — `CoinPayOAuthProvider`, defaults, self-hosted overrides

Scopes requested: `wallet:read`, `payments:x402`. Token exchange/refresh land in M2.

See the [PRD](../../docs/tronbrowser-prd.md) §Payments.
