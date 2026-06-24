# @tronbrowser/model-providers

Pluggable LLM provider adapters + API-key resolution.

## Providers

The **BYOK cloud** set mirrors the providers used across Profullstack apps
(crawlproof.com):

| Provider | id | BYOK env var |
| --- | --- | --- |
| Anthropic (Claude) | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |
| Google (Gemini) | `google` | `GEMINI_API_KEY` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` |
| Perplexity (Sonar) | `perplexity` | `PERPLEXITY_API_KEY` |
| Hugging Face | `huggingface` | `HUGGINGFACE_API_KEY` |
| Kimi (Moonshot AI) | `kimi` | `MOONSHOT_API_KEY` (alias `KIMI_API_KEY`) |
| Qwen (Alibaba) | `qwen` | `DASHSCOPE_API_KEY` (alias `QWEN_API_KEY`) |

Plus keyless local runtimes: `ollama`, `lmstudio`, `vllm`.

## Keys: BYOK vs cloud

- **BYOK** (free / self-hosted): the user brings their own keys, read from the web
  app environment via `EnvKeyVault`.
- **Cloud** (paid): we use **our** keys, stored in the DB (`ai_provider_keys`,
  scoped per `app_id` since multiple apps share the vault) via `DbCloudKeyVault`.

```ts
import { EnvKeyVault, DbCloudKeyVault, resolveProviderKey } from '@tronbrowser/model-providers';

const byok = new EnvKeyVault(process.env);
const cloud = new DbCloudKeyVault(myStore); // backed by ai_provider_keys

// prefer the user's own key; fall back to our cloud key on paid plans
const key = await resolveProviderKey('tronbrowser', 'anthropic', [byok, cloud]);
// => { provider, apiKey, source: 'byok' | 'cloud' } | undefined
```

DB schema: [`../storage/migrations/0001_ai_provider_keys.sql`](../storage/migrations/0001_ai_provider_keys.sql).

See the [PRD](../../docs/tronbrowser-prd.md) §AI.
