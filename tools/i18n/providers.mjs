// AI 翻译的 provider 抽象。
//
// 目标是不绑定平台：只要能用环境变量描述出来，就能接。
// 默认走 OpenAI 兼容协议 —— DeepSeek、通义、Kimi、智谱、OpenRouter、Ollama、
// vLLM 这些都能用同一套 body 调，改个 baseUrl 和 model 就换供应商。
// Anthropic 有原生协议，单独实现；再兜不住就用 custom 挂自己的模块。

const TIMEOUT_DEFAULT = 120_000;
const RETRIES_DEFAULT = 3;
const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function trimSlash(url) {
  return String(url).replace(/\/+$/, '');
}

function joinUrl(base, suffix) {
  const cleanBase = trimSlash(base);
  // 用户可能写成 https://api.openai.com 或 https://api.openai.com/v1
  if (cleanBase.endsWith('/v1') && suffix.startsWith('/v1/')) {
    return cleanBase + suffix.slice(3);
  }
  return cleanBase + suffix;
}

async function withRetry(fn, {retries}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = error.retryable !== false;
      if (!retryable || attempt === retries) break;
      const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 400;
      console.warn(
        `[i18n] 请求失败（${error.message}），${Math.round(delay / 1000)}s 后重试 ${attempt + 1}/${retries}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function postJson(url, {headers, body, timeout}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', ...headers},
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(
        `HTTP ${response.status} ${response.statusText}: ${text.slice(0, 400)}`,
      );
      error.retryable = RETRY_STATUS.has(response.status);
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw Object.assign(new Error(`响应不是 JSON: ${text.slice(0, 200)}`), {
        retryable: false,
      });
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      error.message = `请求超时（${timeout}ms）`;
      error.retryable = true;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function openAiCompatible({baseUrl, apiKey, model, timeout, temperature}) {
  return {
    async chat({system, user}) {
      const data = await postJson(joinUrl(baseUrl, '/chat/completions'), {
        timeout,
        headers: apiKey ? {authorization: `Bearer ${apiKey}`} : {},
        body: {
          model,
          temperature,
          messages: [
            {role: 'system', content: system},
            {role: 'user', content: user},
          ],
        },
      });
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw Object.assign(new Error('模型返回了空内容'), {retryable: true});
      }
      return content;
    },
  };
}

function anthropic({baseUrl, apiKey, model, timeout, temperature}) {
  return {
    async chat({system, user}) {
      const data = await postJson(joinUrl(baseUrl, '/v1/messages'), {
        timeout,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model,
          max_tokens: 8192,
          temperature,
          system,
          messages: [{role: 'user', content: user}],
        },
      });
      const content = (data?.content ?? [])
        .filter((part) => part?.type === 'text')
        .map((part) => part.text)
        .join('');
      if (!content.trim()) {
        throw Object.assign(new Error('模型返回了空内容'), {retryable: true});
      }
      return content;
    },
  };
}

async function customModule({modulePath, siteDir}) {
  const {pathToFileURL} = await import('node:url');
  const path = await import('node:path');
  const abs = path.isAbsolute(modulePath)
    ? modulePath
    : path.resolve(siteDir, modulePath);
  const mod = await import(pathToFileURL(abs).href);
  const translate = mod.translate ?? mod.default;
  if (typeof translate !== 'function') {
    throw new Error(`[i18n] 自定义模块 ${modulePath} 需要导出 translate({system, user})`);
  }
  return {
    async chat(payload) {
      const result = await translate(payload);
      if (typeof result !== 'string' || !result.trim()) {
        throw new Error('[i18n] 自定义模块返回了空内容');
      }
      return result;
    },
  };
}

export async function resolveProvider(env = process.env, {siteDir = process.cwd()} = {}) {
  const providerName = (env.AI_PROVIDER || 'openai').toLowerCase();
  const timeout = Number(env.AI_TIMEOUT_MS) || TIMEOUT_DEFAULT;
  const retries = Number.isFinite(Number(env.AI_RETRIES))
    ? Number(env.AI_RETRIES)
    : RETRIES_DEFAULT;
  const temperature = Number.isFinite(Number(env.AI_TEMPERATURE))
    ? Number(env.AI_TEMPERATURE)
    : 0.2;

  let inner;
  let label;

  if (providerName === 'custom') {
    if (!env.AI_MODULE) {
      throw new Error('[i18n] AI_PROVIDER=custom 时必须设置 AI_MODULE（模块路径）');
    }
    inner = await customModule({modulePath: env.AI_MODULE, siteDir});
    label = `custom:${env.AI_MODULE}`;
  } else if (providerName === 'anthropic') {
    const apiKey = env.AI_API_KEY;
    if (!apiKey) throw new Error('[i18n] 缺少 AI_API_KEY');
    const model = env.AI_MODEL || 'claude-sonnet-4-5';
    inner = anthropic({
      baseUrl: env.AI_BASE_URL || 'https://api.anthropic.com',
      apiKey,
      model,
      timeout,
      temperature,
    });
    label = `anthropic:${model}`;
  } else {
    // 默认：OpenAI 兼容。openai / openai-compatible 走同一分支。
    const baseUrl = env.AI_BASE_URL || 'https://api.openai.com/v1';
    const model = env.AI_MODEL;
    if (!model) {
      throw new Error(
        '[i18n] 缺少 AI_MODEL。OpenAI 兼容端点的模型名不通用，必须显式指定' +
          '（例如 deepseek-chat、qwen-plus、gpt-4o-mini、llama3.1）',
      );
    }
    const apiKey = env.AI_API_KEY;
    // 本地 Ollama / vLLM 通常不需要 key，有就带、没有也放行
    inner = openAiCompatible({baseUrl, apiKey, model, timeout, temperature});
    label = `openai-compatible:${model}@${trimSlash(baseUrl)}`;
  }

  return {
    label,
    async chat(payload) {
      const result = await withRetry(() => inner.chat(payload), {retries});
      return result.trim();
    },
  };
}

export function describeEnvHints() {
  return [
    'AI_PROVIDER   openai（默认，OpenAI 兼容）| anthropic | custom',
    'AI_BASE_URL   端点根地址，例如 https://api.deepseek.com/v1',
    'AI_API_KEY    密钥（本地模型可留空）',
    'AI_MODEL      模型名，OpenAI 兼容端点必填',
    'AI_MODULE     AI_PROVIDER=custom 时的模块路径（导出 translate({system,user})）',
    'AI_TIMEOUT_MS 单次请求超时，默认 120000',
    'AI_RETRIES    失败重试次数，默认 3',
    'AI_CONCURRENCY 并发请求数，默认 3',
  ];
}
