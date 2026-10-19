/**
 * Agora: turns a short piece of recorded speech into text.
 *
 * It talks to any service that understands the OpenAI "audio/transcriptions"
 * format. That includes Infomaniak AI Tools (Whisper, hosted in Switzerland),
 * OpenAI itself, and self-hosted Whisper servers.
 *
 * Most services answer with the text straight away. Infomaniak does not: it
 * answers with a batch_id, and the text is fetched a moment later from
 * /1/ai/<product id>/results/<batch_id>. Both ways are handled here.
 * See https://developer.infomaniak.com/docs/api/post/1/ai/%7Bproduct_id%7D/openai/audio/transcriptions
 *
 * Settings (see .env.example):
 *   AGORA_TRANSCRIPTION_URL       full address of the transcriptions endpoint. For Infomaniak:
 *                                 https://api.infomaniak.com/1/ai/<product id>/openai/audio/transcriptions
 *   AGORA_TRANSCRIPTION_KEY       secret key for that service (optional for local servers, needed for Infomaniak)
 *   AGORA_TRANSCRIPTION_MODEL     model name. Default "whisper" for Infomaniak, "whisper-1" otherwise.
 *   AGORA_TRANSCRIPTION_LANGUAGE  optional two-letter language, e.g. "en". Leave empty to detect.
 */

const TIMEOUT_MS = 120000
const POLL_EVERY_MS = 1500

// Whisper tends to invent these when it hears near-silence.
const SILENCE_PHRASES = [
  'thank you.', 'thanks for watching!', 'thank you for watching.', 'you', 'bye.', '.', '...'
]

function extensionFor (mimeType = '') {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) return 'm4a'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  return 'webm'
}

function isInfomaniak (url = '') {
  return /(^|\/\/)api\.infomaniak\.com\//.test(url)
}

function defaultModel (url) {
  return isInfomaniak(url) ? 'whisper' : 'whisper-1'
}

/**
 * Where Infomaniak keeps the result of a batch:
 *   .../1/ai/<product id>/openai/audio/transcriptions  ->  .../1/ai/<product id>/results/<batch id>
 */
function resultsUrlFor (url, batchId) {
  const base = url.replace(/\/+$/, '')
  if (!/\/openai\/audio\/transcriptions$/.test(base)) {
    throw new Error('The transcription service answered with a batch_id, but Agora cannot tell where to fetch the result from this AGORA_TRANSCRIPTION_URL')
  }
  return base.replace(/\/openai\/audio\/transcriptions$/, `/results/${encodeURIComponent(batchId)}`)
}

/** Infomaniak's v1 routes sometimes wrap the answer as { result: 'success', data: {...} }. */
function unwrap (body) {
  if (body && body.result === 'success' && body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    return body.data
  }
  return body
}

/**
 * The finished result holds the transcript in "data": a JSON string like
 * '{"text": "..."}' when response_format is json, or the plain text otherwise.
 */
function textFromResult (data) {
  if (data == null) return ''
  if (Array.isArray(data)) return data.map(textFromResult).join(' ')
  if (typeof data === 'object') return String(data.text || '')
  const value = String(data)
  if (value.trim().startsWith('{')) {
    try {
      return String(JSON.parse(value).text || '')
    } catch (e) {
      // not JSON after all: use it as it is
    }
  }
  return value
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function fetchBatchResult ({ url, batchId, headers, deadline, timeoutMs = TIMEOUT_MS }) {
  const resultsUrl = resultsUrlFor(url, batchId)
  while (Date.now() < deadline) {
    await wait(POLL_EVERY_MS)
    const response = await fetch(resultsUrl, {
      headers,
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now()))
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Transcription result answered ${response.status}: ${body.slice(0, 300)}`)
    }
    const job = unwrap(await response.json())
    const status = job && job.status
    if (status === 'success') return textFromResult(job.data)
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Transcription batch ${batchId} ${status}`)
    }
    // pending or processing: ask again
  }
  throw new Error(`Transcription batch ${batchId} was not ready within ${timeoutMs / 1000} seconds`)
}

module.exports = {
  /**
   * True when speech to text can work. Infomaniak always needs a key, so a
   * missing key there counts as not set up, and the room says notes are off
   * instead of recording speech that can never be turned into text.
   */
  isConfigured: function () {
    const url = process.env.AGORA_TRANSCRIPTION_URL
    if (!url) return false
    if (isInfomaniak(url) && !process.env.AGORA_TRANSCRIPTION_KEY) return false
    return true
  },

  resultsUrlFor,
  textFromResult,

  /**
   * @param {object} args
   * @param {Buffer} args.audio      the recorded sound
   * @param {string} args.mimeType   e.g. "audio/webm;codecs=opus"
   * @param {number} [args.durationMs]
   * @param {number} [args.timeoutMs] how long to wait in all, default 2 minutes. The
   *                                  library sends pieces of up to 10 minutes and waits longer.
   * @returns {Promise<string>} the spoken words, or '' when nothing was said
   */
  transcribe: async function ({ audio, mimeType = 'audio/webm', durationMs, timeoutMs = TIMEOUT_MS }) {
    const url = process.env.AGORA_TRANSCRIPTION_URL
    if (!url) throw new Error('Transcription is not set up: AGORA_TRANSCRIPTION_URL is empty')
    const deadline = Date.now() + timeoutMs

    const baseType = mimeType.split(';')[0]
    const form = new FormData()
    form.append('file', new Blob([audio], { type: baseType }), `speech.${extensionFor(baseType)}`)
    form.append('model', process.env.AGORA_TRANSCRIPTION_MODEL || defaultModel(url))
    form.append('response_format', 'json')
    if (process.env.AGORA_TRANSCRIPTION_LANGUAGE) {
      form.append('language', process.env.AGORA_TRANSCRIPTION_LANGUAGE)
    }

    const headers = {}
    if (process.env.AGORA_TRANSCRIPTION_KEY) {
      headers.Authorization = `Bearer ${process.env.AGORA_TRANSCRIPTION_KEY}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Transcription service answered ${response.status}: ${body.slice(0, 300)}`)
    }

    const data = unwrap(await response.json())
    let raw
    if (data && typeof data.text === 'string') {
      raw = data.text
    } else if (data && data.batch_id) {
      raw = await fetchBatchResult({ url, batchId: data.batch_id, headers, deadline, timeoutMs })
    } else {
      // Never treat an answer we do not understand as silence: that would lose speech without a trace.
      throw new Error(`Transcription service answered without text or batch_id: ${JSON.stringify(data).slice(0, 300)}`)
    }

    const text = String(raw || '').replace(/\s+/g, ' ').trim()

    // A very short clip that comes back as a stock phrase is almost always silence.
    if (durationMs && durationMs < 2500 && SILENCE_PHRASES.includes(text.toLowerCase())) return ''

    return text
  }
}
