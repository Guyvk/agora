/**
 * Agora: a circle's Files page, a live view of its Google Drive folder.
 *
 *   GET  /noo/agora/files/<circle>                 the page, for anyone logged in to Agora
 *   GET  /noo/agora/files/<circle>/list            what the page shows, as JSON
 *
 * For members of the circle, when AGORA_DRIVE_UPLOADS=on:
 *   POST /noo/agora/files/<circle>/upload-session  starts an upload; the browser then
 *                                                  sends the file to Google directly
 *   POST /noo/agora/files/<circle>/uploaded        the browser is done: list the folder afresh
 *   POST /noo/agora/files/<circle>/upload          a small file through Agora's server instead
 *   POST /noo/agora/files/<circle>/folder          makes a folder
 *   POST /noo/agora/files/<circle>/my-folder       opens, or makes, the member's own folder
 *
 * <circle> is the circle's short name from its address in Agora, for example
 * "governance" in /groups/governance. The folder is found by the circle's
 * name, see lib/agora/drive.js.
 *
 * Big files (videos of a few GB) never pass through Agora's server: online,
 * Heroku cuts off a request after 30 seconds, and the server has little
 * memory. Agora checks the member and asks Google for a one-time upload
 * address for that one file in that one folder; the browser sends the file
 * there in pieces. Only when that fails does the page fall back to /upload,
 * for files up to RELAY_LIMIT. Its body is the file, sent as
 * application/octet-stream so that no body parser reads it, with the details
 * in the address: ?name=<file name>&type=<file type>&folder=<folder id or empty>
 */
import fs from 'fs'
import path from 'path'
import { Transform } from 'stream'
import Drive from '../../lib/agora/drive'

const PAGE_PATH = path.join(__dirname, '..', '..', 'agora', 'files.html')
// The largest file that may go through Agora's own server: small enough to
// arrive well within Heroku's 30 seconds.
const RELAY_LIMIT = 25 * 1024 * 1024
let pageTemplate = null

function loadPage () {
  if (!pageTemplate || process.env.NODE_ENV === 'development') {
    pageTemplate = fs.readFileSync(PAGE_PATH, 'utf8')
  }
  return pageTemplate
}

function webUrl (pathname) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}${pathname}`
}

/**
 * Every call that changes something must carry this header. A form on another
 * website cannot send it, so the calls cannot be triggered from outside Agora.
 */
function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

async function loadCircle (req, res) {
  const slug = String(req.param('groupSlug') || '')
  const group = /^[a-z0-9-]{1,100}$/i.test(slug) ? await Group.findActive(slug) : null
  if (!group) {
    res.status(404).send({ error: 'This circle does not exist.' })
    return null
  }
  return group
}

async function isMember (userId, group) {
  return Boolean(userId) && GroupMembership.hasActiveMembership(userId, group.id)
}

const STATUS = { not_found: 404, no_folder: 409, bad_request: 400, too_large: 413, no_storage: 507, no_write: 403 }

function driveFailure (res, err) {
  if (!['not_found', 'bad_request', 'too_large'].includes(err.code)) sails.log.error(`Agora files: ${err.message}`)
  return res.status(STATUS[err.code] || 502).send({ error: err.message })
}

/**
 * Checks shared by the two calls that add something. Answers the request and
 * returns null when adding is not allowed; otherwise returns the circle and the
 * member's name.
 */
async function checkAdding (req, res) {
  res.set('Cache-Control', 'no-store')
  if (!fromAgoraPage(req)) {
    res.status(400).send({ error: 'Bad request.' })
    return null
  }
  const group = await loadCircle(req, res)
  if (!group) return null
  if (!Drive.uploadsEnabled()) {
    res.status(403).send({ error: 'Adding files from Agora is switched off.' })
    return null
  }
  const userId = req.session.userId
  if (!(await isMember(userId, group))) {
    res.status(403).send({ error: 'Only members of this circle can add files to it.' })
    return null
  }
  const user = await User.find(userId)
  return { group, memberName: user ? user.get('name') : null, userId }
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

module.exports = {
  /**
   * The page itself.
   */
  page: async function (req, res) {
    if (!UserSession.isLoggedIn(req)) {
      return res.redirect(webUrl(`/login?returnToUrl=${encodeURIComponent(req.originalUrl)}`))
    }
    const group = await loadCircle(req, res)
    if (!group) return

    const boot = {
      circleName: group.get('name'),
      circleUrl: webUrl(`/groups/${group.get('slug')}`),
      api: `/noo/agora/files/${group.get('slug')}`
    }
    // A function is used so that "$" in a name is not read as a replace pattern.
    const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c')
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.set('Cache-Control', 'no-store')
    return res.send(loadPage().replace('"__AGORA_BOOT__"', () => bootJson))
  },

  /**
   * The files in the circle's folder, or in a folder inside it (?folder=<id>).
   */
  list: async function (req, res) {
    const group = await loadCircle(req, res)
    if (!group) return
    res.set('Cache-Control', 'no-store')

    if (!Drive.isConfigured()) {
      return res.ok({ configured: false })
    }
    try {
      const result = await Drive.circleFiles(group.get('name'), req.param('folder'))
      // Agora: members of the circle may add files, when that is switched on.
      const canAdd = Drive.uploadsEnabled() && Boolean(result.folder) && await isMember(req.session.userId, group)
      return res.ok({
        configured: true,
        robotEmail: Drive.robotEmail(),
        canAdd,
        maxUploadMb: Math.round(Drive.maxUploadBytes() / 1048576),
        relayMb: Math.round(Math.min(RELAY_LIMIT, Drive.maxUploadBytes()) / 1048576),
        ...result
      })
    } catch (err) {
      if (err instanceof Drive.DriveError) return driveFailure(res, err)
      throw err
    }
  },

  /**
   * Starts an upload that the browser sends to Google directly.
   * Body: { name, type, size, folder }. Answers { uploadUrl, folderId }.
   */
  startUpload: async function (req, res) {
    const allowed = await checkAdding(req, res)
    if (!allowed) return
    try {
      const session = await Drive.startUpload({
        circleName: allowed.group.get('name'),
        folderId: req.param('folder') || null,
        name: req.param('name'),
        mimeType: req.param('type'),
        size: Number(req.param('size')),
        addedBy: allowed.memberName,
        // Google then lets the browser on this website send the file.
        origin: `${process.env.PROTOCOL}://${process.env.DOMAIN}`
      })
      sails.log.info(`Agora files: user ${allowed.userId} started an upload to circle ${allowed.group.id}`)
      return res.ok({ uploadUrl: session.uploadUrl, folderId: session.folderId })
    } catch (err) {
      if (err instanceof Drive.DriveError) return driveFailure(res, err)
      throw err
    }
  },

  /**
   * The browser finished sending files to Google: the folder is listed afresh. Body: { folder }.
   */
  uploaded: async function (req, res) {
    const allowed = await checkAdding(req, res)
    if (!allowed) return
    try {
      await Drive.forgetFolder(allowed.group.get('name'), req.param('folder') || null)
      return res.ok({})
    } catch (err) {
      if (err instanceof Drive.DriveError) return driveFailure(res, err)
      throw err
    }
  },

  /**
   * Opens the member's own folder, made when it is not there yet. Body: { folder }.
   */
  myFolder: async function (req, res) {
    const allowed = await checkAdding(req, res)
    if (!allowed) return
    try {
      const item = await Drive.personalFolder({
        circleName: allowed.group.get('name'),
        folderId: req.param('folder') || null,
        memberName: allowed.memberName
      })
      return res.ok({ item })
    } catch (err) {
      if (err instanceof Drive.DriveError) return driveFailure(res, err)
      throw err
    }
  },

  /**
   * Adds one small file through Agora's server. The body is the file; see the top of this file.
   */
  upload: async function (req, res) {
    const allowed = await checkAdding(req, res)
    if (!allowed) return

    const size = Number(req.headers['content-length'])
    if (!Number.isInteger(size) || size <= 0) {
      return res.status(411).send({ error: 'The file is empty, or its size is missing.' })
    }
    const limit = Math.min(RELAY_LIMIT, Drive.maxUploadBytes())
    if (size > limit) {
      req.resume()
      return res.status(413).send({ error: `Files larger than ${Math.round(limit / 1048576)} MB can only be sent to Google Drive directly, and that did not work from this browser. Put the file in Google Drive yourself.` })
    }
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/octet-stream') {
      return res.status(415).send({ error: 'Send the file as application/octet-stream.' })
    }

    try {
      const item = await Drive.uploadFile({
        circleName: allowed.group.get('name'),
        folderId: req.query.folder || null,
        name: req.query.name,
        mimeType: req.query.type,
        size,
        stream: req.pipe(sizeGuard(size)),
        addedBy: allowed.memberName,
        limit
      })
      sails.log.info(`Agora files: user ${allowed.userId} added a file to circle ${allowed.group.id}`)
      return res.ok({ item })
    } catch (err) {
      if (err instanceof Drive.DriveError) return driveFailure(res, err)
      sails.log.error(`Agora files: upload failed: ${err.message}`)
      return res.status(502).send({ error: 'The file could not be added. Try again in a minute.' })
    }
  },

  /**
   * Makes a folder. Body: { name, folder } where folder is empty for the circle's folder.
   */
  createFolder: async function (req, res) {
    const allowed = await checkAdding(req, res)
    if (!allowed) return
    try {
      const item = await Drive.createFolder({
        circleName: allowed.group.get('name'),
        folderId: req.param('folder') || null,
        name: req.param('name'),
        addedBy: allowed.memberName
      })
      sails.log.info(`Agora files: user ${allowed.userId} made a folder in circle ${allowed.group.id}`)
      return res.ok({ item })
    } catch (err) {
      if (err instanceof Drive.DriveError) return driveFailure(res, err)
      throw err
    }
  }
}
