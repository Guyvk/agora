/* eslint-env mocha */
/**
 * Agora: circle files in Infomaniak kDrive.
 *
 * kDrive is replaced by a pretend kDrive (nock), so no token is needed and
 * nothing leaves this computer. The checks of the Files calls need a database,
 * and empty it first. Never point them at a database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/kdrive.test.js
 */
import crypto from 'crypto'
import nock from 'nock'
import { PassThrough } from 'stream'
import Kdrive from '../../../lib/agora/kdrive'
import Circles from '../../../lib/agora/kdriveCircles'
import KdriveMinutes from '../../../lib/agora/kdriveMinutes'
import AgoraKdriveController from '../../../api/controllers/AgoraKdriveController'
import AgoraFilesController from '../../../api/controllers/AgoraFilesController'
import MeetingMinutes from '../../../api/services/MeetingMinutes'
import createPost from '../../../api/models/post/createPost'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const { mockify, unspyify } = require(rootPath('test/setup/helpers'))
const routes = require(rootPath('config/routes')).routes
const policies = require(rootPath('config/policies')).policies

const API = 'https://api.infomaniak.com'
const UPLOAD_HOST = 'https://upload.kdrive.infomaniak.com'
const DOWNLOAD_HOST = 'https://download.kdrive.infomaniak.com'
const TOKEN = 'pretend-kdrive-token-0123456789'
const DRIVE = '7'
const SETTINGS = ['ANTHROPIC_API_KEY', 'AGORA_KDRIVE_TOKEN', 'AGORA_KDRIVE_DRIVE_ID', 'AGORA_KDRIVE_ROOT_FOLDER_ID', 'AGORA_KDRIVE_MAX_UPLOAD_MB', 'PROTOCOL', 'DOMAIN']

/**
 * The pretend kDrive: a tree of files and folders by number, and a record of
 * what was asked. It answers the calls of lib/agora/kdrive.js the way
 * Infomaniak's pages describe them.
 */
function freshTree () {
  return {
    1: { name: 'Root', type: 'dir', parent: 0 },
    2: { name: 'Common documents', type: 'dir', parent: 1, visibility: 'is_team_space' },
    3: { name: 'Private', type: 'dir', parent: 1, visibility: 'is_private_space' },
    100: { name: 'Agora (set)', type: 'dir', parent: 2 },
    900: { name: 'Elsewhere', type: 'dir', parent: 2 },
    901: { name: 'secret.txt', type: 'file', parent: 900, contents: 'not for Agora' }
  }
}

function fakeKdrive (state) {
  const ok = data => [200, { result: 'success', data }]
  const notFound = [404, { result: 'error', error: { code: 'object_not_found', description: 'Not found' } }]
  const view = id => {
    const f = state.tree[id]
    return {
      id: Number(id),
      name: f.name,
      type: f.type,
      status: f.status || 'ok',
      visibility: f.visibility || '',
      parent_id: f.parent,
      size: f.type === 'file' ? Buffer.byteLength(f.contents || '') : undefined,
      mime_type: f.type === 'file' ? 'text/plain' : undefined,
      last_modified_at: 1792427293,
      added_at: 1792427293
    }
  }
  const children = id => Object.keys(state.tree).filter(k => String(state.tree[k].parent) === String(id))
  const add = (parent, name, type, contents) => {
    const id = state.next++
    state.tree[id] = { name, type, parent: Number(parent), contents }
    return id
  }
  const freeName = (parent, name) => {
    let candidate = name
    for (let i = 1; children(parent).some(k => state.tree[k].name === candidate); i++) candidate = name.replace(/(\.\w+)?$/, ` (${i})$1`)
    return candidate
  }
  function log (req, method, uri, body) {
    state.calls.push({ method, uri, auth: req.headers.authorization, body })
  }
  const prefix = `/3/drive/${DRIVE}`
  const prefix2 = `/2/drive/${DRIVE}`

  nock(API).persist()
    .get(/.*/).reply(function (uri) {
      log(this.req, 'GET', uri)
      if (state.busy > 0) { state.busy--; return [429, { result: 'error', error: { code: 'too_many_request' } }, { 'Retry-After': '2' }] }
      const url = new URL(API + uri)
      let m
      if ((m = url.pathname.match(new RegExp(`^${prefix}/files/(\\d+)$`)))) return state.tree[m[1]] ? ok(view(m[1])) : notFound
      if ((m = url.pathname.match(new RegExp(`^${prefix}/files/(\\d+)/files$`)))) {
        if (!state.tree[m[1]]) return notFound
        const all = children(m[1])
        const start = Number(url.searchParams.get('cursor') || 0)
        const size = state.pageSize || 1000
        const page = all.slice(start, start + size)
        const more = start + size < all.length
        return [200, { result: 'success', data: page.map(view), has_more: more, cursor: more ? String(start + size) : null }]
      }
      if ((m = url.pathname.match(new RegExp(`^${prefix}/files/(\\d+)/name$`)))) {
        const hit = children(m[1]).find(k => state.tree[k].name === url.searchParams.get('name'))
        return hit ? ok(view(hit)) : notFound
      }
      if ((m = url.pathname.match(new RegExp(`^${prefix2}/files/(\\d+)/download$`)))) {
        if (!state.tree[m[1]]) return notFound
        return [302, '', { Location: `${DOWNLOAD_HOST}/file/${m[1]}` }]
      }
      return notFound
    })
    .post(/.*/).reply(function (uri, body) {
      log(this.req, 'POST', uri, body)
      const url = new URL(API + uri)
      let m
      if ((m = url.pathname.match(new RegExp(`^${prefix}/files/(\\d+)/directory$`)))) {
        if (!state.tree[m[1]]) return notFound
        if (children(m[1]).some(k => state.tree[k].name === body.name)) return [400, { result: 'error', error: { code: 'destination_already_exists' } }]
        return ok(view(add(m[1], body.name, 'dir')))
      }
      if (url.pathname === `${prefix}/upload`) {
        const parent = url.searchParams.get('directory_id')
        if (!state.tree[parent]) return notFound
        if (Buffer.byteLength(body) !== Number(url.searchParams.get('total_size'))) return [400, { result: 'error', error: { code: 'invalid_size' } }]
        state.direct.push({ conflict: url.searchParams.get('conflict'), name: url.searchParams.get('file_name') })
        return ok(view(add(parent, freeName(parent, url.searchParams.get('file_name')), 'file', body)))
      }
      if (url.pathname === `${prefix}/upload/session/start`) {
        const token = `session${state.next++}`
        state.sessions[token] = { ...body, chunks: [] }
        return ok({ token, upload_url: UPLOAD_HOST, result: true, file_name: body.file_name, directory_id: body.directory_id })
      }
      if ((m = url.pathname.match(new RegExp(`^${prefix}/upload/session/([\\w-]+)/finish$`)))) {
        const session = state.sessions[m[1]]
        const contents = session.chunks.sort((a, b) => a.number - b.number).map(c => c.data).join('')
        if (Buffer.byteLength(contents) !== session.total_size) return [400, { result: 'error', error: { code: 'invalid_size' } }]
        const id = add(session.directory_id, freeName(session.directory_id, session.file_name), 'file', contents)
        session.finished = true
        return ok({ token: m[1], result: true, file: view(id) })
      }
      if ((m = url.pathname.match(new RegExp(`^${prefix2}/files/(\\d+)/rename$`)))) {
        if (!state.tree[m[1]]) return notFound
        state.tree[m[1]].name = body.name
        return ok({ cancel_id: 'x', valid_until: 0 })
      }
      return notFound
    })
    .delete(/.*/).reply(function (uri) {
      log(this.req, 'DELETE', uri)
      const url = new URL(API + uri)
      let m
      if ((m = url.pathname.match(new RegExp(`^${prefix2}/files/(\\d+)$`)))) {
        if (!state.tree[m[1]]) return notFound
        state.tree[m[1]].status = 'trashed'
        return ok({ cancel_id: 'x', valid_until: 0 })
      }
      if ((m = url.pathname.match(new RegExp(`^${prefix}/upload/session/([\\w-]+)$`)))) {
        state.sessions[m[1]].cancelled = true
        return ok(true)
      }
      return notFound
    })

  nock(UPLOAD_HOST).persist()
    .post(/.*/).reply(function (uri, body) {
      log(this.req, 'POST', UPLOAD_HOST + uri, body)
      const url = new URL(UPLOAD_HOST + uri)
      const m = url.pathname.match(new RegExp(`^${prefix}/upload/session/([\\w-]+)/chunk$`))
      if (!m || !state.sessions[m[1]]) return notFound
      if (state.failChunk === Number(url.searchParams.get('chunk_number'))) return [500, { result: 'error', error: { code: 'chunk_failed' } }]
      const hash = crypto.createHash('sha256').update(Buffer.from(body)).digest('hex')
      if (url.searchParams.get('chunk_hash') !== `sha256:${hash}`) return [400, { result: 'error', error: { code: 'bad_hash' } }]
      if (Number(url.searchParams.get('chunk_size')) !== Buffer.byteLength(body)) return [400, { result: 'error', error: { code: 'bad_size' } }]
      state.sessions[m[1]].chunks.push({ number: Number(url.searchParams.get('chunk_number')), data: body })
      return ok({ number: Number(url.searchParams.get('chunk_number')), status: 'ok' })
    })

  nock(DOWNLOAD_HOST).persist()
    .get(/.*/).reply(function (uri) {
      log(this.req, 'GET', DOWNLOAD_HOST + uri)
      const id = uri.split('/').pop()
      return [200, state.tree[id].contents, { 'Content-Type': 'text/html', 'Content-Length': String(Buffer.byteLength(state.tree[id].contents)) }]
    })
}

async function expectCode (promise, code) {
  try {
    await promise
  } catch (err) {
    expect(err.code).to.equal(code)
    return err
  }
  throw new Error(`expected a ${code} error`)
}

describe('Agora files in kDrive', () => {
  const saved = {}
  let state, waits

  before(() => {
    for (const name of SETTINGS) saved[name] = process.env[name]
    nock.disableNetConnect()
  })

  beforeEach(() => {
    for (const name of SETTINGS) delete process.env[name]
    process.env.AGORA_KDRIVE_TOKEN = TOKEN
    process.env.AGORA_KDRIVE_DRIVE_ID = DRIVE
    process.env.AGORA_KDRIVE_ROOT_FOLDER_ID = '100'
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    state = { tree: freshTree(), next: 1000, calls: [], sessions: {}, direct: [], busy: 0 }
    waits = []
    Kdrive.setPacing({ perMinute: 100000, sleep: async ms => { waits.push(ms) } })
    Circles.forget()
    fakeKdrive(state)
  })

  after(() => {
    nock.cleanAll()
    nock.enableNetConnect()
    Kdrive.setPacing()
    Circles.forget()
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  describe('the kDrive module', () => {
    it('is used only when the token, the drive number and the top folder are set', () => {
      expect(Kdrive.isConfigured()).to.equal(true)
      process.env.AGORA_KDRIVE_DRIVE_ID = 'my drive'
      expect(Kdrive.isConfigured()).to.equal(false)
      process.env.AGORA_KDRIVE_DRIVE_ID = DRIVE
      expect(Kdrive.missingTopFolder()).to.equal(false)
      delete process.env.AGORA_KDRIVE_ROOT_FOLDER_ID
      expect(Kdrive.isConfigured()).to.equal(false)
      expect(Kdrive.missingTopFolder()).to.equal(true)
      process.env.AGORA_KDRIVE_ROOT_FOLDER_ID = 'Agora'
      expect(Kdrive.isConfigured()).to.equal(false)
      process.env.AGORA_KDRIVE_ROOT_FOLDER_ID = '100'
      delete process.env.AGORA_KDRIVE_TOKEN
      expect(Kdrive.isConfigured()).to.equal(false)
    })

    it('follows a download only to Infomaniak\'s own https addresses', async () => {
      nock.cleanAll()
      nock(API).get(/.*/).reply(302, '', { Location: 'https://example.org/steal' })
      const err = await expectCode(Kdrive.openDownload(901), 'kdrive')
      expect(err.message).to.equal('Something went wrong with kDrive. Try again in a minute.')
      nock.cleanAll()
      nock(API).get(/.*/).reply(302, '', { Location: 'http://download.kdrive.infomaniak.com/file/901' })
      await expectCode(Kdrive.openDownload(901), 'kdrive')
    })

    it('allows 100 MB a file unless set otherwise', () => {
      expect(Kdrive.maxUploadBytes()).to.equal(100 * 1024 * 1024)
      process.env.AGORA_KDRIVE_MAX_UPLOAD_MB = '250'
      expect(Kdrive.maxUploadBytes()).to.equal(250 * 1024 * 1024)
    })

    it('sends the token to Infomaniak only, and reads every page of a folder', async () => {
      state.pageSize = 2
      for (let i = 0; i < 5; i++) state.tree[200 + i] = { name: `f${i}.txt`, type: 'file', parent: 100, contents: 'x' }
      const items = await Kdrive.listFolder(100)
      expect(items.map(i => i.name)).to.deep.equal(['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt'])
      expect(state.calls).to.have.length(3)
      for (const call of state.calls) expect(call.auth).to.equal(`Bearer ${TOKEN}`)
    })

    it('waits and tries again when kDrive says it is busy (429)', async () => {
      state.busy = 2
      const info = await Kdrive.fileInfo(100)
      expect(info.name).to.equal('Agora (set)')
      expect(waits).to.deep.equal([2000, 2000])
    })

    it('makes at most the allowed number of calls a minute', async () => {
      Kdrive.setPacing({ perMinute: 2, sleep: async ms => { waits.push(ms); Kdrive.setPacing({ perMinute: 2, sleep: async () => {} }) } })
      await Kdrive.fileInfo(100)
      await Kdrive.fileInfo(100)
      expect(waits).to.have.length(0)
      await Kdrive.fileInfo(100)
      expect(waits).to.have.length(1)
      expect(waits[0]).to.be.within(59000, 60005)
    })

    it('never puts the token in an error', async () => {
      nock.cleanAll()
      nock(API).get(/.*/).reply(401, { result: 'error', error: { code: 'not_authorized', description: `bad token ${TOKEN}` } })
      const err = await expectCode(Kdrive.fileInfo(100), 'login')
      expect(err.message).to.not.include(TOKEN)
      expect(err.message).to.match(/README-AGORA/)
    })

    it('adds a small file in one call, renaming rather than overwriting', async () => {
      const file = await Kdrive.upload({ folderId: 100, name: 'Plan.txt', size: 5, stream: Buffer.from('hello') })
      expect(state.tree[file.id]).to.include({ name: 'Plan.txt', contents: 'hello', parent: 100 })
      expect(state.direct[0]).to.deep.equal({ conflict: 'rename', name: 'Plan.txt' })
      const again = await Kdrive.upload({ folderId: 100, name: 'Plan.txt', size: 5, stream: Buffer.from('again') })
      expect(state.tree[again.id].name).to.equal('Plan (1).txt')
    })

    it('adds a big file in pieces, to the upload address kDrive gives, and finishes it', async () => {
      const contents = 'abcdefghij'
      const file = await Kdrive.uploadInPieces({ folderId: 100, name: 'Video.mp4', size: 10, stream: [Buffer.from('abcdef'), Buffer.from('ghij')], chunkSize: 4 })
      expect(state.tree[file.id]).to.include({ name: 'Video.mp4', contents })
      const session = Object.values(state.sessions)[0]
      expect(session).to.include({ total_size: 10, total_chunks: 3, conflict: 'rename', directory_id: 100 })
      expect(session.chunks.map(c => c.data)).to.deep.equal(['abcd', 'efgh', 'ij'])
      const chunkCalls = state.calls.filter(c => c.uri.startsWith(UPLOAD_HOST))
      expect(chunkCalls).to.have.length(3)
      expect(chunkCalls[0].uri).to.match(/\/3\/drive\/7\/upload\/session\/session\d+\/chunk\?chunk_number=1&chunk_size=4&chunk_hash=sha256%3A[0-9a-f]{64}$/)
      expect(chunkCalls[0].auth).to.equal(`Bearer ${TOKEN}`)
    })

    it('cancels an upload in pieces that fails halfway', async () => {
      state.failChunk = 2
      await expectCode(Kdrive.uploadInPieces({ folderId: 100, name: 'Video.mp4', size: 10, stream: [Buffer.from('abcdefghij')], chunkSize: 4 }), 'kdrive')
      expect(Object.values(state.sessions)[0].cancelled).to.equal(true)
    })

    it('stops an upload in pieces that is larger than it said', async () => {
      await expectCode(Kdrive.uploadInPieces({ folderId: 100, name: 'Video.mp4', size: 8, stream: [Buffer.from('abcdefghij')], chunkSize: 4 }), 'bad_request')
      expect(Object.values(state.sessions)[0].cancelled).to.equal(true)
    })

    it('chooses pieces only above 64 MB', () => {
      expect(Kdrive.DIRECT_LIMIT).to.equal(64 * 1024 * 1024)
      expect(Kdrive.CHUNK_SIZE).to.be.at.least(1000000)
    })

    it('follows kDrive to the download, inside Agora', async () => {
      const res = await Kdrive.openDownload(901)
      const parts = []
      for await (const part of res) parts.push(part)
      expect(Buffer.concat(parts).toString()).to.equal('not for Agora')
    })

    it('refuses numbers that are not kDrive numbers', async () => {
      for (const id of ['abc', '-1', '1.5', '0', '', null, '1/../2']) {
        await expectCode(Kdrive.fileInfo(id), 'not_found')
      }
      expect(state.calls).to.have.length(0)
    })
  })

  describe('circles, members and the Files calls', () => {
    let member, other, steward, outsider, group, space, spaceMember

    before(async () => {
      await setup.clearDb()
      member = await new User({ name: 'Amara', email: 'kd-member@agora.test', active: true }).save()
      other = await new User({ name: 'Mei', email: 'kd-other@agora.test', active: true }).save()
      steward = await new User({ name: 'Lars', email: 'kd-steward@agora.test', active: true }).save()
      outsider = await new User({ name: 'Otto', email: 'kd-outsider@agora.test', active: true }).save()
      spaceMember = await new User({ name: 'Sol', email: 'kd-space@agora.test', active: true }).save()
      group = await new Group({ slug: 'governance', name: 'Governance / Core' }).save()
      space = await new Group({ slug: 'governance-budget', name: 'Budget', type: 'space', parent_id: group.id }).save()
      for (const user of [member, other, steward, spaceMember]) await user.joinGroup(group)
      await spaceMember.joinGroup(space)
      const responsibility = await Responsibility.where({ title: 'Manage Content', type: 'system' }).fetch()
      const role = await new GroupRole({ group_id: group.id, name: 'Moderator', active: true }).save()
      await bookshelf.knex('group_roles_responsibilities').insert({ group_role_id: role.id, responsibility_id: responsibility.id })
      await new MemberGroupRole({ group_id: group.id, user_id: steward.id, group_role_id: role.id, active: true }).save()
    })

    beforeEach(async () => {
      await bookshelf.knex('agora_kdrive_items').del()
      await bookshelf.knex('agora_kdrive_folders').del()
    })

    function request (action, { params = {}, query = {}, headers = {}, body = {}, userId } = {}) {
      const req = factories.mock.request()
      req.params = { groupSlug: 'governance', ...params }
      req.query = query
      req.headers = { 'x-agora': '1', ...headers }
      req.body = body
      req.param = name => [req.params, req.query, Buffer.isBuffer(req.body) ? {} : req.body]
        .map(source => source && source[name]).find(v => v !== undefined)
      req.destroy = () => { req.destroyed = true }
      req.originalUrl = '/noo/agora/files/governance'
      if (userId) req.login(userId)
      return req
    }

    function call (action, options = {}) {
      const req = request(action, options)
      const res = factories.mock.response()
      res.headers = {}
      res.set = (name, value) => { res.headers[name] = value }
      res.once = () => {}
      return AgoraKdriveController[action](req, res).then(() => res)
    }

    /** A download: the answer is a stream, collected here. */
    function download (options) {
      const req = request('download', options)
      const res = new PassThrough()
      res.headers = {}
      res.set = (name, value) => { res.headers[name] = value }
      res.status = code => { res.statusCode = code; return res }
      res.send = body => { res.body = body; res.end() }
      const parts = []
      res.on('data', part => parts.push(part))
      return new Promise((resolve, reject) => {
        res.on('end', () => resolve({ res, text: Buffer.concat(parts).toString() }))
        AgoraKdriveController.download(req, res).catch(reject)
      })
    }

    const upload = (userId, { name = 'Plan.txt', contents = 'hello', folder, headers = {} } = {}) => call('upload', {
      userId,
      query: { name, ...(folder ? { folder } : {}) },
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(Buffer.byteLength(contents)), ...headers },
      body: Buffer.from(contents)
    })

    it('has its addresses, all behind a login', () => {
      for (const action of ['list', 'download', 'upload', 'createFolder', 'rename', 'remove']) {
        expect(Object.values(routes)).to.include(`AgoraKdriveController.${action}`)
      }
      expect(policies.AgoraKdriveController['*']).to.equal('sessionAuth')
    })

    it('serves the kDrive page in the member\'s language when kDrive is set up', async () => {
      await member.addSetting({ locale: 'de' }, true)
      const req = request('page', { userId: member.id })
      const res = factories.mock.response()
      res.set = () => {}
      await AgoraFilesController.page(req, res)
      expect(res.body).to.include('TEXTS')
      expect(res.body).to.include('"api":"/noo/agora/files/governance/kd"')
      expect(res.body).to.include('"locale":"de"')
      delete process.env.AGORA_KDRIVE_TOKEN
      const old = factories.mock.response()
      old.set = () => {}
      await AgoraFilesController.page(request('page', { userId: member.id }), old)
      expect(old.body).to.include('"api":"/noo/agora/files/governance"')
      expect(old.body).to.not.include('TEXTS')
    })

    it('makes the circle\'s folder the first time, with its name and address, and remembers it', async () => {
      const res = await call('list', { userId: member.id })
      expect(res.statusCode).to.equal(undefined)
      expect(res.body.folder).to.include({ isCircleFolder: true, name: 'Governance / Core' })
      const made = Object.entries(state.tree).find(([, f]) => f.name === 'Governance - Core (governance)')
      expect(made[1].parent).to.equal(100)
      const row = await bookshelf.knex('agora_kdrive_folders').where({ group_id: group.id }).first()
      expect(String(row.folder_id)).to.equal(made[0])
      await call('list', { userId: member.id })
      expect(Object.values(state.tree).filter(f => f.name === 'Governance - Core (governance)')).to.have.length(1)
    })

    it('is not used without a top folder, and never makes one itself', async () => {
      delete process.env.AGORA_KDRIVE_ROOT_FOLDER_ID
      const res = await call('list', { userId: member.id })
      expect(res.statusCode).to.equal(409)
      expect(state.calls).to.have.length(0)
      expect(Object.values(state.tree).filter(f => f.name === 'Agora')).to.have.length(0)
    })

    it('takes invisible and direction-changing characters out of names, but keeps those Hindi and emoji need', () => {
      expect(Circles.cleanName('Plan\u202eexe.pdf')).to.equal('Planexe.pdf')
      expect(Circles.cleanName('Min\u200butes')).to.equal('Minutes')
      expect(Circles.cleanName('\u2066\u200f\u200e\ufeff')).to.equal(null)
      // Hindi with a zero-width non-joiner, and a family emoji joined by zero-width joiners
      const hindi = '\u0915\u094d\u200c\u0937 \u0930\u093f\u092a\u094b\u0930\u094d\u091f.pdf'
      const family = '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 photos.jpg'
      expect(Circles.cleanName(hindi)).to.equal(hindi)
      expect(Circles.cleanName(family)).to.equal(family)
    })

    it('checks again before adding to a folder that was moved out of the circle in kDrive', async () => {
      const made = await call('createFolder', { userId: member.id, body: { name: 'Moving' } })
      const inside = await call('createFolder', { userId: member.id, body: { name: 'Deeper', folder: made.body.item.id } })
      await call('list', { userId: member.id, query: { folder: inside.body.item.id } }) // fills the cache
      state.tree[made.body.item.id].parent = 900
      expect((await upload(member.id, { folder: inside.body.item.id })).statusCode).to.equal(404)
    })

    it('shows the circle\'s files only to its active members', async () => {
      expect((await call('list', { userId: outsider.id })).statusCode).to.equal(403)
      expect((await call('list', {})).statusCode).to.equal(401)
      expect((await call('list', { userId: member.id, params: { groupSlug: 'nope' } })).statusCode).to.equal(404)
      await other.leaveGroup(group)
      expect((await call('list', { userId: other.id })).statusCode).to.equal(403)
      await other.joinGroup(group)
    })

    it('adds a member\'s file, names them, and lets only them and stewards change it', async () => {
      const res = await upload(member.id)
      expect(res.body.item).to.include({ name: 'Plan.txt', kind: 'file', size: 5, addedBy: 'Amara' })
      const id = res.body.item.id
      expect(state.tree[id].contents).to.equal('hello')

      const asMember = await call('list', { userId: member.id })
      expect(asMember.body.items.find(i => i.id === id)).to.include({ addedBy: 'Amara', canChange: true })
      const asOther = await call('list', { userId: other.id })
      expect(asOther.body.items.find(i => i.id === id)).to.include({ canChange: false })
      const asSteward = await call('list', { userId: steward.id })
      expect(asSteward.body.items.find(i => i.id === id).canChange).to.equal(true)

      const refused = await call('rename', { userId: other.id, body: { item: id, name: 'Mine.txt' } })
      expect(refused.statusCode).to.equal(403)
      expect((await call('remove', { userId: other.id, body: { item: id } })).statusCode).to.equal(403)
      expect(state.tree[id].name).to.equal('Plan.txt')

      const renamed = await call('rename', { userId: member.id, body: { item: id, name: 'Plan 2027.txt' } })
      expect(renamed.body.item).to.include({ name: 'Plan 2027.txt' })
      expect(state.tree[id].name).to.equal('Plan 2027.txt')

      const removed = await call('remove', { userId: steward.id, body: { item: id } })
      expect(removed.statusCode).to.equal(undefined)
      expect(state.tree[id].status).to.equal('trashed')
      expect((await call('list', { userId: member.id })).body.items.map(i => i.id)).to.not.include(id)
    })

    it('makes folders and adds files inside them', async () => {
      const made = await call('createFolder', { userId: member.id, body: { name: 'Reports', folder: '' } })
      expect(made.body.item).to.include({ name: 'Reports', kind: 'folder', canChange: true })
      const inside = await upload(other.id, { folder: made.body.item.id })
      expect(String(state.tree[inside.body.item.id].parent)).to.equal(made.body.item.id)
      const listed = await call('list', { userId: other.id, query: { folder: made.body.item.id } })
      expect(listed.body.folder).to.include({ name: 'Reports', isCircleFolder: false })
      expect(listed.body.items.map(i => i.name)).to.deep.equal(['Plan.txt'])
    })

    it('refuses empty files, files over the limit and nameless files before calling kDrive', async () => {
      process.env.AGORA_KDRIVE_MAX_UPLOAD_MB = '1'
      await call('list', { userId: member.id })
      const before = state.calls.length
      expect((await upload(member.id, { contents: '' })).statusCode).to.equal(411)
      expect((await upload(member.id, { headers: { 'content-length': String(2 * 1024 * 1024) } })).statusCode).to.equal(413)
      expect((await upload(member.id, { name: ' \u0000 ' })).statusCode).to.equal(400)
      expect((await upload(member.id, { headers: { 'content-type': 'multipart/form-data' } })).statusCode).to.equal(415)
      expect((await upload(member.id, { headers: { 'x-agora': '' } })).statusCode).to.equal(400)
      expect((await upload(outsider.id)).statusCode).to.equal(403)
      expect(state.calls.length).to.equal(before)
    })

    it('stops a file that is larger than it said', async () => {
      const res = await upload(member.id, { headers: { 'content-length': '3' } })
      expect(res.statusCode).to.be.oneOf([400, 502])
      expect(Object.values(state.tree).filter(f => f.name === 'Plan.txt')).to.have.length(0)
    })

    it('never opens, adds to or hands out anything outside the circle\'s folder', async () => {
      await call('list', { userId: member.id })
      for (const folder of ['900', '100', '1', '2', '99999', 'abc', '901']) {
        expect((await call('list', { userId: member.id, query: { folder } })).statusCode).to.equal(404)
        expect((await upload(member.id, { folder })).statusCode).to.equal(404)
      }
      const res = await call('rename', { userId: steward.id, body: { item: '901', name: 'x' } })
      expect(res.statusCode).to.equal(404)
      expect((await call('remove', { userId: steward.id, body: { item: '900' } })).statusCode).to.equal(404)
      const got = await download({ userId: member.id, query: { file: '901' } })
      expect(got.res.statusCode).to.equal(404)
      expect(got.text).to.not.include('not for Agora')
      expect(state.tree[901].name).to.equal('secret.txt')
    })

    it('does not open a folder that is in the bin', async () => {
      const made = await call('createFolder', { userId: member.id, body: { name: 'Old' } })
      state.tree[made.body.item.id].status = 'trashed'
      expect((await call('list', { userId: member.id, query: { folder: made.body.item.id } })).statusCode).to.equal(404)
    })

    it('never lets anyone delete or rename the circle\'s own folder', async () => {
      await call('list', { userId: member.id })
      const row = await bookshelf.knex('agora_kdrive_folders').where({ group_id: group.id }).first()
      expect((await call('remove', { userId: steward.id, body: { item: String(row.folder_id) } })).statusCode).to.equal(404)
    })

    it('hands out files through Agora, always as a download', async () => {
      const added = await upload(member.id, { name: '<b>page</b>.html', contents: '<script>alert(1)</script>' })
      const got = await download({ userId: other.id, query: { file: added.body.item.id } })
      expect(got.text).to.equal('<script>alert(1)</script>')
      expect(got.res.headers['Content-Type']).to.equal('application/octet-stream')
      expect(got.res.headers['Content-Disposition']).to.match(/^attachment; filename="<b>page<-b>.html"; filename\*=UTF-8''%3Cb%3Epage%3C-b%3E.html$/)
      expect(got.res.headers['X-Content-Type-Options']).to.equal('nosniff')
      const refused = await download({ userId: outsider.id, query: { file: added.body.item.id } })
      expect(refused.res.statusCode).to.equal(403)
      expect(refused.text).to.equal('')
    })

    it('gives a space its own folder inside its circle\'s folder, hidden from the circle', async () => {
      const circleList = await call('list', { userId: spaceMember.id })
      const spaceList = await call('list', { userId: spaceMember.id, params: { groupSlug: 'governance-budget' } })
      expect(spaceList.body.folder).to.include({ name: 'Budget', isCircleFolder: true })
      const circleRow = await bookshelf.knex('agora_kdrive_folders').where({ group_id: group.id }).first()
      const spaceRow = await bookshelf.knex('agora_kdrive_folders').where({ group_id: space.id }).first()
      expect(String(state.tree[spaceRow.folder_id].parent)).to.equal(String(circleRow.folder_id))
      expect(state.tree[spaceRow.folder_id].name).to.equal('Budget (governance-budget)')

      const again = await call('list', { userId: member.id })
      expect(again.body.items.map(i => i.id)).to.not.include(String(spaceRow.folder_id))
      expect(circleList.statusCode).to.equal(undefined)
      expect((await call('list', { userId: member.id, query: { folder: String(spaceRow.folder_id) } })).statusCode).to.equal(404)
      expect((await call('list', { userId: member.id, params: { groupSlug: 'governance-budget' } })).statusCode).to.equal(403)
    })

    it('says plainly when kDrive is busy, without the token', async () => {
      await call('list', { userId: member.id })
      state.busy = 10
      const res = await call('list', { userId: member.id })
      expect(res.statusCode).to.equal(503)
      expect(JSON.stringify(res.body)).to.not.include(TOKEN)
    })

    describe('the minutes', () => {
      let queued

      beforeEach(() => {
        queued = []
        mockify(Queue, 'classMethod', (...args) => { queued.push(args); return Promise.resolve() })
      })

      afterEach(() => unspyify(Queue, 'classMethod'))

      const markdown = (withSummary = true) => MeetingMinutes.renderMarkdown({
        title: 'Weekly call',
        date: '2026-10-21',
        minutes: !withSummary ? null : { summary: 'We met.', topics: [], decisions: ['Use kDrive'], actions: [{ who: 'Amara', what: 'Make the token', due: 'Friday' }], open_questions: [], cut: false },
        attendees: ['Amara', 'Lars'],
        guests: ['Pia (guest)'],
        lines: [{ name: 'Amara', text: 'Hello all', spokenAt: new Date('2026-10-21T10:00:30Z') }],
        chat: [{ name: 'Lars', text: 'A link\nand more', at: new Date('2026-10-21T10:01:00Z') }],
        startedAt: new Date('2026-10-21T10:00:00Z')
      })

      it('writes the same as the post: with a summary, the summary and who was there only', () => {
        const text = markdown()
        expect(text).to.match(/^# Minutes: Weekly call \(2026-10-21\)/)
        for (const part of ['## Summary', 'We met.', '## Decisions', '- Use kDrive', '**Amara**: Make the token (by Friday)', '## Who was there', 'Amara, Lars', 'Pia (guest)']) {
          expect(text).to.include(part)
        }
        for (const part of ['## Transcript', 'Hello all', '## Chat during the meeting', 'A link']) {
          expect(text).to.not.include(part)
        }
      })

      it('writes the transcript and the chat when no summary could be written, like the post', () => {
        const text = markdown(false)
        for (const part of ['_The assistant is not connected yet', '## Who was there', '## Transcript', '**Amara** 0:30', 'Hello all', '## Chat during the meeting', 'A link  \nand more']) {
          expect(text).to.include(part)
        }
        expect(text).to.not.include('## Summary')
      })

      it('saves a copy in the circle\'s Minutes folder, named by date and title', async () => {
        const failed = await KdriveMinutes.copy({ sessionId: 1, groupIds: [group.id], fileName: KdriveMinutes.fileNameFor('2026-10-21', 'Weekly call / plan'), markdown: markdown() })
        expect(failed).to.deep.equal([])
        const minutesFolder = Object.entries(state.tree).find(([, f]) => f.name === 'Minutes')
        const circle = await bookshelf.knex('agora_kdrive_folders').where({ group_id: group.id }).first()
        expect(String(minutesFolder[1].parent)).to.equal(String(circle.folder_id))
        expect(String(circle.minutes_folder_id)).to.equal(minutesFolder[0])
        const file = Object.values(state.tree).find(f => f.parent === Number(minutesFolder[0]))
        expect(file.name).to.equal('2026-10-21 Weekly call - plan.md')
        expect(file.contents).to.include('## Summary')
        expect(queued).to.have.length(0)
        // A second meeting goes into the same Minutes folder
        await KdriveMinutes.copy({ sessionId: 2, groupIds: [group.id], fileName: '2026-10-22 Next.md', markdown: 'x' })
        expect(Object.values(state.tree).filter(f => f.name === 'Minutes')).to.have.length(1)
      })

      it('keeps the Minutes folder out of members\' hands, also one a member made before', async () => {
        await call('list', { userId: member.id })
        const circle = await bookshelf.knex('agora_kdrive_folders').where({ group_id: group.id }).first()
        // A folder called Minutes, made by a member before Agora used it (bypassing today's check)
        const id = 5000
        state.tree[id] = { name: 'Minutes', type: 'dir', parent: Number(circle.folder_id) }
        await bookshelf.knex('agora_kdrive_items').insert({ file_id: id, group_id: group.id, user_id: member.id, kind: 'dir', created_at: new Date() })
        await KdriveMinutes.copy({ sessionId: 5, groupIds: [group.id], fileName: '2026-10-21 Call.md', markdown: 'x' })
        expect(String((await bookshelf.knex('agora_kdrive_folders').where({ group_id: group.id }).first()).minutes_folder_id)).to.equal(String(id))
        expect(await bookshelf.knex('agora_kdrive_items').where({ file_id: id }).first()).to.equal(undefined)
        for (const userId of [member.id, steward.id]) {
          expect((await call('rename', { userId, body: { item: String(id), name: 'Mine' } })).statusCode).to.equal(404)
          expect((await call('remove', { userId, body: { item: String(id) } })).statusCode).to.equal(404)
        }
        expect(state.tree[id]).to.include({ name: 'Minutes' })
        expect(state.tree[id].status).to.equal(undefined)
        for (const userId of [member.id, steward.id]) {
          const listed = await call('list', { userId })
          expect(listed.body.items.find(i => i.id === String(id))).to.include({ canChange: false, addedBy: null })
        }
      })

      it('lets nobody make or rename a folder to Minutes at the top of the circle\'s folder', async () => {
        for (const name of ['Minutes', 'minutes', ' MINUTES ', 'Min\u200butes']) {
          const res = await call('createFolder', { userId: member.id, body: { name } })
          expect(res.statusCode).to.equal(400)
          expect(res.body.error).to.match(/kept for the meeting minutes/)
        }
        const other = await call('createFolder', { userId: member.id, body: { name: 'Notes' } })
        expect((await call('rename', { userId: member.id, body: { item: other.body.item.id, name: 'minutes' } })).statusCode).to.equal(400)
        expect((await call('rename', { userId: steward.id, body: { item: other.body.item.id, name: 'Minutes' } })).statusCode).to.equal(400)
        expect(state.tree[other.body.item.id].name).to.equal('Notes')
        // Deeper down the name is free
        const deeper = await call('createFolder', { userId: member.id, body: { name: 'Minutes', folder: other.body.item.id } })
        expect(deeper.body.item).to.include({ name: 'Minutes' })
      })

      it('lets nobody upload a file called Minutes at the top, or rename a file to it', async () => {
        for (const name of ['Minutes', 'MINUTES', 'Min\u200cutes']) {
          const res = await upload(member.id, { name })
          expect(res.statusCode).to.equal(400)
          expect(res.body.error).to.match(/kept for the meeting minutes/)
        }
        const file = await upload(member.id, { name: 'notes.txt' })
        expect((await call('rename', { userId: member.id, body: { item: file.body.item.id, name: 'minutes' } })).statusCode).to.equal(400)
        expect(state.tree[file.body.item.id].name).to.equal('notes.txt')
      })

      it('still saves the minutes when a file called Minutes is in the way', async () => {
        await call('list', { userId: member.id })
        const circle = await bookshelf.knex('agora_kdrive_folders').where({ group_id: group.id }).first()
        state.tree[6000] = { name: 'Minutes', type: 'file', parent: Number(circle.folder_id), contents: 'in the way' }
        expect(await KdriveMinutes.copy({ sessionId: 6, groupIds: [group.id], fileName: '2026-10-21 Call.md', markdown: 'x' })).to.deep.equal([])
        const folder = Object.entries(state.tree).find(([, f]) => f.name === 'Minutes (Agora)')
        expect(String(folder[1].parent)).to.equal(String(circle.folder_id))
        expect(Object.values(state.tree).some(f => f.name === '2026-10-21 Call.md' && String(f.parent) === folder[0])).to.equal(true)
        expect(queued).to.have.length(0)
        // and the next time too
        expect(await KdriveMinutes.copy({ sessionId: 7, groupIds: [group.id], fileName: '2026-10-22 Call.md', markdown: 'y' })).to.deep.equal([])
      })

      it('lets members add nothing to the Minutes folder', async () => {
        await KdriveMinutes.copy({ sessionId: 8, groupIds: [group.id], fileName: '2026-10-21 Call.md', markdown: 'x' })
        const row = await bookshelf.knex('agora_kdrive_folders').where({ group_id: group.id }).first()
        const folder = String(row.minutes_folder_id)
        for (const userId of [member.id, steward.id]) {
          const added = await upload(userId, { folder })
          expect(added.statusCode).to.equal(403)
          expect(added.body.error).to.match(/only for the meeting minutes/)
          expect((await call('createFolder', { userId, body: { name: 'Mine', folder } })).statusCode).to.equal(403)
        }
        expect(Object.values(state.tree).filter(f => String(f.parent) === folder).map(f => f.name)).to.deep.equal(['2026-10-21 Call.md'])
      })

      it('never throws when kDrive fails, and tries once more later', async () => {
        nock.cleanAll()
        nock(API).persist().get(/.*/).reply(500, { result: 'error', error: { code: 'down' } }).post(/.*/).reply(500, {})
        const failed = await KdriveMinutes.copy({ sessionId: 3, groupIds: [group.id], fileName: 'x.md', markdown: 'x' })
        expect(failed).to.deep.equal([group.id])
        expect(queued).to.have.length(1)
        expect(queued[0][0]).to.equal('MeetingSession')
        expect(queued[0][1]).to.equal('copyMinutesToKdrive')
        expect(queued[0][2]).to.include({ sessionId: 3, attempt: 2 })
        expect(queued[0][3]).to.equal(KdriveMinutes.RETRY_MINUTES * 60000)
        // The second try does not plan a third
        queued.length = 0
        await MeetingSession.copyMinutesToKdrive({ sessionId: 3, groupIds: [group.id], fileName: 'x.md', markdown: 'x', attempt: 2 })
        expect(queued).to.have.length(0)
      })

      /** A meeting of the circle that has ended, with one chat message. */
      async function endedMeeting (name) {
        const event = await createPost(member.id, { name, type: Post.Type.EVENT, group_ids: [group.id], startTime: Date.now(), endTime: Date.now() + 3600000 })
        const session = await MeetingSession.openForPost({ post: event, userId: member.id })
        await bookshelf.knex('meeting_chat_messages').insert({ session_id: session.id, user_id: member.id, text: 'Notes are in the doc', created_at: new Date() })
        await session.save({ status: MeetingSession.Status.CLOSING, ended_at: new Date() }, { patch: true })
        return session
      }

      it('saves the copy after the worker posts the minutes', async () => {
        delete process.env.ANTHROPIC_API_KEY // no summary, so the post and the copy hold the chat
        const session = await endedMeeting('Budget call')
        const post = await MeetingSession.finalize({ sessionId: session.id })
        expect(post.get('name')).to.match(/^Minutes: Budget call/)
        const file = Object.values(state.tree).find(f => /Budget call\.md$/.test(f.name))
        expect(file.name).to.match(/^\d{4}-\d{2}-\d{2} Budget call\.md$/)
        expect(file.contents).to.include('Notes are in the doc')
        expect(file.contents).to.include('## Chat during the meeting')
      })

      it('still posts the minutes when kDrive is down', async () => {
        delete process.env.ANTHROPIC_API_KEY
        const session = await endedMeeting('Outreach call')
        nock.cleanAll()
        nock(API).persist().get(/.*/).reply(503, {}).post(/.*/).reply(503, {})
        const post = await MeetingSession.finalize({ sessionId: session.id })
        expect(post.get('name')).to.match(/^Minutes: Outreach call/)
        expect((await MeetingSession.where({ id: session.id }).fetch()).get('minutes_post_id')).to.equal(post.id)
        expect(queued.map(q => q[1])).to.include('copyMinutesToKdrive')
      })

      it('does nothing without kDrive settings', async () => {
        delete process.env.AGORA_KDRIVE_TOKEN
        expect(await KdriveMinutes.copy({ sessionId: 4, groupIds: [group.id], fileName: 'x.md', markdown: 'x' })).to.deep.equal([])
        expect(state.calls).to.have.length(0)
      })
    })
  })
})
