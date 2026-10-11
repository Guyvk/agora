/**
 * Agora: reads 7BP's Google Drive, so each circle can see its files in Agora.
 *
 * A robot Google account, which Google calls a service account, has viewer
 * access to one main 7BP folder. Inside it, each circle has a folder with the
 * same name as the circle. Agora lists that folder: names, who changed a file
 * last and when. Opening a file happens in Google Drive itself, so Drive keeps
 * deciding who may read or edit it.
 *
 * Agora only reads. It never changes, moves or deletes anything in Drive, and
 * it only shows folders inside the main folder, even if the robot account can
 * see more.
 *
 * Settings, in apps/backend/.env:
 *   AGORA_DRIVE_FOLDER_ID              the main folder: its id, or its whole Drive link
 *   AGORA_GOOGLE_SERVICE_ACCOUNT_KEY   the robot account's key file, as base64
 *                                      (base64 -i key.json) or as the JSON itself
 */
const jwt = require('jsonwebtoken')

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const API = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
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

function isConfigured () {
  return Boolean(rootFolderId() && serviceAccount())
}

/** The robot account's email address, which the main folder is shared with. */
function robotEmail () {
  const key = serviceAccount()
  return key ? key.client_email : null
}

/** Names match when they are the same apart from capitals, accents' encoding and spaces. */
function sameName (a, b) {
  const clean = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  return clean(a) !== '' && clean(a) === clean(b)
}

async function accessToken () {
  if (token && token.expiresAt > Date.now() + 60000) return token.value
  const key = serviceAccount()
  const now = Math.floor(Date.now() / 1000)
  const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token'
  const assertion = jwt.sign(
    { iss: key.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 },
    key.private_key,
    { algorithm: 'RS256' }
  )
  const res = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString()
  })
  if (!res.ok) throw new DriveError('login', `Google refused the robot account's key (${res.status}).`)
  const body = await res.json()
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 }
  return token.value
}

class DriveError extends Error {
  constructor (code, message) {
    super(message)
    this.code = code
  }
}

async function get (path, params) {
  const url = `${API}${path}?${new URLSearchParams({ supportsAllDrives: 'true', ...params })}`
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${await accessToken()}` } })
  if (res.status === 404) throw new DriveError('not_found', 'This folder does not exist, or the robot account cannot see it.')
  if (!res.ok) throw new DriveError('google', `Google Drive answered with an error (${res.status}).`)
  return res.json()
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

/** Everything directly inside a folder, folders first, then by name. */
function listFolder (folderId) {
  return cached(`list:${folderId}`, async () => {
    const items = []
    let pageToken
    do {
      const page = await get('/files', {
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, lastModifyingUser(displayName))',
        orderBy: 'folder, name_natural',
        pageSize: '200',
        includeItemsFromAllDrives: 'true',
        ...(pageToken ? { pageToken } : {})
      })
      for (const f of page.files || []) {
        items.push({
          id: f.id,
          name: f.name,
          kind: kindOf(f.mimeType),
          link: f.webViewLink || null,
          changedAt: f.modifiedTime || null,
          changedBy: (f.lastModifyingUser && f.lastModifyingUser.displayName) || null
        })
      }
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

module.exports = {
  isConfigured,
  robotEmail,
  circleFiles,
  folderIdFrom,
  sameName,
  setFetch,
  DriveError
}
