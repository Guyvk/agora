/**
 * Agora: every call to Infomaniak kDrive goes through this file, and only
 * this file holds the access key.
 *
 * 7BP keeps its files in kDrive (1000 GB at Infomaniak, Switzerland). Agora
 * reaches it with an API token that Guy makes in the Infomaniak Manager (see
 * "Files in kDrive" in README-AGORA.md). Which folder belongs to which circle,
 * and who may do what, is decided in lib/agora/kdriveCircles.js. This file
 * only talks to kDrive.
 *
 * Settings, in apps/backend/.env:
 *   AGORA_KDRIVE_TOKEN           the API token, with the "drive" scope. Secret.
 *   AGORA_KDRIVE_DRIVE_ID        the number of 7BP's kDrive, from its web address
 *   AGORA_KDRIVE_ROOT_FOLDER_ID  the folder that holds Agora's circle folders (required)
 *   AGORA_KDRIVE_MAX_UPLOAD_MB   optional: the largest file a member may add, 100 by default
 *
 * The calls used, all on https://api.infomaniak.com with the header
 * "Authorization: Bearer <token>" (developer.infomaniak.com, "kDrive"):
 *   GET    /3/drive/{drive}/files/{id}                   details of a file or folder
 *   GET    /3/drive/{drive}/files/{id}/files             what is in a folder (cursor pages)
 *   GET    /3/drive/{drive}/files/{id}/name?name=        a file or folder in a folder, by name
 *   POST   /3/drive/{drive}/files/{id}/directory         makes a folder
 *   POST   /3/drive/{drive}/upload                       adds a file in one go (up to 1 GB)
 *   POST   /3/drive/{drive}/upload/session/start         starts an upload in pieces
 *   POST   {upload_url}/3/drive/{drive}/upload/session/{token}/chunk   one piece
 *   POST   /3/drive/{drive}/upload/session/{token}/finish             saves the file
 *   DELETE /3/drive/{drive}/upload/session/{token}       cancels an upload in pieces
 *   GET    /2/drive/{drive}/files/{id}/download          the contents of a file
 *   POST   /2/drive/{drive}/files/{id}/rename            renames
 *   POST   /3/drive/{drive}/files/{id}/move/{folder}     moves into another folder
 *   DELETE /2/drive/{drive}/files/{id}                   moves to kDrive's bin
 *
 * kDrive limits how many calls a token may make (about 60 a minute, according
 * to others who use it; Infomaniak's pages do not give a number). Agora makes
 * at most RATE_PER_MINUTE calls a minute from each program (the website and
 * the worker), and waits and tries again when kDrive answers 429 (too many).
 *
 * The token is only ever sent to Infomaniak's own addresses, and never
 * appears in an error, a log line or an answer to the browser.
 */
const https = require('https')
const crypto = require('crypto')

const API_HOST = 'api.infomaniak.com'
const RATE_PER_MINUTE = 50
const MAX_WAIT_MS = 60000
const MAX_TRIES = 4
// Files up to this size go to kDrive in one call. kDrive suggests one call
// below 100 MB; bigger ones go in pieces, so Agora never holds more than one
// piece in memory.
const DIRECT_LIMIT = 64 * 1024 * 1024
// kDrive wants pieces of at least 1,000,000 bytes, except the last one.
const CHUNK_SIZE = 16 * 1024 * 1024
const MAX_LIST_PAGES = 20
const MAX_JSON_BYTES = 5 * 1024 * 1024
const NOT_HERE = 'This file or folder is not part of this circle.'

class KdriveError extends Error {
  constructor (code, message, status) {
    super(message)
    this.code = code
    this.status = status || null
  }
}

/* ----------------------------------------------------------------------- */
/* Settings                                                                 */
/* ----------------------------------------------------------------------- */

function token () {
  return String(process.env.AGORA_KDRIVE_TOKEN || '').trim()
}

function driveId () {
  const value = String(process.env.AGORA_KDRIVE_DRIVE_ID || '').trim()
  return /^\d{1,12}$/.test(value) ? value : null
}

/** A kDrive file or folder number, as text, or null. */
function idFrom (value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return /^\d{1,15}$/.test(text) && Number(text) > 0 ? text : null
}

function rootFolderSetting () {
  return idFrom(process.env.AGORA_KDRIVE_ROOT_FOLDER_ID)
}

/** True when the token, the drive number and the top folder are set: then the Files pages use kDrive. */
function isConfigured () {
  return Boolean(token() && driveId() && rootFolderSetting())
}

/** True when the token and drive number are there but the required top folder is not. */
function missingTopFolder () {
  return Boolean(token() && driveId() && !rootFolderSetting())
}

/** The largest file a member may add, in bytes. */
function maxUploadBytes () {
  const mb = Number(process.env.AGORA_KDRIVE_MAX_UPLOAD_MB)
  return Math.round((mb > 0 ? mb : 100) * 1024 * 1024)
}

/* ----------------------------------------------------------------------- */
/* Pacing: at most RATE_PER_MINUTE calls in any minute                      */
/* ----------------------------------------------------------------------- */

const pacing = { perMinute: RATE_PER_MINUTE, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), sent: [] }

/** For tests: other limits, and a sleep that does not really wait. */
function setPacing ({ perMinute, sleep } = {}) {
  pacing.perMinute = perMinute || RATE_PER_MINUTE
  pacing.sleep = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  pacing.sent = []
}

async function waitForTurn () {
  for (;;) {
    const now = Date.now()
    while (pacing.sent.length && pacing.sent[0] <= now - 60000) pacing.sent.shift()
    if (pacing.sent.length < pacing.perMinute) {
      pacing.sent.push(now)
      return
    }
    await pacing.sleep(Math.min(MAX_WAIT_MS, pacing.sent[0] + 60000 - now + 5))
  }
}

/** How long to wait after a 429: what kDrive asks for (at most 30 seconds), or 1, 2, 4 seconds. */
function retryDelay (res, attempt) {
  const asked = Number(res.headers['retry-after'])
  if (Number.isFinite(asked) && asked >= 0) return Math.min(asked, 30) * 1000
  return 1000 * 2 ** (attempt - 1)
}

/* ----------------------------------------------------------------------- */
/* Talking to kDrive                                                        */
/* ----------------------------------------------------------------------- */

/** Only Infomaniak's own https addresses ever get the token. */
function isInfomaniak (url) {
  return url.protocol === 'https:' && (url.hostname === 'infomaniak.com' || url.hostname.endsWith('.infomaniak.com'))
}

/**
 * Where kDrive hands out the contents of a file (since October 2026, for
 * example 1-16-v3-12.download.kdrive.infomaniakusercontent.com). Its links
 * are signed, so they work without the token, and never get it.
 */
function isInfomaniakDownload (url) {
  return url.protocol === 'https:' && url.hostname.endsWith('.infomaniakusercontent.com')
}

/**
 * Sends one request and answers with the response, unread. body is a Buffer,
 * a string, a readable stream or null.
 */
function send (method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const all = { ...headers }
    if (isInfomaniak(url)) all.authorization = `Bearer ${token()}`
    const req = https.request(url, { method, headers: all }, resolve)
    let bodyFailed = null
    req.setTimeout(10 * 60 * 1000, () => req.destroy(new Error('kDrive took too long to answer')))
    req.on('error', err => reject(bodyFailed || new KdriveError('network', `kDrive could not be reached (${err.code || 'network error'}).`)))
    if (body && typeof body.pipe === 'function') {
      if (body.errored || body.destroyed) {
        req.destroy()
        return reject(new KdriveError('bad_request', body.errored && /larger than it said/.test(body.errored.message) ? 'The file is larger than it said.' : 'The file stopped arriving before it was complete.'))
      }
      body.on('error', err => {
        bodyFailed = new KdriveError('bad_request', /larger than it said/.test(err.message) ? 'The file is larger than it said.' : 'The file stopped arriving before it was complete.')
        req.destroy(err)
      })
      body.pipe(req)
    } else {
      req.end(body || undefined)
    }
  })
}

/** Reads a response as JSON, up to MAX_JSON_BYTES. Anything else becomes {}. */
async function readJson (res) {
  const parts = []
  let length = 0
  for await (const part of res) {
    length += part.length
    if (length > MAX_JSON_BYTES) {
      res.destroy()
      return {}
    }
    parts.push(part)
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch (e) {
    return {}
  }
}

function drain (res) {
  res.resume()
}

/** kDrive's own error code, cleaned so it is safe to show and log. */
function errorCode (body) {
  const code = body && body.error && (body.error.code || body.error)
  return typeof code === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(code) ? code : null
}

/** Turns a refusal by kDrive into an error people can act on. */
function errorFor (status, body) {
  const code = errorCode(body)
  if (status === 401) {
    return new KdriveError('login', 'kDrive refused Agora\'s access key. An administrator makes a new token, see "Files in kDrive" in README-AGORA.md.', status)
  }
  if (status === 404 || code === 'object_not_found' || code === 'file_not_found') return new KdriveError('not_found', NOT_HERE, status)
  if (status === 409 || (code && /conflict|already_exist/i.test(code))) {
    return new KdriveError('conflict', 'Something with this name is already there.', status)
  }
  if (status === 403) {
    return new KdriveError('forbidden', 'kDrive does not let Agora do this. Check that the token has the "drive" scope and that its account may use this kDrive and folder.', status)
  }
  if (status === 429) return new KdriveError('rate_limited', 'kDrive is busy. Try again in a minute.', status)
  if (status === 507 || (code && /quota|storage_full|not_enough_space/i.test(code))) {
    return new KdriveError('no_storage', 'kDrive is full. An administrator makes room or buys more space.', status)
  }
  if (status >= 400 && status < 500) {
    return new KdriveError('bad_request', `kDrive refused this${code ? ` (${code})` : ''}.`, status)
  }
  return new KdriveError('kdrive', `kDrive answered with an error (${status}${code ? `, ${code}` : ''}).`, status)
}

function apiUrl (path, query) {
  const url = new URL(`https://${API_HOST}${path}`)
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value))
  }
  return url
}

function drivePath (version, rest) {
  if (!isConfigured()) throw new KdriveError('not_configured', 'kDrive is not connected to Agora yet.')
  return `/${version}/drive/${driveId()}${rest}`
}

/**
 * One call to kDrive that answers with JSON. A body that can be sent again
 * (JSON, a Buffer) is sent again after a 429; a stream cannot be, so a 429
 * while streaming is an error.
 * Answers kDrive's whole answer: { result, data, cursor, has_more, ... }.
 */
async function call (method, url, { json, body, headers = {} } = {}) {
  const replayable = !(body && typeof body.pipe === 'function')
  const sendHeaders = { accept: 'application/json', ...headers }
  let payload = body || null
  if (json !== undefined) {
    payload = Buffer.from(JSON.stringify(json))
    sendHeaders['content-type'] = 'application/json'
  }
  if (Buffer.isBuffer(payload)) sendHeaders['content-length'] = String(payload.length)

  for (let attempt = 1; ; attempt++) {
    await waitForTurn()
    const res = await send(method, url, { headers: sendHeaders, body: payload })
    if (res.statusCode === 429 && replayable && attempt < MAX_TRIES) {
      drain(res)
      await pacing.sleep(retryDelay(res, attempt))
      continue
    }
    const answer = await readJson(res)
    if (res.statusCode >= 400 || answer.result === 'error') throw errorFor(res.statusCode >= 400 ? res.statusCode : 400, answer)
    return answer
  }
}

/* ----------------------------------------------------------------------- */
/* Files and folders                                                        */
/* ----------------------------------------------------------------------- */

/** Details of a file or folder: { id, name, type: "dir"|"file", status, parent_id, size, ... }. */
async function fileInfo (id) {
  const fileId = idFrom(id)
  if (!fileId) throw new KdriveError('not_found', NOT_HERE)
  return (await call('GET', apiUrl(drivePath(3, `/files/${fileId}`)))).data
}

/** Everything directly inside a folder, all pages of it. */
async function listFolder (id) {
  const folderId = idFrom(id)
  if (!folderId) throw new KdriveError('not_found', NOT_HERE)
  const items = []
  let cursor = null
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const answer = await call('GET', apiUrl(drivePath(3, `/files/${folderId}/files`), { limit: 1000, cursor }))
    items.push(...(Array.isArray(answer.data) ? answer.data : []))
    if (!answer.has_more || !answer.cursor) break
    cursor = answer.cursor
  }
  return items
}

/** The file or folder with this exact name in a folder, or null. */
async function childByName (parentId, name) {
  const folderId = idFrom(parentId)
  if (!folderId) throw new KdriveError('not_found', NOT_HERE)
  try {
    const answer = await call('GET', apiUrl(drivePath(3, `/files/${folderId}/name`), { name }))
    return answer.data || null
  } catch (err) {
    if (err.code === 'not_found') return null
    throw err
  }
}

/** Makes a folder in a folder. Answers its details. */
async function createDirectory (parentId, name) {
  const folderId = idFrom(parentId)
  if (!folderId) throw new KdriveError('not_found', NOT_HERE)
  return (await call('POST', apiUrl(drivePath(3, `/files/${folderId}/directory`)), { json: { name } })).data
}

async function rename (id, name) {
  const fileId = idFrom(id)
  if (!fileId) throw new KdriveError('not_found', NOT_HERE)
  await call('POST', apiUrl(drivePath(2, `/files/${fileId}/rename`)), { json: { name } })
}

/** Moves a file or folder into another folder. Answers nothing. The caller checks that the name is free first. */
async function move (id, destinationId) {
  const fileId = idFrom(id)
  const folderId = idFrom(destinationId)
  if (!fileId || !folderId) throw new KdriveError('not_found', NOT_HERE)
  await call('POST', apiUrl(drivePath(3, `/files/${fileId}/move/${folderId}`)))
}

/** Moves a file or folder to kDrive's bin, where it can be put back for a while. */
async function trash (id) {
  const fileId = idFrom(id)
  if (!fileId) throw new KdriveError('not_found', NOT_HERE)
  await call('DELETE', apiUrl(drivePath(2, `/files/${fileId}`)))
}

/**
 * Opens the contents of a file. Answers the response, a readable stream, for
 * the caller to pass on; kDrive may first send Agora on to another of its
 * addresses (a 302), which is followed here, never by the browser.
 */
async function openDownload (id) {
  const fileId = idFrom(id)
  if (!fileId) throw new KdriveError('not_found', NOT_HERE)
  let url = apiUrl(drivePath(2, `/files/${fileId}/download`))
  for (let hop = 0, attempt = 1; hop < 4;) {
    await waitForTurn()
    const res = await send('GET', url)
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      drain(res)
      const next = new URL(res.headers.location, url)
      // Only on to Infomaniak's own https addresses.
      if (!isInfomaniak(next) && !isInfomaniakDownload(next)) throw new KdriveError('kdrive', 'Something went wrong with kDrive. Try again in a minute.')
      url = next
      hop++
      continue
    }
    if (res.statusCode === 429 && attempt < MAX_TRIES) {
      drain(res)
      await pacing.sleep(retryDelay(res, attempt++))
      continue
    }
    if (res.statusCode >= 400) throw errorFor(res.statusCode, await readJson(res))
    return res
  }
  throw new KdriveError('kdrive', 'kDrive sent the download on too often.')
}

/* ----------------------------------------------------------------------- */
/* Adding files                                                             */
/* ----------------------------------------------------------------------- */

/** Cuts a stream into pieces of size bytes (the last one smaller). Holds one piece at a time. */
async function * piecesOf (stream, size) {
  let parts = []
  let length = 0
  for await (const data of stream) {
    let rest = Buffer.isBuffer(data) ? data : Buffer.from(data)
    while (rest.length) {
      const take = Math.min(size - length, rest.length)
      parts.push(rest.subarray(0, take))
      length += take
      rest = rest.subarray(take)
      if (length === size) {
        yield Buffer.concat(parts)
        parts = []
        length = 0
      }
    }
  }
  if (length) yield Buffer.concat(parts)
}

/** Adds a file in one call. The stream goes on to kDrive as it arrives. */
async function uploadDirect ({ folderId, name, size, stream, conflict = 'rename' }) {
  const url = apiUrl(drivePath(3, '/upload'), { directory_id: folderId, file_name: name, total_size: size, conflict })
  const answer = await call('POST', url, {
    body: stream,
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) }
  })
  return answer.data
}

/** Where the pieces of an upload go: the upload_url kDrive gave is the address of its upload server. */
function chunkUrl (uploadUrl, sessionToken, number, length, hash) {
  const base = new URL(uploadUrl)
  if (!isInfomaniak(base)) throw new KdriveError('kdrive', 'kDrive gave an upload address that is not Infomaniak\'s.')
  const path = /\/chunk\/?$/.test(base.pathname)
    ? base.pathname
    : `${base.pathname.replace(/\/$/, '')}/3/drive/${driveId()}/upload/session/${encodeURIComponent(sessionToken)}/chunk`
  const url = new URL(path, base.origin)
  url.searchParams.set('chunk_number', String(number))
  url.searchParams.set('chunk_size', String(length))
  url.searchParams.set('chunk_hash', `sha256:${hash}`)
  return url
}

/** Adds a big file in pieces: an upload session, one call per piece, then finish. */
async function uploadInPieces ({ folderId, name, size, stream, conflict = 'rename', chunkSize = CHUNK_SIZE }) {
  const totalChunks = Math.ceil(size / chunkSize)
  const started = (await call('POST', apiUrl(drivePath(3, '/upload/session/start')), {
    json: { directory_id: Number(folderId), file_name: name, total_size: size, total_chunks: totalChunks, conflict }
  })).data || {}
  const sessionToken = started.token
  if (!sessionToken || !started.upload_url) throw new KdriveError('kdrive', 'kDrive did not start the upload.')
  try {
    let number = 0
    let sent = 0
    for await (const piece of piecesOf(Buffer.isBuffer(stream) ? [stream] : stream, chunkSize)) {
      number++
      sent += piece.length
      if (number > totalChunks || sent > size) throw new KdriveError('bad_request', 'The file is larger than it said.')
      const hash = crypto.createHash('sha256').update(piece).digest('hex')
      await call('POST', chunkUrl(started.upload_url, sessionToken, number, piece.length, hash), {
        body: piece,
        headers: { 'content-type': 'application/octet-stream' }
      })
    }
    if (sent !== size) throw new KdriveError('bad_request', 'The file is smaller than it said.')
    const finished = (await call('POST', apiUrl(drivePath(3, `/upload/session/${encodeURIComponent(sessionToken)}/finish`)), { json: {} })).data || {}
    return finished.file || finished
  } catch (err) {
    // The pieces sent so far are thrown away; kDrive would also do so after 4 hours.
    await call('DELETE', apiUrl(drivePath(3, `/upload/session/${encodeURIComponent(sessionToken)}`))).catch(() => {})
    if (err instanceof KdriveError) throw err
    throw new KdriveError('bad_request', /larger than it said/.test(err.message) ? 'The file is larger than it said.' : 'The file stopped arriving before it was complete.')
  }
}

/**
 * Adds a file to a folder: in one call up to DIRECT_LIMIT, in pieces above.
 * size must be the exact size in bytes. A file with the same name gets a new
 * name from kDrive ("file (1).txt"), so nothing is ever overwritten.
 */
async function upload ({ folderId, name, size, stream, conflict = 'rename' }) {
  if (!idFrom(folderId)) throw new KdriveError('not_found', NOT_HERE)
  if (!Number.isSafeInteger(size) || size <= 0) throw new KdriveError('bad_request', 'The file is empty.')
  return size <= DIRECT_LIMIT
    ? uploadDirect({ folderId, name, size, stream, conflict })
    : uploadInPieces({ folderId, name, size, stream, conflict })
}

module.exports = {
  isConfigured,
  missingTopFolder,
  maxUploadBytes,
  rootFolderSetting,
  idFrom,
  fileInfo,
  listFolder,
  childByName,
  createDirectory,
  rename,
  move,
  trash,
  openDownload,
  upload,
  uploadDirect,
  uploadInPieces,
  setPacing,
  KdriveError,
  NOT_HERE,
  DIRECT_LIMIT,
  CHUNK_SIZE
}
