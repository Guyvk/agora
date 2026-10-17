/**
 * Agora: 7BP's Google Drive, so each circle can see and add its files in Agora.
 *
 * One main 7BP folder in Drive holds a folder for each circle, with the same
 * name as the circle. Agora lists that folder: names, who changed a file last
 * and when. Opening a file happens in Google Drive itself, so Drive keeps
 * deciding who may read or edit it.
 *
 * By default Agora only reads. With AGORA_DRIVE_UPLOADS=on, members of a
 * circle can also add files and folders to their circle's folder. Agora never
 * changes, moves or deletes what is already in Drive, and it only shows and
 * adds to folders inside the main folder, even if its Google account can see
 * more.
 *
 * Agora logs in to Google in one of two ways:
 *
 * 1. A robot account, which Google calls a service account. Fine for reading.
 *    A robot account has no storage of its own, so it can only add files to a
 *    shared drive (part of Google Workspace), not to a folder in a "My Drive".
 * 2. A normal Google account made for 7BP, which let Agora in once with
 *    agora/google-drive-login.mjs. Files added count against that account's
 *    storage. Used whenever its three settings are filled in.
 *
 * Settings, in apps/backend/.env:
 *   AGORA_DRIVE_FOLDER_ID              the main folder: its id, or its whole Drive link
 *   AGORA_GOOGLE_SERVICE_ACCOUNT_KEY   way 1: the robot account's key file, as base64
 *                                      (base64 -i key.json) or as the JSON itself
 *   AGORA_GOOGLE_OAUTH_CLIENT_ID       way 2: the "Desktop app" login client of the
 *   AGORA_GOOGLE_OAUTH_CLIENT_SECRET   Google Cloud project, and the token that
 *   AGORA_GOOGLE_OAUTH_REFRESH_TOKEN   agora/google-drive-login.mjs writes
 *   AGORA_DRIVE_UPLOADS                "on" lets circle members add files and folders
 *   AGORA_DRIVE_MAX_UPLOAD_MB          the largest file a member may add, 5120 (5 GB) by default
 */
const jwt = require('jsonwebtoken')

const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
// Adding files to folders that people made needs the full Drive scope. The
// code below keeps Agora inside the main folder.
const WRITE_SCOPE = 'https://www.googleapis.com/auth/drive'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FOLDER = 'application/vnd.google-apps.folder'
const ITEM_FIELDS = 'id, name, mimeType, modifiedTime, webViewLink, lastModifyingUser(displayName, me), appProperties'
const LIST_SECONDS = 60
const MAX_DEPTH = 20

let fetchImpl = (...args) => fetch(...args)
let token = null
const cache = new Map()

/** For tests: replaces the function that talks to Google, and forgets what was cached. */
function setFetch (fn) {
  fetchImpl = fn || ((...args) => fetch(...args))
  token = null
  cache.clear()
}

/** Accepts a folder id, or a Drive link that contains one. */
function folderIdFrom (value) {
  const text = String(value || '').trim()
  const fromLink = text.match(/\/folders\/([A-Za-z0-9_-]+)/) || text.match(/[?&]id=([A-Za-z0-9_-]+)/)
  const id = fromLink ? fromLink[1] : text
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null
}

function rootFolderId () {
  return folderIdFrom(process.env.AGORA_DRIVE_FOLDER_ID)
}

function serviceAccount () {
  const raw = String(process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY || '').trim()
  if (!raw) return null
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const key = JSON.parse(text)
    return key.client_email && key.private_key ? key : null
  } catch (e) {
    return null
  }
}

/** Way 2: a normal Google account that let Agora in. Null unless all three settings are there. */
function googleAccount () {
  const clientId = String(process.env.AGORA_GOOGLE_OAUTH_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.AGORA_GOOGLE_OAUTH_CLIENT_SECRET || '').trim()
  const refreshToken = String(process.env.AGORA_GOOGLE_OAUTH_REFRESH_TOKEN || '').trim()
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null
}

function isConfigured () {
  return Boolean(rootFolderId() && (googleAccount() || serviceAccount()))
}

/** True when circle members may add files and folders. */
function uploadsEnabled () {
  return isConfigured() && /^(on|true|yes|1)$/i.test(String(process.env.AGORA_DRIVE_UPLOADS || '').trim())
}

/** The largest file a member may add, in bytes. */
function maxUploadBytes () {
  const mb = Number(process.env.AGORA_DRIVE_MAX_UPLOAD_MB)
  return Math.round((mb > 0 ? mb : 5120) * 1024 * 1024)
}

/** The robot account's email address, which the main folder is shared with. Null for way 2. */
function robotEmail () {
  if (googleAccount()) return null
  const key = serviceAccount()
  return key ? key.client_email : null
}

/** Names match when they are the same apart from capitals, accents' encoding and spaces. */
function sameName (a, b) {
  const clean = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  return clean(a) !== '' && clean(a) === clean(b)
}

/** A name Drive and people can live with: no control characters, at most 200 characters. Null when empty. */
function cleanName (value) {
  // eslint-disable-next-line no-control-regex
  const name = String(value || '').normalize('NFC').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
  return name && name !== '.' && name !== '..' ? name : null
}

class DriveError extends Error {
  constructor (code, message) {
    super(message)
    this.code = code
  }
}

function form (fields) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  }
}

async function accessToken () {
  if (token && token.expiresAt > Date.now() + 60000) return token.value
  const account = googleAccount()
  let res
  if (account) {
    res = await fetchImpl(TOKEN_URL, form({
      grant_type: 'refresh_token',
      client_id: account.clientId,
      client_secret: account.clientSecret,
      refresh_token: account.refreshToken
    }))
    if (!res.ok) throw new DriveError('login', `Google refused Agora's login to the 7BP Google account (${res.status}). Run agora/google-drive-login.mjs again.`)
  } else {
    const key = serviceAccount()
    const now = Math.floor(Date.now() / 1000)
    const tokenUri = key.token_uri || TOKEN_URL
    const scope = uploadsEnabled() ? WRITE_SCOPE : READ_SCOPE
    const assertion = jwt.sign(
      { iss: key.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 },
      key.private_key,
      { algorithm: 'RS256' }
    )
    res = await fetchImpl(tokenUri, form({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }))
    if (!res.ok) throw new DriveError('login', `Google refused the robot account's key (${res.status}).`)
  }
  const body = await res.json()
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 }
  return token.value
}

async function get (path, params) {
  const url = `${API}${path}?${new URLSearchParams({ supportsAllDrives: 'true', ...params })}`
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${await accessToken()}` } })
  if (res.status === 404) throw new DriveError('not_found', 'This folder does not exist, or Agora cannot see it.')
  if (!res.ok) throw new DriveError('google', `Google Drive answered with an error (${res.status}).`)
  return res.json()
}

/** Turns Google's refusal to add something into a message people can act on. */
async function writeError (res) {
  const body = await res.json().catch(() => ({}))
  const reasons = ((body && body.error && body.error.errors) || []).map(e => e.reason)
  if (res.status === 403 && reasons.includes('storageQuotaExceeded')) {
    return new DriveError('no_storage', robotEmail()
      ? 'Google Drive does not let Agora\'s robot account store files in this folder. Adding files needs a shared drive or a 7BP Google account, see "Google Drive" in README-AGORA.md.'
      : 'The 7BP Google account has no storage left. Free up space or buy more in Google Drive.')
  }
  if (res.status === 401 || res.status === 403) {
    return new DriveError('no_write', 'Agora may not add files to this folder in Google Drive. Give its Google account edit rights on the main folder.')
  }
  if (res.status === 404) return new DriveError('not_found', 'This folder does not exist, or Agora cannot see it.')
  return new DriveError('google', `Google Drive answered with an error (${res.status}).`)
}

async function cached (key, load) {
  const hit = cache.get(key)
  if (hit && hit.until > Date.now()) return hit.value
  const value = await load()
  cache.set(key, { value, until: Date.now() + LIST_SECONDS * 1000 })
  return value
}

function kindOf (mimeType) {
  if (mimeType === FOLDER) return 'folder'
  if (mimeType === 'application/vnd.google-apps.document') return 'document'
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'spreadsheet'
  if (mimeType === 'application/vnd.google-apps.presentation') return 'presentation'
  if (mimeType === 'application/vnd.google-apps.form') return 'form'
  if (mimeType === 'application/pdf') return 'pdf'
  if (String(mimeType).startsWith('image/')) return 'image'
  if (String(mimeType).startsWith('video/')) return 'video'
  if (String(mimeType).startsWith('audio/')) return 'audio'
  return 'file'
}

/**
 * One file or folder as the Files page shows it. When Agora's own Google
 * account made the last change, the member who added it in Agora is named.
 */
function toItem (f) {
  const user = f.lastModifyingUser || {}
  const addedBy = (f.appProperties && f.appProperties.agoraAddedBy) || null
  return {
    id: f.id,
    name: f.name,
    kind: kindOf(f.mimeType),
    link: f.webViewLink || null,
    changedAt: f.modifiedTime || null,
    changedBy: (user.me && addedBy) || user.displayName || addedBy || null
  }
}

/** Everything directly inside a folder, folders first, then by name. */
function listFolder (folderId) {
  return cached(`list:${folderId}`, async () => {
    const items = []
    let pageToken
    do {
      const page = await get('/files', {
        q: `'${folderId}' in parents and trashed = false`,
        fields: `nextPageToken, files(${ITEM_FIELDS})`,
        orderBy: 'folder, name_natural',
        pageSize: '200',
        includeItemsFromAllDrives: 'true',
        ...(pageToken ? { pageToken } : {})
      })
      for (const f of page.files || []) items.push(toItem(f))
      pageToken = page.nextPageToken
    } while (pageToken)
    return items
  })
}

function folderInfo (folderId) {
  return cached(`info:${folderId}`, () => get(`/files/${folderId}`, { fields: 'id, name, mimeType, parents, webViewLink' }))
}

/** The circle's folder: the folder in the main folder with the circle's name, or null. */
async function circleFolder (circleName) {
  const items = await listFolder(rootFolderId())
  const match = items.find(item => item.kind === 'folder' && sameName(item.name, circleName))
  return match || null
}

/** True when folderId is ancestorId itself, or somewhere inside it. */
async function isInside (folderId, ancestorId) {
  let current = folderId
  for (let depth = 0; depth < MAX_DEPTH && current; depth++) {
    if (current === ancestorId) return true
    const info = await folderInfo(current)
    current = (info.parents || [])[0]
  }
  return false
}

/**
 * What a circle's Files page shows. Without folderId: the circle's own folder.
 * With folderId: a folder inside the circle's folder, or a not_found error.
 */
async function circleFiles (circleName, folderId) {
  const circle = await circleFolder(circleName)
  if (!circle) return { folder: null }
  const wanted = folderId ? folderIdFrom(folderId) : circle.id
  if (!wanted || !(await isInside(wanted, circle.id))) {
    throw new DriveError('not_found', 'This folder is not part of this circle.')
  }
  const info = wanted === circle.id ? circle : await folderInfo(wanted)
  if (info.mimeType && info.mimeType !== FOLDER) throw new DriveError('not_found', 'This is not a folder.')
  return {
    folder: { id: wanted, name: info.name, link: info.webViewLink || info.link || null, isCircleFolder: wanted === circle.id },
    items: await listFolder(wanted)
  }
}

/** The folder something is added to: the circle's folder, or a folder inside it. */
async function targetFolder (circleName, folderId) {
  const circle = await circleFolder(circleName)
  if (!circle) throw new DriveError('no_folder', 'This circle has no folder in Google Drive yet.')
  const wanted = folderId ? folderIdFrom(folderId) : circle.id
  if (!wanted || !(await isInside(wanted, circle.id))) {
    throw new DriveError('not_found', 'This folder is not part of this circle.')
  }
  if (wanted !== circle.id) {
    const info = await folderInfo(wanted)
    if (info.mimeType && info.mimeType !== FOLDER) throw new DriveError('not_found', 'This is not a folder.')
  }
  return wanted
}

function addedByProperty (addedBy) {
  return addedBy ? { appProperties: { agoraAddedBy: String(addedBy).slice(0, 100) } } : {}
}

function fileType (mimeType) {
  return /^[\w.+-]+\/[\w.+-]+$/.test(String(mimeType || '')) ? String(mimeType) : 'application/octet-stream'
}

/**
 * Starts an upload to a circle's folder, or to a folder inside it, and returns
 * the one-time address Google gives for its contents. Name, folder and size are
 * fixed here, so whoever holds the address can only send this one file, to
 * this one folder.
 *
 * With origin (the address of the Agora website), Google lets a browser on
 * that website send the contents to the address directly. That way big files
 * never pass through Agora's own server.
 *
 *   size      the size in bytes, which Google needs before it starts
 *   addedBy   the member's name, kept with the file so the Files page can show it
 */
async function startUpload ({ circleName, folderId, name, mimeType, size, addedBy, origin, limit = maxUploadBytes() }) {
  const fileName = cleanName(name)
  if (!fileName) throw new DriveError('bad_request', 'The file needs a name.')
  if (!(size > 0)) throw new DriveError('bad_request', 'The file is empty.')
  if (size > limit) throw new DriveError('too_large', `The file is larger than ${Math.round(limit / 1048576)} MB.`)
  const parent = await targetFolder(circleName, folderId)
  const type = fileType(mimeType)

  const params = new URLSearchParams({ uploadType: 'resumable', supportsAllDrives: 'true', fields: ITEM_FIELDS })
  const start = await fetchImpl(`${UPLOAD_API}/files?${params}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': type,
      'x-upload-content-length': String(size),
      ...(origin ? { origin } : {})
    },
    body: JSON.stringify({ name: fileName, parents: [parent], ...addedByProperty(addedBy) })
  })
  if (!start.ok) throw await writeError(start)
  const location = start.headers.get('location')
  if (!location || !location.startsWith('https://www.googleapis.com/')) {
    throw new DriveError('google', 'Google Drive did not accept the upload.')
  }
  return { uploadUrl: location, folderId: parent, type }
}

/**
 * Adds a file through Agora's own server: the contents go on to Google as they
 * arrive, and Agora never stores the file. Used for small files when the
 * browser cannot send to Google directly (see RELAY_LIMIT in the controller).
 *
 *   stream    the contents: a readable stream, or anything fetch can send
 */
async function uploadFile ({ stream, ...details }) {
  const { uploadUrl: location, folderId: parent, type } = await startUpload(details)
  const size = details.size
  const sent = await fetchImpl(location, {
    method: 'PUT',
    headers: { 'content-type': type, 'content-length': String(size) },
    body: stream,
    duplex: 'half'
  })
  if (!sent.ok) throw await writeError(sent)
  cache.delete(`list:${parent}`)
  return toItem(await sent.json())
}

/** Makes a new folder in a circle's folder, or in a folder inside it. */
async function createFolder ({ circleName, folderId, name, addedBy }) {
  const folderName = cleanName(name)
  if (!folderName) throw new DriveError('bad_request', 'The folder needs a name.')
  const parent = await targetFolder(circleName, folderId)
  const params = new URLSearchParams({ supportsAllDrives: 'true', fields: ITEM_FIELDS })
  const res = await fetchImpl(`${API}/files?${params}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: folderName, mimeType: FOLDER, parents: [parent], ...addedByProperty(addedBy) })
  })
  if (!res.ok) throw await writeError(res)
  cache.delete(`list:${parent}`)
  return toItem(await res.json())
}

/**
 * A member's own folder inside a folder of the circle (by default the
 * circle's folder): the folder with the member's name, made when it is not
 * there yet. Today people in 7BP each keep a folder under their own name.
 */
async function personalFolder ({ circleName, folderId, memberName }) {
  const name = cleanName(memberName)
  if (!name) throw new DriveError('bad_request', 'Your Agora profile has no name yet.')
  const parent = await targetFolder(circleName, folderId)
  const existing = (await listFolder(parent)).find(item => item.kind === 'folder' && sameName(item.name, name))
  return existing || createFolder({ circleName, folderId: parent, name, addedBy: memberName })
}

/** Forgets the cached list of a circle's folder, after the browser added a file to it directly. */
async function forgetFolder (circleName, folderId) {
  const folder = await targetFolder(circleName, folderId)
  cache.delete(`list:${folder}`)
  return folder
}

module.exports = {
  isConfigured,
  uploadsEnabled,
  maxUploadBytes,
  robotEmail,
  circleFiles,
  startUpload,
  uploadFile,
  createFolder,
  personalFolder,
  forgetFolder,
  cleanName,
  folderIdFrom,
  sameName,
  setFetch,
  DriveError,
  READ_SCOPE,
  WRITE_SCOPE
}
