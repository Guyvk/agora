/* eslint-env mocha */
/**
 * Agora: the circle library (Resources tab), its storage, the text read from
 * its files, and the meeting notes it files by itself.
 *
 * S3, the programs that read files (pdftotext, unzip, ffmpeg) and speech to
 * text are all replaced by stand-ins, so no keys or tools are needed. The
 * tests need a database and empty it first. Never point them at a database
 * you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_library_test yarn test test/unit/agora/library.test.js
 */
import fs from 'fs'
import http from 'http'
import path from 'path'
import FileTexts from '../../../lib/agora/fileTexts'
import Storage from '../../../lib/agora/libraryStorage'
import Extract from '../../../lib/agora/libraryExtract'
import Library from '../../../lib/agora/library'
import * as diskUploads from '../../../lib/agora/diskUploads'
import AgoraLibraryController from '../../../api/controllers/AgoraLibraryController'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const SETTINGS = [
  'AGORA_FILE_STORAGE', 'AGORA_S3_ENDPOINT', 'AGORA_S3_BUCKET', 'AGORA_S3_ACCESS_KEY', 'AGORA_S3_SECRET_KEY', 'AGORA_S3_REGION',
  'AGORA_S3_DIRECT_UPLOAD', 'AGORA_LIBRARY_DIR', 'AGORA_LIBRARY_MAX_MEDIA_MB', 'AGORA_LIBRARY_MAX_DOCUMENT_MB',
  'AGORA_LIBRARY_MAX_TRANSCRIBE_MINUTES', 'PROTOCOL', 'DOMAIN'
]

const DOCX_XML = '<w:document><w:body><w:p><w:r><w:t>River cleanup</w:t></w:r></w:p><w:p><w:r><w:t>Volunteers &amp; boats</w:t><w:tab/><w:t>12</w:t></w:r></w:p></w:body></w:document>'

/** A stand-in for S3 that keeps objects in memory and remembers every call. */
function fakeS3 () {
  const store = {}
  const multipart = {}
  const calls = []
  let next = 1
  const done = value => ({ promise: async () => value })
  return {
    store,
    calls,
    getSignedUrlPromise: async (operation, params) => {
      calls.push({ operation, params })
      const extra = params.PartNumber ? `&part=${params.PartNumber}` : ''
      return `https://s3.example.test/${params.Bucket}/${params.Key}?signed=${operation}${extra}`
    },
    createMultipartUpload: params => {
      calls.push({ operation: 'createMultipartUpload', params })
      const id = `up${next++}`
      multipart[id] = {}
      return done({ UploadId: id })
    },
    uploadPart: params => {
      calls.push({ operation: 'uploadPart', params: { ...params, Body: params.Body.length } })
      multipart[params.UploadId][params.PartNumber] = params.Body
      return done({ ETag: `"etag-${params.PartNumber}"` })
    },
    completeMultipartUpload: params => {
      calls.push({ operation: 'completeMultipartUpload', params })
      const parts = params.MultipartUpload.Parts.map(p => multipart[params.UploadId][p.PartNumber] || Buffer.alloc(0))
      store[params.Key] = Buffer.concat(parts)
      return done({})
    },
    abortMultipartUpload: params => { calls.push({ operation: 'abortMultipartUpload', params }); return done({}) },
    headObject: params => ({
      promise: async () => {
        if (!store[params.Key]) { const err = new Error('NotFound'); err.code = 'NotFound'; throw err }
        return { ContentLength: store[params.Key].length }
      }
    }),
    buckets: [],
    headBucket: function (params) {
      return { promise: async () => { if (!this.buckets.includes(params.Bucket)) { const err = new Error('NotFound'); err.code = 'NotFound'; throw err } return {} } }
    },
    createBucket: function (params) { calls.push({ operation: 'createBucket', params }); this.buckets.push(params.Bucket); return done({}) },
    putObject: params => { store[params.Key] = Buffer.from(params.Body); return done({}) },
    deleteObject: params => { delete store[params.Key]; return done({}) },
    getObject: params => ({ createReadStream: () => require('stream').Readable.from([store[params.Key]]) })
  }
}

/** A stand-in for the programs that read files. */
function fakeRunner (seen, { seconds = '30.5', pieces = 2 } = {}) {
  return async (command, args) => {
    seen.push({ command, args })
    if (command === 'pdftotext') return { stdout: Buffer.from('Budget plan for the river cleanup\fPage two: 300 francs') }
    if (command === 'unzip' && args[0] === '-p' && args[2] === 'word/document.xml') return { stdout: Buffer.from(DOCX_XML) }
    if (command === 'ffprobe') return { stdout: Buffer.from(seconds) }
    if (command === 'ffmpeg') {
      const pattern = args[args.length - 1]
      for (let i = 0; i < pieces; i++) fs.writeFileSync(pattern.replace('%03d', String(i).padStart(3, '0')), Buffer.from('sound'))
      return { stdout: Buffer.alloc(0) }
    }
    throw new Extract.ExtractError(`unexpected ${command}`)
  }
}

describe('Agora library', function () {
  // Each test makes posts and reads files; on a slow computer that takes more than mocha's two seconds.
  this.timeout(120000)
  const saved = {}
  let member, other, outsider, group, otherGroup

  before(async () => {
    for (const name of SETTINGS) saved[name] = process.env[name]
    await setup.clearDb()
    member = await new User({ name: 'Amara', email: 'amara@agora.test', active: true }).save()
    other = await new User({ name: 'Bo', email: 'bo@agora.test', active: true }).save()
    outsider = await new User({ name: 'Lars', email: 'lars@agora.test', active: true }).save()
    group = await new Group({ slug: 'water', name: 'Water circle', access_code: 'w1', settings: {} }).save()
    otherGroup = await new Group({ slug: 'care', name: 'Care circle', access_code: 'c1', settings: {} }).save()
    await member.joinGroup(group)
    await other.joinGroup(group)
    await outsider.joinGroup(otherGroup)
  })

  beforeEach(() => {
    for (const name of SETTINGS) delete process.env[name]
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    process.env.AGORA_LIBRARY_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'agora-test-library-'))
  })

  afterEach(() => {
    Storage.setS3Client(null)
    Extract.setRunner(null)
  })

  after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  function call (action, { params = {}, query = {}, headers = {}, body = {}, userId } = {}) {
    const req = factories.mock.request()
    req.params = { groupSlug: 'water', ...params }
    req.query = query
    req.headers = { 'x-agora': '1', ...headers }
    req.body = body
    req.param = name => [req.params, req.query, Buffer.isBuffer(req.body) ? {} : req.body]
      .map(source => source && source[name]).find(v => v !== undefined)
    req.on = () => req
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.headers = {}
    res.set = (name, value) => { res.headers[name] = value }
    return AgoraLibraryController[action](req, res).then(() => res)
  }

  /** Sends a whole file the way the browser does on disk storage, and adds it as an item. */
  async function addFile (userId, { name, type, contents, title, tags, description }) {
    const started = await call('startUpload', { userId, body: { name, type, size: String(contents.length) } })
    expect(started.statusCode, JSON.stringify(started.body)).to.equal(undefined)
    const { upload } = started.body
    for (let i = 0; i < upload.chunkCount; i++) {
      const piece = contents.slice(i * upload.chunkSize, (i + 1) * upload.chunkSize)
      const res = await call('chunk', {
        userId,
        params: { fileId: upload.id, index: String(i) },
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(piece.length) },
        body: piece
      })
      expect(res.statusCode, JSON.stringify(res.body)).to.equal(undefined)
    }
    const finished = await call('finish', { userId, params: { fileId: upload.id } })
    expect(finished.statusCode, JSON.stringify(finished.body)).to.equal(undefined)
    const created = await call('create', { userId, body: { title, tags, description, fileIds: [upload.id] } })
    expect(created.statusCode, JSON.stringify(created.body)).to.equal(undefined)
    return created.body.item
  }

  describe('agora_file_texts (the contract with the Ask tab)', () => {
    it('keeps the id when nothing changed, and gives a new, higher id when the text or status changes', async () => {
      const post = await factories.post({ type: 'resource', user_id: member.id }).save()
      const first = await FileTexts.saveText({ groupId: group.id, postId: post.id, kind: 'document', title: 'Plan', status: 'pending' })
      const again = await FileTexts.saveText({ groupId: group.id, postId: post.id, kind: 'document', title: 'Plan', status: 'pending' })
      expect(again.id).to.equal(first.id)
      const finished = await FileTexts.saveText({ groupId: group.id, postId: post.id, kind: 'document', title: 'Plan', text: 'Hello\u0000 world', language: 'en' })
      expect(Number(finished.id)).to.be.above(Number(first.id))
      expect(finished).to.include({ status: 'done', text: 'Hello world', language: 'en' })
      const all = await FileTexts.listForGroup(group.id)
      expect(all.filter(r => String(r.post_id) === String(post.id))).to.have.length(1)
      const newer = await FileTexts.listForGroup(group.id, first.id)
      expect(newer.map(r => r.id)).to.include(finished.id)
      expect(Object.keys(finished).sort()).to.deep.equal(['created_at', 'error', 'group_id', 'id', 'kind', 'language', 'media_id', 'post_id', 'status', 'text', 'title', 'updated_at'])
      expect(await FileTexts.listForGroup(otherGroup.id)).to.have.length(0)
    })

    it('refuses an unknown kind or status', async () => {
      await expect(FileTexts.saveText({ groupId: group.id, postId: 1, kind: 'video' })).to.be.rejectedWith(/unknown kind/)
      await expect(FileTexts.saveText({ groupId: group.id, postId: 1, kind: 'audio', status: 'busy' })).to.be.rejectedWith(/unknown status/)
    })
  })

  describe('storage', () => {
    it('uses the disk until S3 is chosen and both keys are set, with Infomaniak as the default', () => {
      expect(Storage.backend()).to.equal('disk')
      process.env.AGORA_FILE_STORAGE = 's3'
      expect(Storage.backend()).to.equal('disk')
      process.env.AGORA_S3_ACCESS_KEY = 'fake-access'
      process.env.AGORA_S3_SECRET_KEY = 'fake-secret'
      expect(Storage.backend()).to.equal('s3')
      expect(Storage.s3Settings()).to.include({ endpoint: 'https://s3.pub2.infomaniak.cloud', region: 'us-east-1', bucket: 'agora-files' })
      expect(Storage.directUploads()).to.equal(true)
      process.env.AGORA_S3_DIRECT_UPLOAD = 'off'
      expect(Storage.directUploads()).to.equal(false)
    })

    it('keeps keys inside the library folder and file names safe', () => {
      const key = Storage.makeKey(7, '../../etc/pass wd.pdf')
      expect(key).to.match(/^library\/7\/\d{4}-\d{2}\/[0-9a-f]{24}\/etcpass-wd\.pdf$/)
      expect(() => Storage.diskPath('library/../../x')).to.throw(/invalid/)
      expect(() => Storage.diskPath('.hidden/x')).to.throw(/invalid/)
      expect(Storage.diskPath(key).startsWith(Storage.libraryDir() + path.sep)).to.equal(true)
    })

    it('hands out web pages and drawings as downloads, never inside Agora', () => {
      expect(Storage.deliveryFor({ mimeType: 'text/html', fileName: 'x.html' })).to.deep.equal({
        contentType: 'application/octet-stream', disposition: 'attachment; filename="x.html"; filename*=UTF-8\'\'x.html'
      })
      expect(Storage.deliveryFor({ mimeType: 'image/svg+xml', fileName: 'a.svg' }).contentType).to.equal('application/octet-stream')
      expect(Storage.deliveryFor({ mimeType: 'audio/mpeg', fileName: 'a.mp3' })).to.include({ contentType: 'audio/mpeg' })
      expect(Storage.deliveryFor({ mimeType: 'application/pdf', fileName: 'a.pdf', download: true }).disposition).to.match(/^attachment/)
    })

    it('never serves the library folder at the public uploads address', async () => {
      delete process.env.AGORA_LIBRARY_DIR
      const res = factories.mock.response()
      res.statusCode = 200
      await new Promise(resolve => {
        res.end = () => resolve()
        diskUploads.serveUploads({ url: '/noo/uploads/.library/library/1/2026-10/abc/secret.pdf', method: 'GET' }, res, () => resolve('next'))
      })
      expect(res.statusCode).to.equal(404)
    })
  })

  describe('who may use a library', () => {
    it('lets only members of the circle list, search, open, add and download', async () => {
      const item = await addFile(member.id, { name: 'Notes.txt', type: 'text/plain', contents: Buffer.from('Secret notes about the river'), title: 'Notes' })
      const fileUrl = (await bookshelf.knex('media').where({ post_id: item.id }).first()).url
      const fileId = Library.fileIdFromUrl(fileUrl)

      for (const [action, extra] of [
        ['list', {}],
        ['list', { query: { search: 'river' } }],
        ['show', { params: { postId: item.id } }],
        ['settings', {}],
        ['startUpload', { body: { name: 'x.pdf', type: 'application/pdf', size: '10' } }],
        ['create', { body: { title: 'Sneaky', link: 'https://example.org' } }],
        ['download', { params: { fileId } }]
      ]) {
        const res = await call(action, { userId: outsider.id, ...extra })
        expect(res.statusCode, `${action} as an outsider`).to.equal(403)
        expect(JSON.stringify(res.body)).not.to.include('Secret')
      }

      const loggedOut = await call('list', {})
      expect(loggedOut.statusCode).to.equal(401)

      // A member of another circle cannot reach this circle's files by asking for that circle.
      const viaOwnCircle = await call('show', { userId: outsider.id, params: { groupSlug: 'care', postId: item.id } })
      expect(viaOwnCircle.statusCode).to.equal(404)

      const asMember = await call('list', { userId: other.id, query: { search: 'river' } })
      expect(asMember.body.items.map(i => i.id)).to.include(item.id)
    })

    it('refuses changes without the Agora header, and pieces of someone else\'s upload', async () => {
      const noHeader = await call('startUpload', { userId: member.id, headers: { 'x-agora': '' }, body: { name: 'a.txt', size: '3' } })
      expect(noHeader.statusCode).to.equal(400)
      const started = await call('startUpload', { userId: member.id, body: { name: 'a.txt', type: 'text/plain', size: '3' } })
      const theirs = await call('chunk', {
        userId: other.id,
        params: { fileId: started.body.upload.id, index: '0' },
        headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
        body: Buffer.from('abc')
      })
      expect(theirs.statusCode).to.equal(404)
      const attach = await call('create', { userId: other.id, body: { title: 'x', fileIds: [started.body.upload.id] } })
      expect(attach.statusCode).to.equal(409)
    })

    it('stops serving a file once its post is removed', async () => {
      const item = await addFile(member.id, { name: 'Old.txt', type: 'text/plain', contents: Buffer.from('old'), title: 'Old' })
      const media = await bookshelf.knex('media').where({ post_id: item.id }).first()
      await bookshelf.knex('posts').where({ id: item.id }).update({ active: false })
      const res = await call('download', { userId: member.id, params: { fileId: Library.fileIdFromUrl(media.url) } })
      expect(res.statusCode).to.equal(404)
    })
  })

  describe('adding to the library on disk', () => {
    it('limits recordings to 500 MB and other files to 100 MB, and both can be changed', async () => {
      const big = await call('startUpload', { userId: member.id, body: { name: 'Assembly.mp3', type: 'audio/mpeg', size: String(501 * 1048576) } })
      expect(big.statusCode).to.equal(413)
      expect(big.body.error).to.match(/500 MB/)
      const fine = await call('startUpload', { userId: member.id, body: { name: 'Assembly.mp3', type: 'audio/mpeg', size: String(400 * 1048576) } })
      expect(fine.body.upload).to.include({ mode: 'chunks', kind: 'audio', chunkSize: Library.CHUNK_BYTES, chunkCount: 50 })
      const pdf = await call('startUpload', { userId: member.id, body: { name: 'Report.pdf', type: 'application/pdf', size: String(101 * 1048576) } })
      expect(pdf.statusCode).to.equal(413)
      process.env.AGORA_LIBRARY_MAX_DOCUMENT_MB = '200'
      const pdfAgain = await call('startUpload', { userId: member.id, body: { name: 'Report.pdf', type: 'application/pdf', size: String(101 * 1048576) } })
      expect(pdfAgain.body.upload.kind).to.equal('document')
    })

    it('makes a resource post in the circle with the file attached, that only members can download', async () => {
      Extract.setRunner(fakeRunner([]))
      const contents = Buffer.from('%PDF-1.4 a pretend pdf')
      const item = await addFile(member.id, { name: 'River plan.pdf', type: 'application/pdf', contents, title: 'River plan', tags: 'water, Budget 2027', description: 'The plan we agreed.' })
      expect(item).to.include({ title: 'River plan', kind: 'document' })
      expect(item.addedBy.name).to.equal('Amara')
      expect(item.tags.sort()).to.deep.equal(['budget-2027', 'water'])

      const post = await Post.find(item.id)
      expect(post.get('type')).to.equal('resource')
      const inCircle = await bookshelf.knex('groups_posts').where({ post_id: item.id, group_id: group.id }).first()
      expect(inCircle).to.exist
      const media = await bookshelf.knex('media').where({ post_id: item.id }).first()
      expect(media).to.include({ type: 'file', name: 'River plan.pdf' })
      expect(media.url).to.match(/^https:\/\/agora\.example\.org\/noo\/agora\/library\/file\/\d+\/River-plan\.pdf$/)

      // The file is on disk, outside the public uploads address, and comes back whole for a member.
      const file = await Library.fileForDownload({ userId: other.id, fileId: Library.fileIdFromUrl(media.url) })
      expect(file.storage).to.equal('disk')
      expect(fs.readFileSync(Storage.diskPath(file.storage_key)).toString()).to.equal(contents.toString())

      const server = http.createServer((req, res) => Storage.serveDisk(req, res, file.storage_key, { mimeType: file.mime_type, fileName: file.file_name }))
      await new Promise(resolve => server.listen(0, resolve))
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/x`, { headers: { Range: 'bytes=0-3' } })
        expect(response.status).to.equal(206)
        expect(response.headers.get('content-type')).to.equal('application/pdf')
        expect(response.headers.get('x-content-type-options')).to.equal('nosniff')
        expect(await response.text()).to.equal('%PDF')
      } finally {
        server.close()
      }
    })

    it('refuses a piece of the wrong size, and a file that did not fully arrive', async () => {
      const started = await call('startUpload', { userId: member.id, body: { name: 'a.txt', type: 'text/plain', size: '10' } })
      const id = started.body.upload.id
      const wrong = await call('chunk', {
        userId: member.id,
        params: { fileId: id, index: '0' },
        headers: { 'content-type': 'application/octet-stream', 'content-length': '4' },
        body: Buffer.from('abcd')
      })
      expect(wrong.statusCode).to.equal(400)
      const early = await call('finish', { userId: member.id, params: { fileId: id } })
      expect(early.statusCode).to.equal(409)
    })

    it('adds a link without a file', async () => {
      const res = await call('create', { userId: member.id, body: { title: 'Water law', link: 'https://example.org/law', description: 'Read this' } })
      expect(res.body.item).to.include({ kind: 'link', link: 'https://example.org/law' })
      const bad = await call('create', { userId: member.id, body: { title: 'x', link: 'javascript:alert(1)' } })
      expect(bad.statusCode).to.equal(400)
    })
  })

  describe('adding to the library in S3 (a pretend S3)', () => {
    let s3
    beforeEach(() => {
      process.env.AGORA_FILE_STORAGE = 's3'
      process.env.AGORA_S3_ACCESS_KEY = 'fake-access'
      process.env.AGORA_S3_SECRET_KEY = 'fake-secret'
      process.env.AGORA_S3_BUCKET = 'test-library'
      s3 = fakeS3()
      Storage.setS3Client(s3)
    })

    it('lets the browser send a small file straight to S3 with one signed address', async () => {
      const started = await call('startUpload', { userId: member.id, body: { name: 'Photo.png', type: 'image/png', size: '5' } })
      const { upload } = started.body
      expect(upload.mode).to.equal('single')
      expect(upload.url).to.match(/^https:\/\/s3\.example\.test\/test-library\/library\/\d+\/.*Photo\.png\?signed=putObject$/)
      expect(upload.headers).to.deep.equal({ 'Content-Type': 'image/png' })
      const notYet = await call('finish', { userId: member.id, params: { fileId: upload.id } })
      expect(notYet.statusCode).to.equal(409)
      const file = await bookshelf.knex('agora_library_files').where({ id: upload.id }).first()
      s3.store[file.storage_key] = Buffer.from('12345') // what the browser would have sent
      const finished = await call('finish', { userId: member.id, params: { fileId: upload.id } })
      expect(finished.body).to.deep.equal({ id: upload.id, stored: true })
      // The bucket did not exist: it was made once, private.
      expect(s3.calls.filter(c => c.operation === 'createBucket')).to.deep.equal([{ operation: 'createBucket', params: { Bucket: 'test-library', ACL: 'private' } }])
    })

    it('sends a big file in parts, and hands it out through a short signed address with a safe type', async () => {
      const size = 40 * 1048576
      const started = await call('startUpload', { userId: member.id, body: { name: 'Assembly.m4a', type: 'audio/mp4', size: String(size) } })
      const { upload } = started.body
      expect(upload).to.include({ mode: 'multipart', partSize: 16 * 1048576, partCount: 3 })
      const urls = await call('partUrls', { userId: member.id, params: { fileId: upload.id }, body: { parts: [1, 2, 3] } })
      expect(Object.keys(urls.body.urls)).to.deep.equal(['1', '2', '3'])
      expect(urls.body.urls[2]).to.include('signed=uploadPart&part=2')
      const tooMany = await call('partUrls', { userId: member.id, params: { fileId: upload.id }, body: { parts: [4] } })
      expect(tooMany.statusCode).to.equal(400)

      const file = await bookshelf.knex('agora_library_files').where({ id: upload.id }).first()
      // What the browser would have sent to the three addresses:
      s3.uploadPart({ UploadId: file.s3_upload_id, PartNumber: 1, Body: Buffer.alloc(16 * 1048576) })
      s3.uploadPart({ UploadId: file.s3_upload_id, PartNumber: 2, Body: Buffer.alloc(16 * 1048576) })
      s3.uploadPart({ UploadId: file.s3_upload_id, PartNumber: 3, Body: Buffer.alloc(8 * 1048576) })
      const missing = await call('finish', { userId: member.id, params: { fileId: upload.id }, body: { parts: [{ partNumber: 1, etag: '"etag-1"' }] } })
      expect(missing.statusCode).to.equal(409)
      const finished = await call('finish', {
        userId: member.id,
        params: { fileId: upload.id },
        body: { parts: [3, 1, 2].map(n => ({ partNumber: n, etag: `"etag-${n}"` })) }
      })
      expect(finished.body.stored).to.equal(true)
      const complete = s3.calls.find(c => c.operation === 'completeMultipartUpload')
      expect(complete.params.MultipartUpload.Parts.map(p => p.PartNumber)).to.deep.equal([1, 2, 3])

      const created = await call('create', { userId: member.id, body: { title: 'Assembly recording', fileIds: [upload.id] } })
      expect(created.body.item.kind).to.equal('audio')
      const media = await bookshelf.knex('media').where({ post_id: created.body.item.id }).first()
      const res = await call('download', { userId: other.id, params: { fileId: Library.fileIdFromUrl(media.url) } })
      expect(res.redirected).to.match(/signed=getObject/)
      const get = s3.calls.filter(c => c.operation === 'getObject').pop()
      expect(get.params).to.include({ ResponseContentType: 'audio/mp4', Expires: 300 })
      expect(get.params.ResponseContentDisposition).to.match(/^inline; filename="Assembly\.m4a"/)
    })

    it('checks the storage: makes the bucket, writes, reads back and deletes', async () => {
      s3.getObject = params => ({
        createReadStream: () => require('stream').Readable.from([s3.store[params.Key]]),
        promise: async () => ({ Body: s3.store[params.Key] })
      })
      const results = await Storage.checkS3()
      expect(results).to.deep.equal(['bucket', 'write', 'read', 'delete'].map(step => ({ step, ok: true })))
      expect(Object.keys(s3.store)).to.have.length(0)
      s3.putObject = () => ({ promise: async () => { const err = new Error('denied'); err.code = 'AccessDenied'; throw err } })
      const failed = await Storage.checkS3()
      expect(failed.pop()).to.deep.equal({ step: 'write', ok: false, error: 'AccessDenied' })
    })

    it('sends the file through Agora when the browser cannot reach S3', async () => {
      const started = await call('startUpload', { userId: member.id, body: { name: 'Plan.txt', type: 'text/plain', size: '6' } })
      const relayed = await call('relay', { userId: member.id, params: { fileId: started.body.upload.id } })
      expect(relayed.body.upload).to.include({ mode: 'chunks', chunkCount: 1 })
      await call('chunk', {
        userId: member.id,
        params: { fileId: started.body.upload.id, index: '0' },
        headers: { 'content-type': 'application/octet-stream', 'content-length': '6' },
        body: Buffer.from('hello!')
      })
      const finished = await call('finish', { userId: member.id, params: { fileId: started.body.upload.id } })
      expect(finished.body.stored).to.equal(true)
      const file = await bookshelf.knex('agora_library_files').where({ id: started.body.upload.id }).first()
      expect(s3.store[file.storage_key].toString()).to.equal('hello!')
    })
  })

  describe('reading the text of files', () => {
    let original
    before(() => { original = { transcribe: Transcription.transcribe, isConfigured: Transcription.isConfigured } })
    afterEach(() => Object.assign(Transcription, original))

    it('reads a PDF and a Word file, and the search finds words inside them', async () => {
      const seen = []
      Extract.setRunner(fakeRunner(seen))
      const pdf = await addFile(member.id, { name: 'Budget.pdf', type: 'application/pdf', contents: Buffer.from('%PDF pretend'), title: 'Budget' })
      const word = await addFile(member.id, { name: 'Volunteers.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', contents: Buffer.from('PK pretend'), title: 'Volunteer list' })
      await Library.extractPost({ postId: pdf.id })
      await Library.extractPost({ postId: word.id })
      expect(seen.map(s => s.command)).to.deep.equal(['pdftotext', 'unzip'])

      const pdfText = (await FileTexts.listForPost(pdf.id))[0]
      expect(pdfText).to.include({ kind: 'document', status: 'done', title: 'Budget.pdf' })
      expect(pdfText.text).to.equal('Budget plan for the river cleanup\n\nPage two: 300 francs')
      expect(String(pdfText.group_id)).to.equal(String(group.id))
      expect(pdfText.media_id).to.exist
      const wordText = (await FileTexts.listForPost(word.id))[0]
      expect(wordText.text).to.equal('River cleanup\nVolunteers & boats\t12')

      const found = await call('list', { userId: member.id, query: { search: '300 francs' } })
      expect(found.body.items.map(i => i.id)).to.deep.equal([pdf.id])
      expect(found.body.items[0].snippet).to.include('300 francs')
      expect(found.body.items[0].textStatus).to.equal('done')
      const byTitle = await call('list', { userId: member.id, query: { search: 'volunteer list' } })
      expect(byTitle.body.items.map(i => i.id)).to.deep.equal([word.id])
      const byKind = await call('list', { userId: member.id, query: { kind: 'link' } })
      expect(byKind.body.items.every(i => i.kind === 'link')).to.equal(true)

      // Running the job again reads nothing twice.
      await Library.extractPost({ postId: pdf.id })
      expect(seen).to.have.length(2)

      const shown = await call('show', { userId: member.id, params: { postId: pdf.id } })
      expect(shown.body.item.texts[0].text).to.include('river cleanup')
      expect(shown.body.item.files[0]).to.include({ name: 'Budget.pdf', kind: 'document', mimeType: 'application/pdf' })
    })

    it('keeps a recording and its transcript, cut into pieces of 10 minutes for speech to text', async () => {
      const seen = []
      Extract.setRunner(fakeRunner(seen, { seconds: '1205', pieces: 3 }))
      const sent = []
      Transcription.isConfigured = () => true
      Transcription.transcribe = async ({ audio, mimeType, timeoutMs }) => {
        sent.push({ bytes: audio.length, mimeType, timeoutMs })
        return `part ${sent.length}`
      }
      const item = await addFile(member.id, { name: 'Call.m4a', type: 'audio/mp4', contents: Buffer.from('pretend sound'), title: 'Call with the mayor' })
      await Library.extractPost({ postId: item.id })
      const ffmpeg = seen.find(s => s.command === 'ffmpeg')
      expect(ffmpeg.args).to.include.members(['-segment_time', '600', '-ac', '1'])
      expect(sent).to.deep.equal([1, 2, 3].map(() => ({ bytes: 5, mimeType: 'audio/mpeg', timeoutMs: 600000 })))
      const text = (await FileTexts.listForPost(item.id))[0]
      expect(text).to.include({ kind: 'audio', status: 'done' })
      expect(text.text).to.equal('[0:00] part 1\n\n[10:00] part 2\n\n[20:00] part 3')
      const file = await bookshelf.knex('agora_library_files').where({ post_id: item.id }).first()
      expect(file.duration_seconds).to.equal(1205)
      expect(fs.existsSync(Storage.diskPath(file.storage_key))).to.equal(true) // the sound is kept
    })

    it('does not send a recording that is too long, or when speech to text is not connected', async () => {
      Extract.setRunner(fakeRunner([], { seconds: String(5 * 3600) }))
      Transcription.isConfigured = () => true
      Transcription.transcribe = async () => { throw new Error('should not be called') }
      const long = await addFile(member.id, { name: 'Long.mp3', type: 'audio/mpeg', contents: Buffer.from('x'), title: 'Long' })
      await Library.extractPost({ postId: long.id })
      expect((await FileTexts.listForPost(long.id))[0]).to.include({ status: 'too_big' })

      Extract.setRunner(fakeRunner([], { seconds: '60' }))
      Transcription.isConfigured = () => false
      const off = await addFile(member.id, { name: 'Short.mp3', type: 'audio/mpeg', contents: Buffer.from('x'), title: 'Short' })
      await Library.extractPost({ postId: off.id })
      const row = (await FileTexts.listForPost(off.id))[0]
      expect(row.status).to.equal('failed')
      expect(row.error).to.match(/not connected/)
    })

    it('stores the size of a picture and leaves its text for later', async () => {
      // A white picture of 3 by 2 pixels.
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwMMcBYAs2AR78H3GQQAAAAASUVORK5CYII=', 'base64')
      const item = await addFile(member.id, { name: 'Map.png', type: 'image/png', contents: png, title: 'Map' })
      expect(item.kind).to.equal('image')
      await Library.extractPost({ postId: item.id })
      const file = await bookshelf.knex('agora_library_files').where({ post_id: item.id }).first()
      expect([file.width, file.height]).to.deep.equal([3, 2])
      const media = await bookshelf.knex('media').where({ post_id: item.id }).first()
      expect(media).to.include({ type: 'image', width: 3, height: 2 })
      expect((await FileTexts.listForPost(item.id))[0]).to.include({ kind: 'image', status: 'pending', text: '' })
    })

    it('reads an attachment that was added with Hylo\'s own post editor', async () => {
      const { url } = await diskUploads.writeString('Minutes of the spring gathering', 'evo-uploads/user/1/post/1/spring.txt')
      const post = await factories.post({ type: 'resource', user_id: member.id, name: 'Spring gathering' }).save()
      await post.groups().attach([group.id])
      await bookshelf.knex('media').insert({ post_id: post.id, type: 'file', url, created_at: new Date() })
      await Library.extractPost({ postId: post.id })
      const row = (await FileTexts.listForPost(post.id))[0]
      expect(row).to.include({ kind: 'document', status: 'done', text: 'Minutes of the spring gathering', title: 'spring.txt' })
      const listed = await call('list', { userId: member.id, query: { search: 'spring gathering' } })
      expect(listed.body.items[0]).to.include({ id: String(post.id), kind: 'document' })
    })

    it('turns Office and web page markup into plain text', () => {
      expect(Extract.odfXmlToText('<office:text><text:h>Title</text:h><text:p>One<text:s/>two<text:tab/>three</text:p></office:text>')).to.equal('Title\nOne two\tthree')
      expect(Extract.slideXmlToText('<p:sld><a:p><a:r><a:t>Slide &lt;one&gt;</a:t></a:r></a:p></p:sld>')).to.equal('Slide <one>')
      expect(Extract.htmlToText('<p>Hi&nbsp;</p><script>alert(1)</script><p>there &amp; you</p>')).to.equal('Hi&nbsp;\nthere & you')
      expect(Extract.documentType('notes.MD', '')).to.equal('text')
      expect(Extract.documentType('old.doc', 'application/msword')).to.equal(null)
    })
  })

  describe('meeting notes', () => {
    async function endedMeeting (name) {
      const event = await factories.post({ type: 'event', user_id: member.id, name }).save()
      await event.groups().attach([group.id])
      const started = new Date(Date.now() - 600000)
      const [session] = await bookshelf.knex('meeting_sessions').insert({
        post_id: event.id,
        room_name: `agora-${event.id}-test`,
        status: 'closing',
        started_by_id: member.id,
        started_at: started,
        ended_at: new Date(),
        last_activity_at: new Date(),
        created_at: started,
        updated_at: started
      }).returning('*')
      await bookshelf.knex('meeting_participants').insert([
        { session_id: session.id, user_id: member.id, joined_at: started },
        { session_id: session.id, user_id: other.id, joined_at: new Date(started.getTime() + 1000) }
      ])
      await bookshelf.knex('meeting_segments').insert([
        { session_id: session.id, user_id: member.id, spoken_at: new Date(started.getTime() + 5000), text: 'We clean the river on Saturday.', status: 'done', created_at: started, updated_at: started },
        { session_id: session.id, user_id: other.id, spoken_at: new Date(started.getTime() + 200000), text: 'I bring the boats.', status: 'done', created_at: started, updated_at: started }
      ])
      return { event, session }
    }

    it('files the transcript in the library of the event\'s circle when a meeting ends, once', async () => {
      const { session } = await endedMeeting('River call')
      const minutesPost = await MeetingSession.finalize({ sessionId: session.id })
      expect(minutesPost).to.exist

      const item = await bookshelf.knex('agora_library_items').where({ meeting_session_id: session.id }).first()
      expect(item).to.include({ kind: 'meeting' })
      expect(String(item.group_id)).to.equal(String(group.id))
      const post = await Post.find(item.post_id)
      expect(post.get('type')).to.equal('resource')
      expect(post.get('name')).to.match(/^Meeting notes: River call \(\d{4}-\d{2}-\d{2}\)$/)

      const text = (await FileTexts.listForPost(item.post_id))[0]
      expect(text).to.include({ kind: 'meeting', status: 'done' })
      expect(text.text).to.include('Present: Amara, Bo')
      expect(text.text).to.include('Amara: We clean the river on Saturday.')
      expect(text.text).to.include('Bo: I bring the boats.')
      expect(text.media_id).to.exist

      const files = await bookshelf.knex('agora_library_files').where({ post_id: item.post_id })
      expect(files.map(f => f.file_name)[0]).to.match(/^Transcript \d{4}-\d{2}-\d{2}\.txt$/)
      expect(fs.readFileSync(Storage.diskPath(files[0].storage_key), 'utf8')).to.include('I bring the boats.')

      const listed = await call('list', { userId: other.id, query: { kind: 'meeting' } })
      expect(listed.body.items.map(i => i.id)).to.include(String(item.post_id))
      const outsiderSearch = await call('list', { userId: outsider.id, query: { search: 'boats' } })
      expect(outsiderSearch.statusCode).to.equal(403)

      const again = await Library.fileMeeting({ sessionId: session.id, title: 'x', date: '2026-10-19', lines: [{ name: 'A', text: 'b', spokenAt: new Date() }], groupIds: [group.id], assistantId: member.id })
      expect(again).to.have.length(0)
    })

    it('catches up meetings that ended before the library, only when asked', async () => {
      // Earlier tests left resource posts whose text would be read; they are not the point here.
      await bookshelf.knex('posts').where({ type: 'resource' }).update({ active: false })
      const { session } = await endedMeeting('Old call')
      const minutes = await factories.post({ type: 'discussion', user_id: member.id, name: 'Minutes: Old call', description: '<h3>Summary</h3><p>We agreed on boats.</p><h3>Who was there</h3><p>Amara</p><h3>Transcript</h3><p>...</p>' }).save()
      await bookshelf.knex('meeting_sessions').where({ id: session.id }).update({ status: 'closed', minutes_post_id: minutes.id })

      const dry = await Library.backfill({ apply: false })
      expect(dry.meetings.map(m => String(m.sessionId))).to.include(String(session.id))
      expect(await bookshelf.knex('agora_library_items').where({ meeting_session_id: session.id }).first()).to.equal(undefined)

      await Library.backfill({ apply: true })
      const item = await bookshelf.knex('agora_library_items').where({ meeting_session_id: session.id }).first()
      expect(item).to.exist
      const text = (await FileTexts.listForPost(item.post_id))[0]
      expect(text.text).to.include('We agreed on boats.')
      expect(text.text).to.include('Old call')

      const after = await Library.backfill({ apply: false })
      expect(after.meetings.map(m => String(m.sessionId))).not.to.include(String(session.id))
    })
  })
})
