/**
 * Agora: the circle library (the Resources tab), for members of the circle only.
 *
 *   GET  /noo/agora/library/circles/<circle>/settings       limits, and whether files go to disk or S3
 *   GET  /noo/agora/library/circles/<circle>/items          the list; ?search= &kind= &tag= &offset=
 *   GET  /noo/agora/library/circles/<circle>/items/<post>   one item, its files and their text
 *   POST /noo/agora/library/circles/<circle>/uploads        starts sending a file: { name, type, size }
 *   POST /noo/agora/library/circles/<circle>/items          adds an item: { title, description, tags, fileIds, link }
 *   POST /noo/agora/library/uploads/<file>/chunk/<index>    one piece of a file, through Agora (body: the bytes)
 *   POST /noo/agora/library/uploads/<file>/part-urls        signed S3 addresses for parts: { parts: [1, 2, ...] }
 *   POST /noo/agora/library/uploads/<file>/relay            S3 could not be reached: send through Agora instead
 *   POST /noo/agora/library/uploads/<file>/finish           all sent: { parts: [{ partNumber, etag }] } for parts
 *   GET  /noo/agora/library/file/<file>/<name>              the file itself (?download=1 to save it)
 *
 * <circle> is the circle's short name from its address, as in /groups/<circle>.
 * Every call checks that the person is an active member of the circle
 * (lib/agora/library.js). Calls that change something must carry the header
 * "X-Agora: 1", which a form on another website cannot send.
 */
import { Writable } from 'stream'
import Library, { LibraryError } from '../../lib/agora/library'
import Storage from '../../lib/agora/libraryStorage'

function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

async function loadCircle (req) {
  const slug = String(req.param('groupSlug') || '')
  const group = /^[a-z0-9-]{1,100}$/i.test(slug) ? await Group.findActive(slug) : null
  if (!group) throw new LibraryError('This circle does not exist.', 404)
  return group
}

function fail (res, err) {
  if (err instanceof LibraryError) return res.status(err.status).send({ error: err.message })
  sails.log.error(`Agora library: ${err.stack || err.message}`)
  return res.status(500).send({ error: 'Something went wrong. Try again in a minute.' })
}

/** Runs one action: a login is needed, changes need the Agora header, errors become plain answers. */
function action (fn, { change = false } = {}) {
  return async function (req, res) {
    res.set('Cache-Control', 'no-store')
    try {
      // The policy already asks for a login; this is a second lock on the same door.
      if (!UserSession.isLoggedIn(req)) throw new LibraryError('Log in first.', 401)
      if (change && !fromAgoraPage(req)) throw new LibraryError('Bad request.', 400)
      return await fn(req, res, req.session.userId)
    } catch (err) {
      return fail(res, err)
    }
  }
}

/** Reads a request body of at most `limit` bytes. */
function readBody (req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let seen = 0
    const sink = new Writable({
      write (chunk, encoding, done) {
        seen += chunk.length
        if (seen > limit) return done(new LibraryError('This piece is too large.', 413))
        chunks.push(Buffer.from(chunk))
        done()
      }
    })
    sink.on('finish', () => resolve(Buffer.concat(chunks)))
    sink.on('error', reject)
    req.on && req.on('error', reject)
    req.pipe(sink)
  })
}

module.exports = {
  settings: action(async (req, res, userId) => {
    const group = await loadCircle(req)
    if (!(await Library.isMember(userId, group.id))) throw new LibraryError('Only members of this circle can use its library.', 403)
    return res.ok({
      circleName: group.get('name'),
      storage: Storage.backend(),
      maxMediaMb: Math.round(Library.maxBytesFor('audio') / 1048576),
      maxDocumentMb: Math.round(Library.maxBytesFor('document') / 1048576),
      canAdd: true
    })
  }),

  list: action(async (req, res, userId) => {
    const group = await loadCircle(req)
    return res.ok(await Library.listItems({
      userId,
      groupId: group.id,
      search: req.param('search'),
      kind: req.param('kind'),
      tag: req.param('tag'),
      offset: req.param('offset')
    }))
  }),

  show: action(async (req, res, userId) => {
    const group = await loadCircle(req)
    return res.ok({ item: await Library.getItem({ userId, groupId: group.id, postId: req.param('postId') }) })
  }),

  startUpload: action(async (req, res, userId) => {
    const group = await loadCircle(req)
    const upload = await Library.startUpload({
      userId,
      groupId: group.id,
      fileName: req.param('name'),
      mimeType: req.param('type'),
      size: req.param('size')
    })
    sails.log.info(`Agora library: user ${userId} started upload ${upload.id} (${upload.mode}) in circle ${group.id}`)
    return res.ok({ upload })
  }, { change: true }),

  chunk: action(async (req, res, userId) => {
    const size = Number(req.headers['content-length'])
    if (!Number.isSafeInteger(size) || size <= 0) throw new LibraryError('The piece is empty, or its size is missing.', 411)
    if (size > Library.CHUNK_BYTES) throw new LibraryError('This piece is too large.', 413)
    if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/octet-stream') {
      throw new LibraryError('Send the piece as application/octet-stream.', 415)
    }
    const buffer = await readBody(req, Library.CHUNK_BYTES)
    return res.ok(await Library.uploadChunk({ userId, fileId: req.param('fileId'), index: req.param('index'), buffer }))
  }, { change: true }),

  partUrls: action(async (req, res, userId) => {
    return res.ok(await Library.partUrls({ userId, fileId: req.param('fileId'), partNumbers: req.param('parts') }))
  }, { change: true }),

  relay: action(async (req, res, userId) => {
    return res.ok({ upload: await Library.switchToRelay({ userId, fileId: req.param('fileId') }) })
  }, { change: true }),

  finish: action(async (req, res, userId) => {
    return res.ok(await Library.finishUpload({ userId, fileId: req.param('fileId'), parts: req.param('parts') }))
  }, { change: true }),

  create: action(async (req, res, userId) => {
    const group = await loadCircle(req)
    const item = await Library.createItem({
      userId,
      groupId: group.id,
      title: req.param('title'),
      description: req.param('description'),
      tags: req.param('tags'),
      fileIds: req.param('fileIds') || [],
      link: req.param('link')
    })
    sails.log.info(`Agora library: user ${userId} added item ${item.id} to circle ${group.id}`)
    return res.ok({ item })
  }, { change: true }),

  /**
   * The file itself. From disk it is sent by Agora; from S3 the browser is sent
   * on to a signed address that works for five minutes.
   */
  download: action(async (req, res, userId) => {
    const file = await Library.fileForDownload({ userId, fileId: req.param('fileId') })
    const options = { mimeType: file.mime_type, fileName: file.file_name, download: req.query && req.query.download === '1' }
    if (file.storage === 's3') {
      return res.redirect(await Storage.presignGet(file.storage_key, options))
    }
    res.set('Cache-Control', 'private, max-age=300')
    return Storage.serveDisk(req, res, file.storage_key, options)
  })
}
