/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
/* global Group, User, UploadController */
/**
 * Agora: uploads kept on Agora's own disk when there is no Amazon S3.
 *
 * Files go to a fresh temporary folder. Like every backend test this needs a
 * database and empties it first, so never point it at one you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/diskUploads.test.js
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'
import { Readable } from 'stream'
import mockRequire from 'mock-require'
import sharp from 'sharp'
import * as diskUploads from '../../../lib/agora/diskUploads'
import * as storage from '../../../lib/uploader/storage'
import { upload } from '../../../lib/uploader'
const rootPath = require('root-path')
require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const SETTINGS = [
  'AWS_S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_CONTENT_URL',
  'UPLOADER_PATH_PREFIX', 'UPLOADER_HOST', 'AGORA_UPLOADS_DIR', 'AGORA_UPLOADS_URL', 'PROTOCOL', 'DOMAIN'
]

function filesIn (dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? filesIn(full) : [full]
  })
}

function readAll (stream) {
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

describe('Agora uploads on disk', () => {
  let saved, base, dir, outside

  beforeEach(() => {
    saved = Object.fromEntries(SETTINGS.map(name => [name, process.env[name]]))
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-uploads-test-'))
    dir = path.join(base, 'uploads')
    outside = path.join(base, 'secret.txt')
    fs.mkdirSync(dir)
    fs.writeFileSync(outside, 'not for the internet')
    process.env.AWS_S3_BUCKET = ''
    process.env.AWS_ACCESS_KEY_ID = ''
    process.env.AWS_S3_CONTENT_URL = ''
    process.env.UPLOADER_PATH_PREFIX = 'evo-uploads'
    process.env.AGORA_UPLOADS_DIR = dir
    process.env.AGORA_UPLOADS_URL = ''
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
  })

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    fs.rmSync(base, { recursive: true, force: true })
  })

  describe('choosing where files go', () => {
    it('uses the disk when no S3 bucket is set', () => {
      expect(diskUploads.inUse()).to.be.true
    })

    it('uses the disk when a bucket is set but no key (the example settings)', () => {
      process.env.AWS_S3_BUCKET = 'hylo-staging'
      expect(diskUploads.inUse()).to.be.true
    })

    it('uses S3 when the bucket and the key are both set', () => {
      process.env.AWS_S3_BUCKET = 'a-bucket'
      process.env.AWS_ACCESS_KEY_ID = 'made-up-id'
      expect(diskUploads.inUse()).to.be.false
    })

    it('gives the address of the files on this server, or the S3 address', () => {
      expect(diskUploads.contentUrl()).to.equal('https://agora.example.org/noo/uploads')
      process.env.AGORA_UPLOADS_URL = 'https://files.example.org/'
      expect(diskUploads.contentUrl()).to.equal('https://files.example.org')
      process.env.AWS_S3_BUCKET = 'a-bucket'
      process.env.AWS_ACCESS_KEY_ID = 'made-up-id'
      process.env.AWS_S3_CONTENT_URL = 'https://a-bucket.s3.amazonaws.com'
      expect(diskUploads.contentUrl()).to.equal('https://a-bucket.s3.amazonaws.com')
    })
  })

  describe('with S3 set up', () => {
    let s3Storage
    const calls = []

    class MockS3 {
      upload (params) {
        calls.push(['upload', params])
        return { isMock: true, on: () => {} }
      }

      putObject (params, callback) {
        calls.push(['putObject', params])
        callback(null, {})
      }
    }

    // A second copy of storage.js with a pretend S3. The real copy goes back
    // afterwards, so later tests that replace its functions still reach it.
    const storagePath = require.resolve('../../../lib/uploader/storage')
    let realStorage

    before(() => {
      realStorage = require.cache[storagePath]
      mockRequire('aws-sdk', { S3: MockS3 })
      s3Storage = mockRequire.reRequire('../../../lib/uploader/storage')
    })

    after(() => {
      mockRequire.stopAll()
      if (realStorage) require.cache[storagePath] = realStorage
      else delete require.cache[storagePath]
    })

    beforeEach(() => {
      calls.length = 0
      process.env.AWS_S3_BUCKET = 'a-bucket'
      process.env.AWS_ACCESS_KEY_ID = 'made-up-id'
      process.env.AWS_SECRET_ACCESS_KEY = 'made-up-secret'
      process.env.AWS_S3_CONTENT_URL = 'https://a-bucket.s3.amazonaws.com'
    })

    it('still sends uploads to S3 and writes nothing to disk', () => {
      const stream = s3Storage.createS3StorageStream('post', 'new', { userId: 1, filename: 'a.pdf' })
      expect(stream.upload.isMock).to.be.true
      expect(calls[0][0]).to.equal('upload')
      expect(calls[0][1].Bucket).to.equal('a-bucket')
      expect(filesIn(dir)).to.deep.equal([])
    })

    it('still writes calendar files to S3', async () => {
      const result = await s3Storage.writeStringToS3('BEGIN:VCALENDAR', 'evo-uploads/group/1/calendar-x.ics', { ContentType: 'text/calendar' })
      expect(calls[0][0]).to.equal('putObject')
      expect(result.url).to.equal('https://a-bucket.s3.amazonaws.com/evo-uploads/group/1/calendar-x.ics')
      expect(filesIn(dir)).to.deep.equal([])
    })
  })

  describe('writing', () => {
    it('stores an upload in the folder and gives its address', async () => {
      const result = await upload({
        type: 'post',
        id: 'new',
        userId: '7',
        stream: Readable.from([Buffer.from('%PDF-1.4 made-up document')]),
        filename: 'minutes of the meeting.pdf'
      })
      const files = filesIn(dir)
      expect(files).to.have.length(1)
      expect(files[0]).to.match(/uploads\/evo-uploads\/user\/7\/post\/new\/minutes-of-the-meeting_\d+_[a-z0-9]+\.pdf$/)
      expect(fs.readFileSync(files[0], 'utf8')).to.equal('%PDF-1.4 made-up document')
      expect(result.url).to.equal(`https://agora.example.org/noo/uploads/${path.relative(dir, files[0])}`)
      expect(diskUploads.keyFromUrl(result.url)).to.equal(path.relative(dir, files[0]))
    })

    it('replaces an avatar at the same address', async () => {
      for (const text of ['first', 'second']) {
        const stream = storage.createS3StorageStream('userAvatar', 7, { userId: 7, filename: 'me.txt' })
        const done = readAll(stream)
        stream.end(text)
        await done
        expect(stream.url).to.equal('https://agora.example.org/noo/uploads/evo-uploads/user/7/userAvatar/7/me.txt')
      }
      const files = filesIn(dir)
      expect(files).to.have.length(1)
      expect(fs.readFileSync(files[0], 'utf8')).to.equal('second')
    })

    it('reports progress like the S3 stream', async () => {
      const stream = storage.createS3StorageStream('post', 'new', { userId: 7, filename: 'a.txt' })
      const seen = []
      stream.on('progress', progress => seen.push(progress.loaded))
      const done = readAll(stream)
      stream.write('12345')
      stream.end('678')
      await done
      expect(seen[seen.length - 1]).to.equal(8)
    })

    it('writes a calendar file and points the circle calendar address at it', async () => {
      const group = Group.forge({ id: 12, calendar_token: 'made-up-token' })
      const result = await storage.writeStringToS3('BEGIN:VCALENDAR', group.getEventCalendarPath(), { ContentType: 'text/calendar' })
      expect(result.url).to.equal(group.eventCalendarUrl())
      expect(group.eventCalendarUrl()).to.equal('https://agora.example.org/noo/uploads/evo-uploads/group/12/calendar-made-up-token.ics')
      expect(fs.readFileSync(path.join(dir, 'evo-uploads/group/12/calendar-made-up-token.ics'), 'utf8')).to.equal('BEGIN:VCALENDAR')
      const user = User.forge({ id: 3, calendar_token: 'other-token' })
      expect(user.rsvpCalendarUrl()).to.equal('https://agora.example.org/noo/uploads/evo-uploads/user/3/calendar-other-token.ics')
    })

    it('deletes our own files and leaves other addresses alone', async () => {
      await storage.writeStringToS3('one', 'evo-uploads/user/1/post/new/a.txt')
      await storage.writeStringToS3('two', 'evo-uploads/user/1/post/new/b.txt')
      await storage.deleteS3Objects([
        'https://agora.example.org/noo/uploads/evo-uploads/user/1/post/new/a.txt',
        'https://elsewhere.example.org/noo/uploads/evo-uploads/user/1/post/new/b.txt',
        'https://agora.example.org/noo/uploads/evo-uploads/..%2F..%2Fsecret.txt',
        null
      ])
      expect(filesIn(dir).map(f => path.basename(f))).to.deep.equal(['b.txt'])
      expect(fs.existsSync(outside)).to.be.true
      await storage.deleteFromS3('evo-uploads/user/1/post/new/b.txt')
      expect(filesIn(dir)).to.deep.equal([])
    })
  })

  describe('refusing paths outside the folder', () => {
    const bad = ['../secret.txt', 'evo-uploads/../../secret.txt', '/etc/passwd', 'a//b', 'a/./b',
      'evo-uploads/.hidden', 'a\\..\\b', 'a/b\0c', '', null]

    for (const key of bad) {
      it(`refuses ${JSON.stringify(key)}`, async () => {
        expect(() => diskUploads.filePath(key)).to.throw('invalid file path')
        let error
        try { await storage.writeStringToS3('x', key) } catch (err) { error = err }
        expect(error).to.exist
      })
    }

    it('keeps a file name with dots and slashes inside its own folder', () => {
      const key = storage.makePath('post', 'new', { userId: 7, filename: '../../../../etc/passwd' })
      expect(diskUploads.filePath(key).startsWith(dir + path.sep)).to.be.true
      expect(key).to.match(/^evo-uploads\/user\/7\/post\/new\/passwd_/)
    })
  })

  describe('serving', () => {
    let server, address

    before(done => {
      server = http.createServer((req, res) => diskUploads.serveUploads(req, res, () => {
        res.statusCode = 418
        res.end('not ours')
      }))
      server.listen(0, '127.0.0.1', () => {
        address = `http://127.0.0.1:${server.address().port}`
        done()
      })
    })

    after(done => server.close(done))

    beforeEach(async () => {
      await storage.writeStringToS3('a picture', 'evo-uploads/user/1/userAvatar/1/me.png')
      await storage.writeStringToS3('<script>alert(1)</script>', 'evo-uploads/user/1/post/new/page.html')
      fs.writeFileSync(path.join(dir, 'evo-uploads/user/1/post/new/.half.png.abc.part'), 'half')
    })

    it('serves a stored file with safe headers', async () => {
      const response = await fetch(`${address}/noo/uploads/evo-uploads/user/1/userAvatar/1/me.png`)
      expect(response.status).to.equal(200)
      expect(await response.text()).to.equal('a picture')
      expect(response.headers.get('content-type')).to.equal('image/png')
      expect(response.headers.get('content-disposition')).to.equal('inline')
      expect(response.headers.get('x-content-type-options')).to.equal('nosniff')
      expect(response.headers.get('content-security-policy')).to.include('sandbox')
    })

    it('offers a web page as a download, never as part of the site', async () => {
      const response = await fetch(`${address}/noo/uploads/evo-uploads/user/1/post/new/page.html`)
      expect(response.status).to.equal(200)
      expect(response.headers.get('content-disposition')).to.equal('attachment')
      expect(response.headers.get('content-security-policy')).to.include('sandbox')
    })

    it('serves part of a file, for video players', async () => {
      const response = await fetch(`${address}/noo/uploads/evo-uploads/user/1/userAvatar/1/me.png`, { headers: { Range: 'bytes=0-0' } })
      expect(response.status).to.equal(206)
      expect(await response.text()).to.equal('a')
    })

    for (const evil of [
      '/noo/uploads/../secret.txt',
      '/noo/uploads/%2e%2e/secret.txt',
      '/noo/uploads/..%2fsecret.txt',
      '/noo/uploads/evo-uploads/%2e%2e%2f%2e%2e%2f..%2fsecret.txt',
      '/noo/uploads/%2fetc%2fpasswd',
      '/noo/uploads/evo-uploads%00/x'
    ]) {
      it(`never serves a file outside the folder: ${evil}`, async () => {
        const response = await new Promise((resolve, reject) => {
          // Raw request, so the client does not tidy up the path first
          http.get(`${address}${evil}`, { path: evil }, resolve).on('error', reject)
        })
        let body = ''
        for await (const chunk of response) body += chunk
        expect(response.statusCode).to.be.oneOf([400, 403, 404])
        expect(body).not.to.include('not for the internet')
      })
    }

    it('lists no folders', async () => {
      for (const p of ['/noo/uploads', '/noo/uploads/', '/noo/uploads/evo-uploads', '/noo/uploads/evo-uploads/user/1/']) {
        const response = await fetch(`${address}${p}`, { redirect: 'manual' })
        expect(response.status, p).to.be.oneOf([403, 404])
        expect(await response.text(), p).not.to.include('me.png')
      }
    })

    it('never serves hidden or half-written files', async () => {
      const response = await fetch(`${address}/noo/uploads/evo-uploads/user/1/post/new/.half.png.abc.part`)
      expect(response.status).to.be.oneOf([403, 404])
    })

    it('only reads', async () => {
      const response = await fetch(`${address}/noo/uploads/evo-uploads/user/1/userAvatar/1/me.png`, { method: 'PUT', body: 'x' })
      expect(response.status).to.equal(405)
      expect(fs.readFileSync(path.join(dir, 'evo-uploads/user/1/userAvatar/1/me.png'), 'utf8')).to.equal('a picture')
    })

    it('leaves every other address to the rest of the server', async () => {
      for (const p of ['/noo/graphql', '/noo/uploadsx/a', '/noo/upload']) {
        const response = await fetch(`${address}${p}`)
        expect(response.status, p).to.equal(418)
      }
    })
  })

  describe('UploadController', () => {
    const boundary = '125b0ae93a754d0ba988b98b397d587f'
    let png

    before(async () => {
      png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#c03' } }).png().toBuffer()
    })

    /** A form upload as a browser sends it: the type and id first, then the file. */
    function multipart ({ type, id, filename, content }) {
      const field = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      return Buffer.concat([
        Buffer.from(field('type', type) + field('id', id) +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`),
        Buffer.isBuffer(content) ? content : Buffer.from(content),
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ])
    }

    function post (fields, userId = '42') {
      const req = factories.mock.request()
      const res = factories.mock.response()
      req.headers['content-type'] = `multipart/form-data; boundary=${boundary}`
      const body = multipart(fields)
      // In one piece, so even 10 MB goes through in a moment
      req.pipe = out => Readable.from([body]).pipe(out)
      req.session.userId = userId
      return UploadController.create(req, res).then(() => res)
    }

    it('stores a picture sent straight from the browser', async () => {
      const res = await post({ type: 'userAvatar', id: '42', filename: 'me.png', content: png })
      expect(res.body.type).to.equal('userAvatar')
      expect(res.body.url).to.equal('https://agora.example.org/noo/uploads/evo-uploads/user/42/userAvatar/42/me.png')
      const stored = fs.readFileSync(path.join(dir, 'evo-uploads/user/42/userAvatar/42/me.png'))
      expect((await sharp(stored).metadata()).width).to.equal(200)
    })

    it('refuses something that is not a picture as a profile picture or banner', async () => {
      for (const type of ['userAvatar', 'userBanner']) {
        const res = await post({ type, id: '42', filename: 'page.png', content: '<html><script>alert(1)</script></html>' })
        expect(res.statusCode, type).to.equal(422)
        expect(res.body.error, type).to.equal('Validation error: This is not a picture')
      }
      expect(filesIn(dir)).to.deep.equal([])
    })

    it('still takes any kind of file as an attachment', async () => {
      const res = await post({ type: 'comment', id: 'new', filename: 'notes.txt', content: 'hello world' })
      expect(res.body.type).to.equal('comment')
      expect(filesIn(dir)).to.have.length(1)
    })

    it('refuses an id that would point into another folder', async () => {
      // comment and welcomePage uploads have no permission check in Hylo, so the id is the only guard
      for (const id of ['../../47/userAvatar/47', '..', 'a/b', '.hidden', 'x\\y', '47%2f..']) {
        const res = await post({ type: 'comment', id, filename: 'me.png', content: png })
        expect(res.statusCode, id).to.equal(422)
        expect(res.body.error, id).to.equal('Validation error: Invalid id')
      }
      expect(filesIn(dir)).to.deep.equal([])
    })

    it('refuses a file name that would be hidden, as a validation error', async () => {
      const res = await post({ type: 'comment', id: 'new', filename: '.htaccess', content: 'Options +Indexes' })
      expect(res.statusCode).to.equal(422)
      expect(res.body.error).to.include('invalid file path')
      expect(filesIn(dir)).to.deep.equal([])
    })

    it('refuses a file over 10 MB and keeps nothing of it', async () => {
      const res = await post({ type: 'comment', id: 'new', filename: 'big.bin', content: Buffer.alloc(10 * 1048576 + 10, 120) })
      expect(res.statusCode).to.equal(422)
      expect(res.body.error).to.include('larger than 10 MB')
      // the cut-off file is removed in the background
      for (let i = 0; i < 50 && filesIn(dir).length; i++) await new Promise(resolve => setTimeout(resolve, 20))
      expect(filesIn(dir)).to.deep.equal([])
    })
  })
})
