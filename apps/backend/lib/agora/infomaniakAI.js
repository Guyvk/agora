/**
 * Agora: talks to Infomaniak's AI Services (open models, hosted in
 * Switzerland) for the Ask tab: chat completions, embeddings and reranking.
 * It also estimates what each call costs and keeps a log of it, for the
 * monthly spend cap.
 *
 * Infomaniak's API, version 2 (developer.infomaniak.com, "AI Tools"):
 *   POST https://api.infomaniak.com/2/ai/<product id>/openai/v1/chat/completions   (OpenAI format, answers straight away)
 *   POST https://api.infomaniak.com/2/ai/<product id>/openai/v1/embeddings         (OpenAI format, at most 8192 tokens per text)
 *   POST https://api.infomaniak.com/2/ai/<product id>/cohere/v2/rerank             (Cohere format, with an OpenAI-style "usage")
 * One API token with the "ai-tools" scope works for all of them, and for
 * speech to text, so Agora reuses AGORA_TRANSCRIPTION_KEY.
 *
 * Settings (see .env.example and README-AGORA.md, "Ask"):
 *   AGORA_AI_KEY           the token. Default: AGORA_TRANSCRIPTION_KEY
 *   AGORA_AI_PRODUCT_ID    the AI Services product id. Default: the number in
 *                          AGORA_TRANSCRIPTION_URL (.../1/ai/<product id>/...)
 *   AGORA_AI_URL_BASE      default https://api.infomaniak.com/2/ai/<product id>/openai/v1
 *   AGORA_AI_RERANK_URL    default https://api.infomaniak.com/2/ai/<product id>/cohere/v2/rerank
 *   AGORA_ASK_MODEL        the model that writes answers (default below)
 *   AGORA_ASK_EMBED_MODEL  the embedding model (default below)
 *   AGORA_ASK_RERANK_MODEL the reranker, or "off" (default below)
 *   AGORA_ASK_MONTHLY_CAP  euros per calendar month for all of Ask (default 20)
 *   AGORA_AI_EUR_PER_CHF   exchange rate for the estimate (default 1.07)
 *   AGORA_ASK_PRICE_INPUT_CHF, AGORA_ASK_PRICE_OUTPUT_CHF  prices per million
 *                          tokens for a model that is not in the list below
 */

const TIMEOUT_MS = 90000
const EMBED_BATCH = 32

export const DEFAULT_CHAT_MODEL = 'mistralai/Mistral-Small-4-119B-2603'
export const DEFAULT_EMBED_MODEL = 'bge_multilingual_gemma2'
export const DEFAULT_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3'

/**
 * Infomaniak's prices in Swiss francs per million tokens, without VAT, from
 * https://www.infomaniak.com/en/hosting/ai-services/prices (read 19 October 2026).
 * Names are compared in lower case, without spaces, dashes or underscores.
 */
const PRICES_CHF = {
  'mistralai/mistral-small-4-119b-2603': { input: 0.20, output: 0.75 },
  'mistralai/ministral-3-14b-instruct-2512': { input: 0.30, output: 0.40 },
  'google/gemma-4-31b-it': { input: 0.20, output: 0.40 },
  'qwen/qwen3.5-122b-a10b-fp8': { input: 0.40, output: 3.20 },
  'qwen/qwen3.5-397b-a17b-fp8': { input: 0.80, output: 3.60 },
  'moonshotai/kimi-k2.6': { input: 0.60, output: 3.00 },
  'swiss-ai/apertus-v1.5-70b': { input: 0.70, output: 2.50 },
  bge_multilingual_gemma2: { input: 0.065, output: 0 },
  'qwen/qwen3-embedding-8b': { input: 0.07, output: 0 },
  all_minilm_l12_v2: { input: 0, output: 0 },
  'baai/bge-reranker-v2-m3': { input: 0.01, output: 0 },
  'qwen/qwen3-reranker-0.6b': { input: 0.009, output: 0 }
}
// When a model is not in the list: the price of the dearest model above, so the cap errs on the safe side.
const UNKNOWN_PRICE_CHF = { input: 0.80, output: 3.60 }

export class AIError extends Error {
  constructor (message, status) {
    super(message)
    this.status = status
  }
}

const knex = () => bookshelf.knex
const env = name => (process.env[name] || '').trim()

let fetchForTests = null
/** Tests hand in a pretend fetch, so Infomaniak is never called. null puts the real one back. */
export function useFetchForTests (fn) {
  fetchForTests = fn
}
const doFetch = (...args) => (fetchForTests || fetch)(...args)

/* ----------------------------------------------------------------------- */
/* Settings                                                                 */
/* ----------------------------------------------------------------------- */

export function apiKey () {
  return env('AGORA_AI_KEY') || env('AGORA_TRANSCRIPTION_KEY')
}

export function productId () {
  if (env('AGORA_AI_PRODUCT_ID')) return env('AGORA_AI_PRODUCT_ID')
  const match = env('AGORA_TRANSCRIPTION_URL').match(/api\.infomaniak\.com\/\d+\/ai\/(\d+)\//)
  return match ? match[1] : ''
}

export function urlBase () {
  if (env('AGORA_AI_URL_BASE')) return env('AGORA_AI_URL_BASE').replace(/\/+$/, '')
  const id = productId()
  return id ? `https://api.infomaniak.com/2/ai/${id}/openai/v1` : ''
}

export function rerankUrl () {
  if (env('AGORA_AI_RERANK_URL')) return env('AGORA_AI_RERANK_URL')
  if (env('AGORA_AI_URL_BASE')) return '' // another service: no reranking unless its address is given
  const id = productId()
  return id ? `https://api.infomaniak.com/2/ai/${id}/cohere/v2/rerank` : ''
}

export function chatModel () { return env('AGORA_ASK_MODEL') || DEFAULT_CHAT_MODEL }
export function embedModel () { return env('AGORA_ASK_EMBED_MODEL') || DEFAULT_EMBED_MODEL }
export function rerankModel () {
  const value = env('AGORA_ASK_RERANK_MODEL')
  if (value.toLowerCase() === 'off') return ''
  return value || DEFAULT_RERANK_MODEL
}

/** True when Agora knows where Infomaniak's AI is and has a key for it. */
export function isConfigured () {
  return !!(urlBase() && apiKey())
}

export function monthlyCapEur () {
  const value = Number(env('AGORA_ASK_MONTHLY_CAP'))
  return Number.isFinite(value) && env('AGORA_ASK_MONTHLY_CAP') !== '' ? Math.max(0, value) : 20
}

function eurPerChf () {
  const value = Number(env('AGORA_AI_EUR_PER_CHF'))
  return Number.isFinite(value) && value > 0 ? value : 1.07
}

/* ----------------------------------------------------------------------- */
/* Cost                                                                     */
/* ----------------------------------------------------------------------- */

function priceKey (model) {
  return String(model || '').toLowerCase().replace(/\s+/g, '')
}

export function pricesFor (model) {
  const known = PRICES_CHF[priceKey(model)]
  if (known) return known
  const input = Number(env('AGORA_ASK_PRICE_INPUT_CHF'))
  const output = Number(env('AGORA_ASK_PRICE_OUTPUT_CHF'))
  if (env('AGORA_ASK_PRICE_INPUT_CHF') && Number.isFinite(input)) {
    return { input, output: Number.isFinite(output) ? output : 0 }
  }
  return UNKNOWN_PRICE_CHF
}

/** The estimated cost in euros of a call with these token counts. */
export function costEur (model, inputTokens = 0, outputTokens = 0) {
  const price = pricesFor(model)
  const chf = (inputTokens * price.input + outputTokens * price.output) / 1e6
  return Math.round(chf * eurPerChf() * 1e6) / 1e6
}

/** Writes one call into agora_ask_usage. Never fails the caller. */
export async function recordUsage ({ userId = null, groupId = null, kind, model, inputTokens = 0, outputTokens = 0 }) {
  try {
    await knex()('agora_ask_usage').insert({
      user_id: userId,
      group_id: groupId,
      kind,
      model,
      input_tokens: Math.max(0, Math.round(inputTokens || 0)),
      output_tokens: Math.max(0, Math.round(outputTokens || 0)),
      cost_eur: costEur(model, inputTokens, outputTokens),
      created_at: new Date()
    })
  } catch (err) {
    if (typeof sails !== 'undefined') sails.log.error(`Agora Ask: could not log usage: ${err.message}`)
  }
}

/** Euros spent on Ask (answers, embeddings, reranking and themes) in this calendar month. */
export async function spentThisMonthEur (now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const row = await knex()('agora_ask_usage').where('created_at', '>=', start).sum('cost_eur as total').first()
  return Number((row && row.total) || 0)
}

export async function capReached (now = new Date()) {
  return (await spentThisMonthEur(now)) >= monthlyCapEur()
}

/* ----------------------------------------------------------------------- */
/* Calls                                                                    */
/* ----------------------------------------------------------------------- */

/** Infomaniak's v1 routes sometimes wrap the answer as { result: 'success', data: {...} }. */
function unwrap (body) {
  if (body && body.result === 'success' && body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    return body.data
  }
  return body
}

async function post (url, body) {
  if (!url || !apiKey()) throw new AIError('Infomaniak AI is not set up', 503)
  let response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    throw new AIError(`Infomaniak AI could not be reached: ${err.message}`, 502)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    // Never pass the key on: the answer of the service only, cut short.
    throw new AIError(`Infomaniak AI answered ${response.status}: ${text.slice(0, 300)}`, response.status)
  }
  return unwrap(await response.json())
}

/**
 * Asks a chat model. Thinking is switched off (reasoning_effort "none"):
 * answers come faster and cost less. A model that does not take that
 * setting is asked again without it.
 * @returns {Promise<{ text: string, inputTokens: number, outputTokens: number, model: string }>}
 */
export async function chat ({ messages, model = chatModel(), maxTokens = 800, temperature = 0.2 }) {
  const url = `${urlBase()}/chat/completions`
  const body = { model, messages, max_completion_tokens: maxTokens, temperature, reasoning_effort: 'none' }
  let data
  try {
    data = await post(url, body)
  } catch (err) {
    if (!(err instanceof AIError) || ![400, 422].includes(err.status)) throw err
    // The plainest OpenAI form, for a model that does not take the newer settings
    data = await post(url, { model, messages, max_tokens: maxTokens, temperature })
  }
  const choice = data && Array.isArray(data.choices) && data.choices[0]
  const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : null
  if (text == null) throw new AIError('Infomaniak AI answered without text', 502)
  const usage = data.usage || {}
  return {
    text: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
    inputTokens: Number(usage.prompt_tokens) || 0,
    outputTokens: Number(usage.completion_tokens) || 0,
    model: data.model || model
  }
}

/**
 * Turns texts into embeddings, in batches.
 * @returns {Promise<{ vectors: number[][], tokens: number, model: string }>}
 */
export async function embed (texts, model = embedModel()) {
  const vectors = []
  let tokens = 0
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH)
    const data = await post(`${urlBase()}/embeddings`, { model, input: batch, encoding_format: 'float' })
    const rows = Array.isArray(data && data.data) ? data.data.slice() : []
    rows.sort((a, b) => (a.index || 0) - (b.index || 0))
    if (rows.length !== batch.length) throw new AIError('Infomaniak AI answered with the wrong number of embeddings', 502)
    for (const row of rows) {
      if (!Array.isArray(row.embedding)) throw new AIError('Infomaniak AI answered without an embedding', 502)
      vectors.push(row.embedding.map(Number))
    }
    tokens += Number(data.usage && (data.usage.total_tokens || data.usage.prompt_tokens)) || 0
  }
  return { vectors, tokens, model }
}

/**
 * Orders documents by how well they answer the query.
 * @returns {Promise<{ order: Array<{ index: number, score: number }>, tokens: number, model: string }>}
 */
export async function rerank (query, documents, { topN, model = rerankModel() } = {}) {
  const data = await post(rerankUrl(), { model, query, documents, top_n: topN || documents.length, max_tokens_per_doc: 1024 })
  const results = Array.isArray(data && data.results) ? data.results : []
  return {
    order: results.map(r => ({ index: Number(r.index), score: Number(r.relevance_score) || 0 }))
      .filter(r => Number.isInteger(r.index) && r.index >= 0 && r.index < documents.length),
    tokens: Number(data.usage && data.usage.total_tokens) || 0,
    model
  }
}

export default {
  AIError,
  useFetchForTests,
  apiKey,
  productId,
  urlBase,
  rerankUrl,
  chatModel,
  embedModel,
  rerankModel,
  isConfigured,
  monthlyCapEur,
  pricesFor,
  costEur,
  recordUsage,
  spentThisMonthEur,
  capReached,
  chat,
  embed,
  rerank,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  DEFAULT_RERANK_MODEL
}
