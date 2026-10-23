/**
 * Agora: a circle's Files page when the files are in Infomaniak kDrive.
 *
 * The page is the web app's own Files page (apps/web/src/agora/files); the
 * old address /noo/agora/files/<circle> now sends people there
 * (AgoraFilesController.page). The page calls:
 *
 *   GET  /noo/agora/files/<circle>/kd/list?folder=<id>        what is in a folder
 *   GET  /noo/agora/files/<circle>/kd/download?file=<id>      a file, passed on by Agora
 *   POST /noo/agora/files/<circle>/kd/upload?name=&folder=    adds one file (the body is the file)
 *   POST /noo/agora/files/<circle>/kd/folder                  { name, folder } makes a folder
 *   POST /noo/agora/files/<circle>/kd/link                    { url, title, folder } adds a link to a Google document
 *   POST /noo/agora/files/<circle>/kd/rename                  { item, name }
 *   POST /noo/agora/files/<circle>/kd/move                    { item, folder } moves it into another folder (folder empty: the circle's own)
 *   POST /noo/agora/files/<circle>/kd/delete                  { item } moves it to kDrive's bin
 *
 * A link (lib/agora/googleLinks.js) is kept in Agora, not in kDrive. Its item
 * number is "link-<number>"; rename changes its title and delete removes it.
 *
 * Every call checks, on the server, that the person is logged in and an
 * active member of the circle. Renaming and deleting also check that they
 * added the item in Agora or are a steward of the circle
 * (lib/agora/kdriveCircles.js). Calls that change something must carry the
 * header X-Agora: 1, which a form on another website cannot send.
 *
 * The browser never gets a kDrive address or the token: downloads come
 * through Agora, and uploads go to Agora, which passes them on to kDrive as
 * they arrive, without keeping the file. Big files go on to kDrive in pieces
 * of 16 MB, so Agora never holds more than one piece in memory.
 *
 * An upload is sent as application/octet-stream, so no body parser reads it,
 * with its size in Content-Length and its name and folder in the address.
 */
import { Transform } from 'stream'
import Circles from '../../lib/agora/kdriveCircles'

const STATUS = {
  not_found: 404,
  not_allowed: 403,
  bad_request: 400,
  conflict: 409,
  too_large: 413,
  rate_limited: 503,
  no_storage: 507,
  not_configured: 409
}

function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

/** The circle from the address, for an active member only. Answers the request and returns null otherwise. */
async function memberCircle (req, res, { changes = false } = {}) {
  res.set('Cache-Control', 'no-store')
  if (changes && !fromAgoraPage(req)) {
    res.status(400).send({ error: 'Bad request.' })
    return null
  }
  if (!UserSession.isLoggedIn(req)) {
    res.status(401).send({ error: 'Log in first.' })
    return null
  }
  if (!Circles.isConfigured()) {
    res.status(409).send({ error: 'kDrive is not connected to Agora yet.' })
    return null
  }
  const slug = String(req.param('groupSlug') || '')
  const group = /^[a-z0-9-]{1,100}$/i.test(slug) ? await Group.findActive(slug) : null
  if (!group) {
    res.status(404).send({ error: 'This circle does not exist.' })
    return null
  }
  const userId = req.session.userId
  if (!userId || !(await GroupMembership.hasActiveMembership(userId, group.id))) {
    res.status(403).send({ error: 'Only members of this circle can see and add its files.' })
    return null
  }
  return { group, userId }
}

/** kDrive's errors become plain answers. Never includes the token: kdrive.js never puts it in a message. */
function failure (res, err) {
  if (err instanceof Circles.KdriveError) {
    if (!['not_found', 'not_allowed', 'bad_request', 'conflict', 'too_large'].includes(err.code)) {
      sails.log.error(`Agora kDrive: ${err.code}: ${err.message}`)
    }
    return res.status(STATUS[err.code] || 502).send({ error: err.message })
  }
  sails.log.error(`Agora kDrive: ${err.message}`)
  return res.status(502).send({ error: 'Something went wrong with kDrive. Try again in a minute.' })
}

/** A size given in a header: a whole number of bytes, or NaN. */
function sizeFrom (value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return /^\d{1,16}$/.test(text) ? Number(text) : NaN
}

/** Passes the file on as it arrives, and stops when it is larger than it said. */
function sizeGuard (size) {
  let seen = 0
  return new Transform({
    transform (chunk, encoding, done) {
      seen += chunk.length
      if (seen > size) return done(new Error('The file is larger than it said.'))
      done(null, chunk)
    }
  })
}

/** Refuses an upload without reading it: upload() closes the connection once the answer is out. */
function refuseBody (req, res, status, error) {
  return res.status(status).send({ error })
}

/** A file name for the Content-Disposition header, plain and encoded (RFC 6266). */
function disposition (name) {
  const plain = String(name || 'file').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(String(name || 'file'))}`
}

module.exports = {
  list: async function (req, res) {
    const allowed = await memberCircle(req, res)
    if (!allowed) return
    try {
      const result = await Circles.list(allowed.group, req.param('folder') || null, allowed.userId)
      return res.ok({ configured: true, maxUploadMb: Math.round(Circles.maxUploadBytes() / 1048576), ...result })
    } catch (err) {
      return failure(res, err)
    }
  },

  download: async function (req, res) {
    const allowed = await memberCircle(req, res)
    if (!allowed) return
    let opened
    try {
      opened = await Circles.openFile(allowed.group, req.param('file'))
    } catch (err) {
      return failure(res, err)
    }
    const { item, stream } = opened
    // Always a download, never shown as a page of Agora: a file someone added
    // could otherwise run as a web page under Agora's address.
    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', disposition(item.name))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', "default-src 'none'; sandbox")
    if (stream.headers && /^\d+$/.test(String(stream.headers['content-length'] || ''))) {
      res.set('Content-Length', stream.headers['content-length'])
    }
    sails.log.info(`Agora kDrive: user ${allowed.userId} downloaded file ${item.id} of group ${allowed.group.id}`)
    // If the person leaves halfway, the download from kDrive stops too.
    res.on('close', () => stream.destroy())
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  },

  upload: async function (req, res) {
    // Each file comes in its own request. When it is refused, the rest of it is not read.
    res.set('Connection', 'close')
    if (typeof res.once === 'function') res.once('finish', () => { if (!req.complete && req.destroy) req.destroy() })
    const allowed = await memberCircle(req, res, { changes: true })
    if (!allowed) return

    const size = sizeFrom(req.headers['content-length'])
    if (!Number.isSafeInteger(size) || size <= 0) {
      return refuseBody(req, res, 411, 'The file is empty, or its size is missing. Empty files are not added.')
    }
    const limit = Circles.maxUploadBytes()
    if (size > limit) {
      return refuseBody(req, res, 413, `The file is larger than ${Math.round(limit / 1048576)} MB.`)
    }
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/octet-stream') {
      return refuseBody(req, res, 415, 'Send the file as application/octet-stream.')
    }
    if (!Circles.cleanName(req.query.name)) {
      return refuseBody(req, res, 400, 'The file needs a name.')
    }

    const guard = sizeGuard(size)
    // An error here is noticed by lib/agora/kdrive.js, which then stops the upload.
    guard.on('error', () => {})
    // A browser that stops halfway also stops the upload to kDrive.
    const stop = () => { if (!req.complete) guard.destroy(new Error('The upload was stopped halfway.')) }
    if (typeof req.on === 'function') {
      req.on('aborted', stop)
      req.on('close', stop)
    }
    try {
      const item = await Circles.addFile(allowed.group, {
        folderId: req.query.folder || null,
        userId: allowed.userId,
        name: req.query.name,
        size,
        stream: req.pipe(guard)
      })
      sails.log.info(`Agora kDrive: user ${allowed.userId} added file ${item.id} to group ${allowed.group.id}`)
      return res.ok({ item })
    } catch (err) {
      if (!(err instanceof Circles.KdriveError)) {
        sails.log.error(`Agora kDrive: upload failed: ${err.message}`)
        return res.status(502).send({ error: 'The file could not be added. Try again in a minute.' })
      }
      return failure(res, err)
    }
  },

  createFolder: async function (req, res) {
    const allowed = await memberCircle(req, res, { changes: true })
    if (!allowed) return
    try {
      const item = await Circles.makeFolder(allowed.group, { folderId: req.param('folder') || null, userId: allowed.userId, name: req.param('name') })
      sails.log.info(`Agora kDrive: user ${allowed.userId} made folder ${item.id} in group ${allowed.group.id}`)
      return res.ok({ item })
    } catch (err) {
      return failure(res, err)
    }
  },

  addLink: async function (req, res) {
    const allowed = await memberCircle(req, res, { changes: true })
    if (!allowed) return
    try {
      const item = await Circles.addLink(allowed.group, {
        folderId: req.param('folder') || null,
        userId: allowed.userId,
        url: req.param('url'),
        title: req.param('title')
      })
      sails.log.info(`Agora kDrive: user ${allowed.userId} added link ${item.id} to group ${allowed.group.id}`)
      return res.ok({ item })
    } catch (err) {
      return failure(res, err)
    }
  },

  rename: async function (req, res) {
    const allowed = await memberCircle(req, res, { changes: true })
    if (!allowed) return
    try {
      const item = await Circles.renameItem(allowed.group, { itemId: req.param('item'), userId: allowed.userId, name: req.param('name') })
      sails.log.info(`Agora kDrive: user ${allowed.userId} renamed ${item.id} in group ${allowed.group.id}`)
      return res.ok({ item })
    } catch (err) {
      return failure(res, err)
    }
  },

  move: async function (req, res) {
    const allowed = await memberCircle(req, res, { changes: true })
    if (!allowed) return
    try {
      const item = await Circles.moveItem(allowed.group, { itemId: req.param('item'), folderId: req.param('folder') || null, userId: allowed.userId })
      sails.log.info(`Agora kDrive: user ${allowed.userId} moved ${item.id} to ${item.folder} in group ${allowed.group.id}`)
      return res.ok({ item })
    } catch (err) {
      return failure(res, err)
    }
  },

  remove: async function (req, res) {
    const allowed = await memberCircle(req, res, { changes: true })
    if (!allowed) return
    try {
      const item = await Circles.deleteItem(allowed.group, { itemId: req.param('item'), userId: allowed.userId })
      sails.log.info(`Agora kDrive: user ${allowed.userId} deleted ${item.id} in group ${allowed.group.id}`)
      return res.ok({ item })
    } catch (err) {
      return failure(res, err)
    }
  }
}
