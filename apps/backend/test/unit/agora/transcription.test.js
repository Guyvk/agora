/* eslint-env mocha */
/**
 * Agora: speech to text, with a pretend service. Needs no database.
 *
 *   cd apps/backend
 *   npx mocha -r @babel/register test/unit/agora/transcription.test.js
 */
const { expect } = require('chai')
const Transcription = require('../../../api/services/Transcription')

const INFOMANIAK = 'https://api.infomaniak.com/1/ai/2569/openai/audio/transcriptions'
const NAMES = ['AGORA_TRANSCRIPTION_URL', 'AGORA_TRANSCRIPTION_KEY', 'AGORA_TRANSCRIPTION_MODEL', 'AGORA_TRANSCRIPTION_LANGUAGE']

function answer (status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

describe('Agora speech to text', function () {
  this.timeout(20000)
  let saved, calls

  beforeEach(() => {
    saved = { fetch: global.fetch }
    NAMES.forEach(name => { saved[name] = process.env[name]; delete process.env[name] })
    calls = []
  })

  afterEach(() => {
    global.fetch = saved.fetch
    NAMES.forEach(name => {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    })
  })

  it('counts an Infomaniak address without a key as not connected', () => {
    process.env.AGORA_TRANSCRIPTION_URL = INFOMANIAK
    expect(Transcription.isConfigured()).to.equal(false)
    process.env.AGORA_TRANSCRIPTION_KEY = 'test'
    expect(Transcription.isConfigured()).to.equal(true)
  })

  it('accepts a local Whisper server without a key', () => {
    process.env.AGORA_TRANSCRIPTION_URL = 'http://localhost:9000/v1/audio/transcriptions'
    expect(Transcription.isConfigured()).to.equal(true)
  })

  it('finds where Infomaniak keeps the result', () => {
    expect(Transcription.resultsUrlFor(INFOMANIAK, 'abc-1'))
      .to.equal('https://api.infomaniak.com/1/ai/2569/results/abc-1')
  })

  it('reads the text from a result in either shape', () => {
    expect(Transcription.textFromResult('{"text": " Hello there."}')).to.equal(' Hello there.')
    expect(Transcription.textFromResult('Hello there.\n')).to.equal('Hello there.\n')
    expect(Transcription.textFromResult(null)).to.equal('')
  })

  it('takes the text straight away from an OpenAI-style service', async () => {
    process.env.AGORA_TRANSCRIPTION_URL = 'http://localhost:9000/v1/audio/transcriptions'
    global.fetch = async (url, request) => {
      calls.push({ url, request })
      return answer(200, { text: ' We agree. ' })
    }
    const text = await Transcription.transcribe({ audio: Buffer.alloc(500), mimeType: 'audio/webm;codecs=opus', durationMs: 4000 })
    expect(text).to.equal('We agree.')
    expect(calls).to.have.length(1)
    expect(calls[0].request.body.get('model')).to.equal('whisper-1')
    expect(calls[0].request.body.get('file').name).to.equal('speech.webm')
  })

  it('waits for an Infomaniak batch and then reads its text', async () => {
    process.env.AGORA_TRANSCRIPTION_URL = INFOMANIAK
    process.env.AGORA_TRANSCRIPTION_KEY = 'test'
    let polls = 0
    global.fetch = async (url, request = {}) => {
      calls.push({ url, request })
      if (url === INFOMANIAK) return answer(200, { batch_id: 'b-42' })
      polls += 1
      if (polls === 1) return answer(200, { status: 'processing', url: null, data: null })
      return answer(200, { status: 'success', file_name: 'transcription_b-42.json', data: '{"text": " Lars will write the proposal."}' })
    }
    const text = await Transcription.transcribe({ audio: Buffer.alloc(500), mimeType: 'audio/mp4', durationMs: 5000 })
    expect(text).to.equal('Lars will write the proposal.')
    expect(calls[0].request.body.get('model')).to.equal('whisper')
    expect(calls[0].request.body.get('file').name).to.equal('speech.m4a')
    expect(calls[0].request.headers.Authorization).to.equal('Bearer test')
    expect(calls[1].url).to.equal('https://api.infomaniak.com/1/ai/2569/results/b-42')
    expect(calls[1].request.headers.Authorization).to.equal('Bearer test')
  })

  it('fails loudly when a batch fails, so the queue tries again', async () => {
    process.env.AGORA_TRANSCRIPTION_URL = INFOMANIAK
    process.env.AGORA_TRANSCRIPTION_KEY = 'test'
    global.fetch = async url => url === INFOMANIAK
      ? answer(200, { batch_id: 'b-43' })
      : answer(200, { status: 'failed', data: null })
    let error = null
    try {
      await Transcription.transcribe({ audio: Buffer.alloc(500), mimeType: 'audio/webm', durationMs: 5000 })
    } catch (err) { error = err }
    expect(error && error.message).to.contain('failed')
  })

  it('never takes an answer it does not understand for silence', async () => {
    process.env.AGORA_TRANSCRIPTION_URL = 'http://localhost:9000/v1/audio/transcriptions'
    global.fetch = async () => answer(200, { something: 'else' })
    let error = null
    try {
      await Transcription.transcribe({ audio: Buffer.alloc(500), mimeType: 'audio/webm', durationMs: 5000 })
    } catch (err) { error = err }
    expect(error && error.message).to.contain('without text or batch_id')
  })
})
