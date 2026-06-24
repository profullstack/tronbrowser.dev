# @tronbrowser/payments

x402 (HTTP 402 "Payment Required") payment processing over the user's **CoinPay**
global wallet addresses.

> Status: **stub** — interfaces + pure logic defined, network calls pending.
> Added alongside M2 (AI sidebar) work; depends conceptually on CoinPay OAuth in
> [`@tronbrowser/auth`](../auth).

## How it works

1. A request hits a resource that responds `402` with payment requirements.
2. `PaymentProcessor` parses the requirements and picks one of the user's CoinPay
   wallet addresses matching the required **network + asset**.
3. CoinPay (custodial — keys never leave CoinPay) authorizes/signs the payment.
4. The processor returns the `X-PAYMENT` header to retry the original request.

```ts
import { PaymentProcessor } from '@tronbrowser/payments';

const processor = new PaymentProcessor(coinPayWallet);
const { headers } = await processor.process(await res.json(), { maxAmount: 1_000_000n });
const paid = await fetch(url, { headers: { ...headers } });
```

## Modules

| File | Contents |
| --- | --- |
| `x402.ts` | Protocol primitives: `parsePaymentRequired`, `encode/decodePaymentHeader`, header constants |
| `coinpay.ts` | `CoinPayWallet` contract, `CoinPayAddress`, `selectAddress()` |
| `processor.ts` | `PaymentProcessor` — one payment end to end, with an optional `maxAmount` guard |

## Privacy & safety

- Keys are custodial in CoinPay; TronBrowser only holds a short-lived OAuth token.
- `maxAmount` caps per-request spend; agent budgets/ledger live in the agent runtime.
- Nothing is paid automatically without a wallet that matches network + asset.

See the [PRD](../../docs/tronbrowser-prd.md) §Payments.
