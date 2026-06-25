// Self-contained provider calling for the sidebar (mirrors
// @tronbrowser/model-providers). Plain ESM so it loads unbundled in MV3.

export const PROVIDERS = {
  anthropic:   { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1',                          anthropic: true,  keyless: false },
  openai:      { label: 'OpenAI',             baseUrl: 'https://api.openai.com/v1',                            anthropic: false, keyless: false },
  google:      { label: 'Google (Gemini)',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', anthropic: false, keyless: false },
  deepseek:    { label: 'DeepSeek',           baseUrl: 'https://api.deepseek.com/v1',                          anthropic: false, keyless: false },
  perplexity:  { label: 'Perplexity (Sonar)', baseUrl: 'https://api.perplexity.ai',                            anthropic: false, keyless: false },
  huggingface: { label: 'Hugging Face',       baseUrl: 'https://router.huggingface.co/v1',                     anthropic: false, keyless: false },
  kimi:        { label: 'Kimi (Moonshot)',    baseUrl: 'https://api.moonshot.ai/v1',                           anthropic: false, keyless: false },
  qwen:        { label: 'Qwen (Alibaba)',     baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',    anthropic: false, keyless: false },
  ollama:      { label: 'Ollama (local)',     baseUrl: 'http://localhost:11434/v1',                            anthropic: false, keyless: true  },
  lmstudio:    { label: 'LM Studio (local)',  baseUrl: 'http://localhost:1234/v1',                             anthropic: false, keyless: true  },
  vllm:        { label: 'vLLM (self-hosted)', baseUrl: 'http://localhost:8000/v1',                             anthropic: false, keyless: true  },
};

// Common models per provider — shown immediately when a provider is selected,
// even before a key is entered. The live list (listModels) merges on top.
export const KNOWN_MODELS = {
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-fable-5'],
  openai: ['gpt-5.5', 'gpt-5', 'gpt-4.1', 'o4-mini', 'gpt-4o'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  perplexity: ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning'],
  huggingface: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
  kimi: ['kimi-k2', 'kimi-latest', 'moonshot-v1-128k'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  ollama: ['llama3.2', 'qwen2.5', 'mistral', 'phi4'],
  lmstudio: [],
  vllm: [],
};

/**
 * Lists a provider's available models. The extension can call providers
 * directly (host permissions), so no backend proxy is needed.
 * `cfg` = { provider, apiKey, baseUrl? }. Returns an array of model ids.
 */
export async function listModels(cfg) {
  const meta = PROVIDERS[cfg.provider];
  if (!meta) return [];
  const baseUrl = (cfg.baseUrl || meta.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl) return [];
  const headers = {};
  if (meta.anthropic) {
    headers['x-api-key'] = cfg.apiKey || '';
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (cfg.apiKey) {
    headers['authorization'] = 'Bearer ' + cfg.apiKey;
  }
  const res = await fetch(baseUrl + '/models', { headers });
  if (!res.ok) throw new Error(cfg.provider + ' ' + res.status);
  const data = await res.json();
  return (data.data || data.models || [])
    .map((m) => (typeof m === 'string' ? m : m.id || m.name))
    .filter(Boolean);
}

async function* sse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

/**
 * Streams a chat completion. `cfg` = { provider, apiKey, model, baseUrl? }.
 * Calls onDelta(text) for each chunk. Returns the full text.
 */
export async function chatStream(cfg, messages, onDelta) {
  const meta = PROVIDERS[cfg.provider];
  if (!meta) throw new Error('unknown provider: ' + cfg.provider);
  const baseUrl = cfg.baseUrl || meta.baseUrl;
  let full = '';

  if (meta.anthropic) {
    const system = messages.find((m) => m.role === 'system')?.content;
    const rest = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const res = await fetch(baseUrl + '/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1024, ...(system ? { system } : {}), messages: rest, stream: true }),
    });
    if (!res.ok) throw new Error('anthropic ' + res.status + ': ' + (await res.text()));
    for await (const data of sse(res)) {
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'content_block_delta' && evt.delta?.text) { full += evt.delta.text; onDelta(evt.delta.text); }
      } catch { /* ignore */ }
    }
    return full;
  }

  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers['authorization'] = 'Bearer ' + cfg.apiKey;
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
  });
  if (!res.ok) throw new Error(cfg.provider + ' ' + res.status + ': ' + (await res.text()));
  for await (const data of sse(res)) {
    if (data === '[DONE]') break;
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) { full += delta; onDelta(delta); }
    } catch { /* ignore keep-alives */ }
  }
  return full;
}
