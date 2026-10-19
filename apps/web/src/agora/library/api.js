/**
 * Agora: talks to the server part of the circle library
 * (apps/backend/api/controllers/AgoraLibraryController.js), and sends files.
 * Who may see or add what is checked there, not here.
 *
 * Sending a file follows the plan the server hands out:
 *   chunks     pieces of 8 MB to Agora's own server, one after another
 *   single     one PUT straight to object storage (S3), at a signed address
 *   multipart  parts straight to S3, each at its own signed address
 * When the browser cannot reach S3 (for example because the storage does not
 * allow this website yet), the file goes through Agora in pieces instead.
 */
const BASE = '/noo/agora/library'

export async function libraryApi (path, body, fetchImpl = fetch) {
  const options = { credentials: 'same-origin', headers: { 'X-Agora': '1', Accept: 'application/json' } }
  if (body !== undefined) {
    options.method = 'POST'
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const res = await fetchImpl(BASE + path, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || 'Something went wrong. Try again in a minute.')
    error.status = res.status
    throw error
  }
  return data
}

export const circlePath = (groupSlug, rest = '') => `/circles/${encodeURIComponent(groupSlug)}${rest}`

/**
 * Sends a body with progress. Resolves with { status, etag } for any answer,
 * and with status 0 when the request did not get through at all.
 */
export function sendWithProgress ({ method, url, body, headers = {}, onProgress, withCredentials = false }) {
  return new Promise(resolve => {
    const xhr = new window.XMLHttpRequest()
    xhr.open(method, url)
    xhr.withCredentials = withCredentials
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value))
    if (xhr.upload && onProgress) xhr.upload.onprogress = e => onProgress(e.loaded)
    xhr.onload = () => {
      let error = null
      try { error = JSON.parse(xhr.responseText).error } catch (e) {}
      resolve({ status: xhr.status, etag: xhr.getResponseHeader('ETag'), error })
    }
    xhr.onerror = () => resolve({ status: 0 })
    xhr.onabort = () => resolve({ status: 0 })
    xhr.send(body)
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Tries a send up to three times when the connection broke or the server had a hiccup. */
async function withRetries (fn, { tries = 3, wait = 1500 } = {}) {
  let result
  for (let i = 0; i < tries; i++) {
    result = await fn()
    if (result.status >= 200 && result.status < 300) return result
    if (result.status >= 400 && result.status < 500) return result
    if (i < tries - 1) await sleep(wait * (i + 1))
  }
  return result
}

class UploadError extends Error {}

function check (result, fallbackMessage) {
  if (result.status >= 200 && result.status < 300) return result
  throw new UploadError(result.error || fallbackMessage)
}

async function sendChunks ({ file, upload, report, send, wait }) {
  for (let i = 0; i < upload.chunkCount; i++) {
    const start = i * upload.chunkSize
    const piece = file.slice(start, Math.min(start + upload.chunkSize, file.size))
    const result = await withRetries(() => send({
      method: 'POST',
      url: `${BASE}/uploads/${upload.id}/chunk/${i}`,
      body: piece,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Agora': '1' },
      withCredentials: true,
      onProgress: loaded => report(start + loaded)
    }), { wait })
    check(result, 'A piece of the file did not arrive. Try again.')
    report(start + piece.size)
  }
}

/** Sends straight to S3. Resolves with the parts, or null when S3 could not be reached from this browser. */
async function sendToS3 ({ file, upload, report, send, api, wait }) {
  if (upload.mode === 'single') {
    const result = await withRetries(() => send({ method: 'PUT', url: upload.url, body: file, headers: upload.headers || {}, onProgress: report }), { wait })
    if (result.status === 0) return null
    check(result, 'The file did not arrive. Try again.')
    return []
  }
  const parts = []
  for (let first = 1; first <= upload.partCount; first += 20) {
    const numbers = []
    for (let n = first; n < first + 20 && n <= upload.partCount; n++) numbers.push(n)
    const { urls } = await api(`/uploads/${upload.id}/part-urls`, { parts: numbers })
    for (const n of numbers) {
      const start = (n - 1) * upload.partSize
      const piece = file.slice(start, Math.min(start + upload.partSize, file.size))
      const result = await withRetries(() => send({ method: 'PUT', url: urls[n], body: piece, onProgress: loaded => report(start + loaded) }), { wait })
      // Without its ETag a part cannot be put together; the storage then does not let this website read it.
      if (result.status === 0 || (result.status < 300 && !result.etag)) return null
      check(result, 'A part of the file did not arrive. Try again.')
      parts.push({ partNumber: n, etag: result.etag })
      report(start + piece.size)
    }
  }
  return parts
}

/**
 * Sends one file to a circle's library. Resolves with the id of the stored
 * file, to add to an item with createItem. onProgress gets a number from 0 to 1.
 */
export async function uploadFile ({ groupSlug, file, onProgress = () => {}, api = libraryApi, send = sendWithProgress, wait = 1500 }) {
  const report = loaded => onProgress(file.size ? Math.min(loaded / file.size, 1) : 1)
  let { upload } = await api(circlePath(groupSlug, '/uploads'), {
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size
  })
  let parts
  if (upload.mode === 'single' || upload.mode === 'multipart') {
    parts = await sendToS3({ file, upload, report, send, api, wait })
    if (parts === null) {
      report(0)
      upload = (await api(`/uploads/${upload.id}/relay`, {})).upload
    }
  }
  if (upload.mode === 'chunks') await sendChunks({ file, upload, report, send, wait })
  await api(`/uploads/${upload.id}/finish`, upload.mode === 'multipart' ? { parts } : {})
  onProgress(1)
  return upload.id
}

export function createItem (groupSlug, item, api = libraryApi) {
  return api(circlePath(groupSlug, '/items'), item)
}
