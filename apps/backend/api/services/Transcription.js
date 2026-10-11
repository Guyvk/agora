/**
 * Agora: turns a short piece of recorded speech into text.
 *
 * It talks to any service that understands the OpenAI "audio/transcriptions"
 * format. That includes Infomaniak AI Tools (Whisper, hosted in Switzerland),
 * OpenAI itself, and self-hosted Whisper servers.
 *
 * Settings (see .env.example):
 *   AGORA_TRANSCRIPTION_URL       full address of the transcriptions endpoint
 *   AGORA_TRANSCRIPTION_KEY       secret key for that service (optional for local servers)
 *   AGORA_TRANSCRIPTION_MODEL     model name, default "whisper-1"
 *   AGORA_TRANSCRIPTION_LANGUAGE  optional two-letter language, e.g. "en". Leave empty to detect.
 */

const TIMEOUT_MS = 120000

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

module.exports = {
  isConfigured: function () {
    return !!process.env.AGORA_TRANSCRIPTION_URL
  },

  /**
   * @param {object} args
   * @param {Buffer} args.audio      the recorded sound
   * @param {string} args.mimeType   e.g. "audio/webm;codecs=opus"
   * @param {number} [args.durationMs]
   * @returns {Promise<string>} the spoken words, or '' when nothing was said
   */
  transcribe: async function ({ audio, mimeType = 'audio/webm', durationMs }) {
    const url = process.env.AGORA_TRANSCRIPTION_URL
    if (!url) throw new Error('Transcription is not set up: AGORA_TRANSCRIPTION_URL is empty')

    const baseType = mimeType.split(';')[0]
    const form = new FormData()
    form.append('file', new Blob([audio], { type: baseType }), `speech.${extensionFor(baseType)}`)
    form.append('model', process.env.AGORA_TRANSCRIPTION_MODEL || 'whisper-1')
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
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Transcription service answered ${response.status}: ${body.slice(0, 300)}`)
    }

    const data = await response.json()
    const text = String(data.text || '').replace(/\s+/g, ' ').trim()

    // A very short clip that comes back as a stock phrase is almost always silence.
    if (durationMs && durationMs < 2500 && SILENCE_PHRASES.includes(text.toLowerCase())) return ''

    return text
  }
}
