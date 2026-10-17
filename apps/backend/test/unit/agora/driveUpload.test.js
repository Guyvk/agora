/* eslint-env mocha */
/**
 * Agora: adding files and folders to a circle's Google Drive folder.
 *
 * Google is replaced by a small fake Drive, so no account is needed. The page
 * checks need a database, and empty it first. Never point them at a database
 * you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/driveUpload.test.js
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import Drive from '../../../lib/agora/drive'
import DriveLinks from '../../../lib/agora/driveLinks'
import AgoraFilesController from '../../../api/controllers/AgoraFilesController'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const FOLDER = 'application/vnd.google-apps.folder'
const SETTINGS = [
  'AGORA_DRIVE_FOLDER_ID', 'AGORA_GOOGLE_SERVICE_ACCOUNT_KEY', 'AGORA_DRIVE_UPLOADS', 'AGORA_DRIVE_MAX_UPLOAD_MB',
  'AGORA_GOOGLE_OAUTH_CLIENT_ID', 'AGORA_GOOGLE_OAUTH_CLIENT_SECRET', 'AGORA_GOOGLE_OAUTH_REFRESH_TOKEN', 'PROTOCOL', 'DOMAIN'
]

// The fake Drive. "Care" stands for a folder in someone's own "My Drive",
// where a robot account may not store anything.
function freshTree () {
  return {
    root0000000: { name: '7BP', mimeType: FOLDER, parents: [] },
    governance0: { name: 'Governance', mimeType: FOLDER, parents: ['root0000000'] },
    care0000000: { name: 'Care', mimeType: FOLDER, parents: ['root0000000'] },
    archive0000: { name: 'Archive', mimeType: FOLDER, parents: ['governance0'] },
    binned00000: { name: 'In the bin', mimeType: FOLDER, parents: ['governance0'], trashed: true },
    playbook000: { name: 'Playbook', mimeType: 'application/vnd.google-apps.document', parents: ['governance0'] },
    private0000: { name: 'Private', mimeType: FOLDER, parents: ['elsewhere00'] },
    elsewhere00: { name: 'Someone else', mimeType: FOLDER, parents: [] }
  }
}

function fakeGoogle (publicKey, seen) {
  let next = 1
  return async (url, options = {}) => {
    const reply = (status, body, headers = {}) => ({
      ok: status < 400,
      status,
      headers: { get: name => headers[name.toLowerCase()] || null },
      json: async () => body
    })
    const headers = options.headers || {}
    if (url === 'https://oauth2.googleapis.com/token') {
      const fields = new URLSearchParams(options.body)
      seen.grant = fields.get('grant_type')
      if (seen.grant === 'refresh_token') {
        seen.refresh = { clientId: fields.get('client_id'), token: fields.get('refresh_token') }
      } else {
        seen.claims = jwt.verify(fields.get('assertion'), publicKey, { algorithms: ['RS256'] })
      }
      return reply(200, { access_token: 'fake-token', expires_in: 3600 })
    }
    const { pathname, searchParams, origin } = new URL(url)

    // The second half of an upload: the contents, sent to the address Google gave.
    if (pathname.startsWith('/upload-session/')) {
      const pending = seen.sessions[pathname.split('/').pop()]
      const chunks = []
      for await (const chunk of options.body) chunks.push(Buffer.from(chunk))
      const contents = Buffer.concat(chunks)
      if (contents.length !== Number(headers['content-length'])) return reply(400, {})
      const id = `upload${String(next++).padStart(5, '0')}`
      seen.tree[id] = { ...pending, contents }
      seen.uploads.push({ id, ...pending, contents: contents.toString() })
      return reply(200, { id, ...pending, webViewLink: `https://drive.google.com/${id}`, lastModifyingUser: { displayName: 'Agora robot', me: true } })
    }

    if (headers.authorization !== 'Bearer fake-token') return reply(401, {})

    if (pathname === '/upload/drive/v3/files' && options.method === 'POST') {
      expect(searchParams.get('uploadType')).to.equal('resumable')
      const meta = JSON.parse(options.body)
      if (meta.parents.includes('care0000000')) {
        return reply(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } })
      }
      const session = String(next++)
      seen.sessions[session] = { name: meta.name, parents: meta.parents, appProperties: meta.appProperties, mimeType: headers['x-upload-content-type'] }
      seen.started = { origin: headers.origin || null, size: headers['x-upload-content-length'] }
      return reply(200, {}, { location: `${origin}/upload-session/${session}` })
    }

    if (pathname === '/drive/v3/files' && options.method === 'POST') {
      const meta = JSON.parse(options.body)
      const id = `folder${String(next++).padStart(5, '0')}`
      seen.tree[id] = meta
      return reply(200, { id, ...meta, webViewLink: `https://drive.google.com/${id}`, lastModifyingUser: { displayName: 'Agora robot', me: true } })
    }

    if (pathname === '/drive/v3/files') {
      const parent = searchParams.get('q').match(/^'([^']+)' in parents/)[1]
      const files = Object.entries(seen.tree)
        .filter(([, f]) => f.parents.includes(parent) && !f.trashed)
        .map(([id, f]) => ({ id, webViewLink: `https://drive.google.com/${id}`, ...f, contents: undefined }))
      return reply(200, { files })
    }
    const id = pathname.split('/').pop()
    if (!seen.tree[id]) return reply(404, {})
    return reply(200, { id, ...seen.tree[id], contents: undefined, webViewLink: `https://drive.google.com/${id}` })
  }
}

describe('Agora files: adding files', () => {
  const saved = {}
  let seen, publicKey, robotKey

  before(() => {
    for (const name of SETTINGS) saved[name] = process.env[name]
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    publicKey = pair.publicKey
    robotKey = Buffer.from(JSON.stringify({ client_email: 'robot@agora-7bp.iam.gserviceaccount.com', private_key: pair.privateKey })).toString('base64')
  })

  beforeEach(() => {
    for (const name of SETTINGS) delete process.env[name]
    process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY = robotKey
    process.env.AGORA_DRIVE_FOLDER_ID = 'root0000000'
    process.env.AGORA_DRIVE_UPLOADS = 'on'
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    seen = { tree: freshTree(), sessions: {}, uploads: [] }
    Drive.setFetch(fakeGoogle(publicKey, seen))
  })

  after(() => {
    Drive.setFetch(null)
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  describe('the Drive writer', () => {
    const file = (extra = {}) => ({ circleFolderId: 'governance0', name: 'Budget 2027.pdf', mimeType: 'application/pdf', size: 5, stream: [Buffer.from('hello')], addedBy: 'Amara', ...extra })

    it('stays read-only unless adding is switched on', async () => {
      delete process.env.AGORA_DRIVE_UPLOADS
      expect(Drive.uploadsEnabled()).to.equal(false)
      await Drive.circleFiles('governance0')
      expect(seen.claims.scope).to.equal(Drive.READ_SCOPE)
    })

    it('adds a file to the circle\'s folder, and lists it straight away', async () => {
      await Drive.circleFiles('governance0') // fills the cache first
      const item = await Drive.uploadFile(file())
      expect(seen.claims.scope).to.equal(Drive.WRITE_SCOPE)
      expect(seen.uploads).to.have.length(1)
      expect(seen.uploads[0]).to.include({ name: 'Budget 2027.pdf', mimeType: 'application/pdf', contents: 'hello' })
      expect(seen.uploads[0].parents).to.deep.equal(['governance0'])
      expect(item).to.include({ name: 'Budget 2027.pdf', kind: 'pdf', changedBy: 'Amara' })
      const after = await Drive.circleFiles('governance0')
      expect(after.items.map(i => i.name)).to.include('Budget 2027.pdf')
      expect(after.items.find(i => i.name === 'Budget 2027.pdf').changedBy).to.equal('Amara')
    })

    it('adds a file to a folder inside the circle\'s folder', async () => {
      await Drive.uploadFile(file({ folderId: 'archive0000' }))
      expect(seen.uploads[0].parents).to.deep.equal(['archive0000'])
    })

    it('never adds to another circle\'s folder or outside the main folder', async () => {
      for (const folderId of ['care0000000', 'private0000', 'root0000000', 'playbook000', 'binned00000', 'doesnotexist00', "x' or 1=1"]) {
        await expectCode(Drive.uploadFile(file({ folderId })), 'not_found', /^This folder is not part of this circle\.$/)
      }
      expect(seen.uploads).to.have.length(0)
    })

    it('refuses files that are too large, empty or nameless', async () => {
      process.env.AGORA_DRIVE_MAX_UPLOAD_MB = '1'
      await expectCode(Drive.uploadFile(file({ size: 1024 * 1024 + 1 })), 'too_large')
      await expectCode(Drive.uploadFile(file({ size: 0 })), 'bad_request')
      for (const size of [1.5, -5, NaN, '5', Number.MAX_SAFE_INTEGER + 2]) {
        await expectCode(Drive.startUpload(file({ size })), 'bad_request')
      }
      expect(seen.sessions).to.deep.equal({})
      await expectCode(Drive.uploadFile(file({ name: '\u0000 ' })), 'bad_request')
    })

    it('cleans up names and odd file types', async () => {
      expect(Drive.cleanName('  Notes\n\tmeeting  ')).to.equal('Notes meeting')
      expect(Drive.cleanName('..')).to.equal(null)
      expect(Drive.cleanName('a'.repeat(300))).to.have.length(200)
      await Drive.uploadFile(file({ mimeType: 'text/html"; x' }))
      expect(seen.uploads[0].mimeType).to.equal('application/octet-stream')
    })

    it('says plainly when a robot account may not store files in a My Drive folder', async () => {
      await expectCode(Drive.uploadFile(file({ circleFolderId: 'care0000000' })), 'no_storage', /shared drive/)
    })

    it('says so when the circle has no folder yet', async () => {
      await expectCode(Drive.uploadFile(file({ circleFolderId: null })), 'no_folder')
    })

    it('makes a folder, and lists it straight away', async () => {
      await Drive.circleFiles('governance0')
      const item = await Drive.createFolder({ circleFolderId: 'governance0', name: 'Reports', addedBy: 'Amara' })
      expect(item).to.include({ name: 'Reports', kind: 'folder' })
      const after = await Drive.circleFiles('governance0')
      expect(after.items.filter(i => i.kind === 'folder').map(i => i.name)).to.include('Reports')
      // and something can be added inside the new folder
      await Drive.uploadFile(file({ folderId: item.id }))
      expect(seen.uploads[0].parents).to.deep.equal([item.id])
    })

    it('starts an upload for the browser to send to Google directly, fixed to one file and folder', async () => {
      const session = await Drive.startUpload({ circleFolderId: 'governance0', folderId: 'archive0000', name: 'Offsite.mov', mimeType: 'video/quicktime', size: 3 * 1024 * 1024 * 1024, addedBy: 'Amara', origin: 'https://agora.example.org' })
      expect(session.uploadUrl).to.match(/^https:\/\/www\.googleapis\.com\/upload-session\//)
      expect(session.folderId).to.equal('archive0000')
      expect(seen.started).to.deep.equal({ origin: 'https://agora.example.org', size: String(3 * 1024 * 1024 * 1024) })
      const pending = Object.values(seen.sessions)[0]
      expect(pending).to.include({ name: 'Offsite.mov', mimeType: 'video/quicktime' })
      expect(pending.parents).to.deep.equal(['archive0000'])
    })

    it('allows files of up to 5 GB unless set otherwise', async () => {
      expect(Drive.maxUploadBytes()).to.equal(5120 * 1024 * 1024)
      await expectCode(Drive.startUpload({ circleFolderId: 'governance0', name: 'Huge.mov', size: 6 * 1024 * 1024 * 1024 }), 'too_large')
    })

    it('opens a member\'s own folder, and makes it only once', async () => {
      const first = await Drive.personalFolder({ circleFolderId: 'governance0', memberName: 'Amara Diallo' })
      const again = await Drive.personalFolder({ circleFolderId: 'governance0', memberName: 'amara  diallo' })
      expect(first).to.include({ name: 'Amara Diallo', kind: 'folder' })
      expect(again.id).to.equal(first.id)
      expect(Object.values(seen.tree).filter(f => f.name === 'Amara Diallo')).to.have.length(1)
    })

    it('logs in as a 7BP Google account when its settings are there', async () => {
      process.env.AGORA_GOOGLE_OAUTH_CLIENT_ID = 'client-id'
      process.env.AGORA_GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret'
      process.env.AGORA_GOOGLE_OAUTH_REFRESH_TOKEN = 'refresh-token'
      delete process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY
      expect(Drive.isConfigured()).to.equal(true)
      expect(Drive.robotEmail()).to.equal(null)
      await Drive.uploadFile(file())
      expect(seen.grant).to.equal('refresh_token')
      expect(seen.refresh).to.deep.equal({ clientId: 'client-id', token: 'refresh-token' })
      expect(seen.uploads).to.have.length(1)
    })
  })

  describe('the upload calls', () => {
    let member, outsider, impostor, group, fakeGroup

    before(() => setup.clearDb()
      .then(() => Promise.props({
        m: new User({ name: 'Amara', email: 'member@agora.test', active: true }).save(),
        o: new User({ name: 'Lars', email: 'outsider@agora.test', active: true }).save(),
        i: new User({ name: 'Mallory', email: 'impostor@agora.test', active: true }).save(),
        g: new Group({ slug: 'governance', name: 'Governance' }).save(),
        f: new Group({ slug: 'governance-2', name: 'Governance' }).save()
      }))
      .then(async props => {
        ({ m: member, o: outsider, i: impostor, g: group, f: fakeGroup } = props)
        await member.joinGroup(group)
        await impostor.joinGroup(fakeGroup)
        await DriveLinks.link(group.id, 'governance0', 'test')
      }))

    function call (action, { params = {}, query = {}, headers = {}, body = {}, userId } = {}) {
      const req = factories.mock.request()
      req.params = { groupSlug: 'governance', ...params }
      req.query = query
      req.headers = { 'x-agora': '1', ...headers }
      req.body = body
      // Like Sails: param() looks in the address, the query and the body.
      req.param = name => [req.params, req.query, Buffer.isBuffer(req.body) ? {} : req.body]
        .map(source => source && source[name]).find(v => v !== undefined)
      req.destroy = () => { req.destroyed = true }
      req.originalUrl = '/noo/agora/files/governance'
      if (userId) req.login(userId)
      const res = factories.mock.response()
      res.headers = {}
      res.set = (name, value) => { res.headers[name] = value }
      res.once = (event, fn) => { if (event === 'finish') res.finish = fn }
      res.req = req
      return AgoraFilesController[action](req, res).then(() => res)
    }

    const upload = (userId, extra = {}) => call('upload', {
      userId,
      query: { name: 'Plan.txt', type: 'text/plain' },
      headers: { 'content-type': 'application/octet-stream', 'content-length': '5' },
      body: Buffer.from('hello'),
      ...extra
    })

    it('tells the page that members may add files, and others may not', async () => {
      const asMember = await call('list', { userId: member.id })
      expect(asMember.body).to.include({ canAdd: true, maxUploadMb: 5120, relayMb: 25 })
      const asOutsider = await call('list', { userId: outsider.id })
      expect(asOutsider.statusCode).to.equal(403)
      expect(asOutsider.body.canAdd).to.equal(undefined)
      delete process.env.AGORA_DRIVE_UPLOADS
      const switchedOff = await call('list', { userId: member.id })
      expect(switchedOff.body.canAdd).to.equal(false)
    })

    it('adds a member\'s file, with their name', async () => {
      const res = await upload(member.id)
      expect(res.statusCode).to.equal(undefined)
      expect(res.body.item).to.include({ name: 'Plan.txt', changedBy: 'Amara' })
      expect(seen.uploads[0]).to.include({ contents: 'hello', mimeType: 'text/plain' })
      expect(seen.uploads[0].appProperties).to.deep.equal({ agoraAddedBy: 'Amara' })
    })

    it('refuses someone who is not a member of the circle', async () => {
      const res = await upload(outsider.id)
      expect(res.statusCode).to.equal(403)
      expect(seen.uploads).to.have.length(0)
    })

    it('refuses when adding is switched off', async () => {
      delete process.env.AGORA_DRIVE_UPLOADS
      const res = await upload(member.id)
      expect(res.statusCode).to.equal(403)
    })

    it('refuses calls that do not come from the Agora page', async () => {
      const res = await upload(member.id, { headers: { 'x-agora': '', 'content-type': 'application/octet-stream', 'content-length': '5' } })
      expect(res.statusCode).to.equal(400)
    })

    it('refuses files over the limit before sending anything to Google', async () => {
      process.env.AGORA_DRIVE_MAX_UPLOAD_MB = '1'
      const res = await upload(member.id, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(2 * 1024 * 1024) } })
      expect(res.statusCode).to.equal(413)
      expect(Object.keys(seen.sessions)).to.have.length(0)
    })

    it('refuses an upload without a size, or sent as a form', async () => {
      expect((await upload(member.id, { headers: { 'content-type': 'application/octet-stream' } })).statusCode).to.equal(411)
      expect((await upload(member.id, { headers: { 'content-type': 'multipart/form-data', 'content-length': '5' } })).statusCode).to.equal(415)
    })

    it('stops a file that is larger than it said', async () => {
      const res = await upload(member.id, { headers: { 'content-type': 'application/octet-stream', 'content-length': '3' } })
      expect(res.statusCode).to.equal(502)
      expect(seen.uploads).to.have.length(0)
    })

    it('answers 404 for a folder that is not the circle\'s', async () => {
      const res = await upload(member.id, { query: { name: 'Plan.txt', folder: 'private0000' } })
      expect(res.statusCode).to.equal(404)
    })

    it('starts a direct upload for a member, with the Agora website as origin', async () => {
      const res = await call('startUpload', { userId: member.id, body: { name: 'Offsite.mp4', type: 'video/mp4', size: String(900 * 1024 * 1024), folder: '' } })
      expect(res.body.uploadUrl).to.match(/^https:\/\/www\.googleapis\.com\//)
      expect(res.body.folderId).to.equal('governance0')
      expect(seen.started.origin).to.equal('https://agora.example.org')
      expect(Object.values(seen.sessions)[0].appProperties).to.deep.equal({ agoraAddedBy: 'Amara' })
    })

    it('starts no upload for someone who is not a member', async () => {
      const res = await call('startUpload', { userId: outsider.id, body: { name: 'x.mp4', size: '10' } })
      expect(res.statusCode).to.equal(403)
      expect(Object.keys(seen.sessions)).to.have.length(0)
    })

    it('sends files over 25 MB only directly, never through the server', async () => {
      const res = await upload(member.id, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(26 * 1024 * 1024) } })
      expect(res.statusCode).to.equal(413)
      expect(Object.keys(seen.sessions)).to.have.length(0)
      // The rest of the file is not read: the connection closes once the answer is out.
      expect(res.headers.Connection).to.equal('close')
      res.finish()
      expect(res.req.destroyed).to.equal(true)
    })

    it('refuses a direct upload with a size that is not a whole number of bytes', async () => {
      for (const size of ['1.5', 'abc', '-5', '', '1e9', undefined, '99999999999999999']) {
        const res = await call('startUpload', { userId: member.id, body: { name: 'x.mp4', size } })
        expect(res.statusCode).to.equal(400)
      }
      expect(Object.keys(seen.sessions)).to.have.length(0)
    })

    it('refuses a direct upload over the limit', async () => {
      const res = await call('startUpload', { userId: member.id, body: { name: 'Huge.mov', size: String(6 * 1024 * 1024 * 1024) } })
      expect(res.statusCode).to.equal(413)
      expect(Object.keys(seen.sessions)).to.have.length(0)
    })

    it('never lets a second circle with the same name add to the first one\'s folder', async () => {
      for (const folder of ['', 'governance0', 'archive0000']) {
        const res = await call('startUpload', { userId: impostor.id, params: { groupSlug: 'governance-2' }, body: { name: 'x.mp4', size: '10', folder } })
        expect(res.statusCode).to.equal(409)
        expect(res.body.error).to.match(/No Drive folder is linked/)
      }
      const made = await call('createFolder', { userId: impostor.id, params: { groupSlug: 'governance-2' }, body: { name: 'Mine' } })
      expect(made.statusCode).to.equal(409)
      expect(Object.keys(seen.sessions)).to.have.length(0)
    })

    it('does not add to a folder in the bin', async () => {
      const res = await call('startUpload', { userId: member.id, body: { name: 'x.mp4', size: '10', folder: 'binned00000' } })
      expect(res.statusCode).to.equal(404)
    })

    it('opens the member\'s own folder', async () => {
      const res = await call('myFolder', { userId: member.id, body: { folder: '' } })
      expect(res.body.item).to.include({ name: 'Amara', kind: 'folder' })
      const refused = await call('myFolder', { userId: outsider.id, body: {} })
      expect(refused.statusCode).to.equal(403)
    })

    it('lists the folder afresh after a direct upload, only for the circle\'s folders', async () => {
      expect((await call('uploaded', { userId: member.id, body: { folder: '' } })).body).to.deep.equal({})
      expect((await call('uploaded', { userId: member.id, body: { folder: 'private0000' } })).statusCode).to.equal(404)
    })

    it('makes a folder for a member, and not for others', async () => {
      const made = await call('createFolder', { userId: member.id, body: { name: 'Reports', folder: '' } })
      expect(made.body.item).to.include({ name: 'Reports', kind: 'folder' })
      const refused = await call('createFolder', { userId: outsider.id, body: { name: 'Mine' } })
      expect(refused.statusCode).to.equal(403)
    })
  })
})

async function expectCode (promise, code, message) {
  try {
    await promise
  } catch (err) {
    expect(err.code).to.equal(code)
    if (message) expect(err.message).to.match(message)
    return
  }
  throw new Error(`expected a ${code} error`)
}
