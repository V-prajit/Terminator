// packages/ai-server/rate-limit.js
import { Cerebras } from '@cerebras/cerebras_cloud_sdk';

export function parseRateLimitHeaders(headers) {
  if (!headers?.get) return null;
  const get = (k) => headers.get(k) ?? headers.get(k.toLowerCase()) ?? null;
  const toNum = (v) => (v == null ? null : Number(v));
  return {
    limit_requests_day:        toNum(get('x-ratelimit-limit-requests-day')),
    limit_tokens_minute:       toNum(get('x-ratelimit-limit-tokens-minute')),
    remaining_requests_day:    toNum(get('x-ratelimit-remaining-requests-day')),
    remaining_tokens_minute:   toNum(get('x-ratelimit-remaining-tokens-minute')),
    reset_requests_day_secs:   toNum(get('x-ratelimit-reset-requests-day')),
    reset_tokens_minute_secs:  toNum(get('x-ratelimit-reset-tokens-minute')),
    retry_after_secs:          toNum(get('retry-after')),
  };
}

async function probeWithJsonFormat(client, model) {
  // Probe 1: include the literal word "JSON" and request a tiny JSON object.
  const { data, response } = await client.chat.completions
    .create({
      model,
      stream: false,
      // Keep it tiny; we only need headers
      max_tokens: 8,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are a rate-limit probe. Return a tiny JSON object. Only output valid JSON.',
        },
        {
          role: 'user',
          content:
            'Reply with JSON: {"probe":"ok"}',
        },
      ],
      response_format: { type: 'json_object' },
      seed: 0,
      top_p: 1,
    })
    .withResponse();

  return { data, response };
}

async function probeCompatNoFormat(client, model) {
  // Probe 2 (fallback): no response_format at all; still minimal.
  const { data, response } = await client.chat.completions
    .create({
      model,
      stream: false,
      max_tokens: 1,
      temperature: 0,
      messages: [{ role: 'user', content: 'ping (respond with a single token)' }],
      seed: 0,
      top_p: 1,
    })
    .withResponse();

  return { data, response };
}

/**
 * Return current Cerebras rate-limit headers in a stable shape:
 * { ok, source:'cerebras', headers:{...}, http_status, model_used, usage?, error? }
 */
export async function getRateLimitStatus({
  apiKey = process.env.CEREBRAS_API_KEY,
  model = process.env.CEREBRAS_MODEL || 'llama3.1-8b',
} = {}) {
  if (!apiKey) {
    return { ok: false, source: 'cerebras', error: 'missing_api_key' };
    }
  const client = new Cerebras({ apiKey });

  // Try Probe 1 (with response_format + “JSON” in prompt)
  try {
    const { data, response } = await probeWithJsonFormat(client, model);
    const headers = parseRateLimitHeaders(response.headers);
    return {
      ok: true,
      source: 'cerebras',
      headers,
      model_used: model,
      http_status: response.status,
      usage: data?.usage ?? null,
      probe: 'json_format',
    };
  } catch (err1) {
    // Try Probe 2 (compat, no response_format)
    try {
      const { data, response } = await probeCompatNoFormat(client, model);
      const headers = parseRateLimitHeaders(response.headers);
      return {
        ok: true,
        source: 'cerebras',
        headers,
        model_used: model,
        http_status: response.status,
        usage: data?.usage ?? null,
        probe: 'no_format_fallback',
        note: `fallback due to: ${err1?.message || String(err1)}`,
      };
    } catch (err2) {
      const http_status =
        err2?.response?.status ??
        err1?.response?.status ??
        null;
      const headers =
        parseRateLimitHeaders(err2?.response?.headers) ||
        parseRateLimitHeaders(err1?.response?.headers) ||
        null;

      return {
        ok: false,
        source: 'cerebras',
        error: err2?.message || String(err2),
        http_status,
        headers,
        note: `initial error: ${err1?.message || String(err1)}`,
      };
    }
  }
}
