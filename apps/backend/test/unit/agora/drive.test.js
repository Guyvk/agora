/* eslint-env mocha */
/**
 * Agora: the circle Files page and the Google Drive reader behind it.
 *
 * Google is replaced by a small fake Drive, so no account is needed. The page
 * checks need a database, and empty it first. Never point them at a database
 * you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/drive.test.js
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import Drive from '../../../lib/agora/drive'
import DriveLinks from '../../../lib/agora/driveLinks'
import AgoraFilesController from '../../../api/controllers/AgoraFilesController'
import sessionAuth from '../../../api/policies/sessionAuth'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const FOLDER = 'application/vnd.google-apps.folder'
const DOC = 'application/vnd.google-apps.document'

// The fake Drive: the main folder, two circle folders, a folder inside one of
// them, things that must never open as a folder (a folder in the bin, a
// shortcut, a file), and a folder outside the main folder.
const tree = {
  root0000000: { name: '7BP', mimeType: FOLDER, parents: [] },
  governance0: { name: 'Governance ', mimeType: FOLDER, parents: ['root0000000'] },
  care0000000: { name: 'Care', mimeType: FOLDER, parents: ['root0000000'] },
  note0000000: { name: 'Read me', mimeType: DOC, parents: ['root0000000'] },
  playbook000: { name: 'Playbook', mimeType: DOC, parents: ['governance0'], modifiedTime: '2026-10-10T09:00:00Z', lastModifyingUser: { displayName: 'Lars' } },
  archive0000: { name: 'Archive', mimeType: FOLDER, parents: ['governance0'] },
  minutes0000: { name: 'Old minutes.pdf', mimeType: 'application/pdf', parents: ['archive0000'] },
  binned00000: { name: 'Old stuff', mimeType: FOLDER, parents: ['governance0'], trashed: true },
  inbin000000: { name: 'Inside the bin', mimeType: FOLDER, parents: ['binned00000'] },
  shortcut000: { name: 'Link to Care', mimeType: 'application/vnd.google-apps.shortcut', parents: ['governance0'] },
  private0000: { name: 'Private', mimeType: FOLDER, parents: ['elsewhere00'] },
  elsewhere00: { name: 'Someone else', mimeType: FOLDER, parents: [] }
}

function fakeGoogle (publicKey, seen) {
  return async (url, options = {}) => {
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(options.body).get('assertion')
      seen.claims = jwt.verify(assertion, publicKey, { algorithms: ['RS256'] })
      return reply(200, { access_token: 'fake-token', expires_in: 3600 })
    }
    if (options.headers.authorization !== 'Bearer fake-token') return reply(401, {})
    const { pathname, searchParams } = new URL(url)
    if (pathname === '/drive/v3/files') {
      const parent = searchParams.get('q').match(/^'([^']+)' in parents/)[1]
      const files = Object.entries(tree)
        .filter(([, f]) => f.parents.includes(parent) && !f.trashed)
        .map(([id, f]) => ({ id, webViewLink: `https://drive.google.com/${id}`, ...f }))
      return reply(200, { files })
    }
    const id = pathname.split('/').pop()
    if (!tree[id]) return reply(404, {})
    return reply(200, { id, trashed: false, ...tree[id], webViewLink: `https://drive.google.com/${id}` })
  }
}

/** A request like Sails makes: param() looks in the address, the query and the body. */
function mockRequest ({ params = {}, query = {}, body = {}, headers = {}, userId } = {}) {
  const req = factories.mock.request()
  req.params = params
  req.query = query
  req.body = body
  req.headers = headers
  req.param = name => [params, query, body].map(source => source && source[name]).find(v => v !== undefined)
  req.originalUrl = `/noo/agora/files/${params.groupSlug}`
  if (userId) req.login(userId)
  return req
}

describe('Agora files', () => {
  const saved = {}
  const seen = {}

  before(() => {
    for (const name of ['AGORA_DRIVE_FOLDER_ID', 'AGORA_GOOGLE_SERVICE_ACCOUNT_KEY', 'AGORA_DRIVE_UPLOADS', 'PROTOCOL', 'DOMAIN']) saved[name] = process.env[name]
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const key = { client_email: 'robot@agora-7bp.iam.gserviceaccount.com', private_key: privateKey }
    process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY = Buffer.from(JSON.stringify(key)).toString('base64')
    process.env.AGORA_DRIVE_FOLDER_ID = 'https://drive.google.com/drive/folders/root0000000?usp=sharing'
    delete process.env.AGORA_DRIVE_UPLOADS
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    Drive.setFetch(fakeGoogle(publicKey, seen))
  })

  after(() => {
    Drive.setFetch(null)
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  describe('the Drive reader', () => {
    it('reads a folder id from an id or a Drive link', () => {
      expect(Drive.folderIdFrom('1AbCdEfGhIjK')).to.equal('1AbCdEfGhIjK')
      expect(Drive.folderIdFrom('https://drive.google.com/drive/folders/1AbCdEfGhIjK?usp=sharing')).to.equal('1AbCdEfGhIjK')
      expect(Drive.folderIdFrom("x' or name contains 'a")).to.equal(null)
      expect(Drive.folderIdFrom('')).to.equal(null)
    })

    it('matches names regardless of capitals and spaces', () => {
      expect(Drive.sameName('Governance ', 'governance')).to.equal(true)
      expect(Drive.sameName('Care  Circle', 'care circle')).to.equal(true)
      expect(Drive.sameName('Care', 'Careers')).to.equal(false)
      expect(Drive.sameName('', '')).to.equal(false)
    })

    it('lists the circle\'s linked folder, logged in read-only', async () => {
      const result = await Drive.circleFiles('governance0')
      expect(result.folder).to.include({ id: 'governance0', isCircleFolder: true })
      expect(result.items.map(i => [i.name, i.kind])).to.deep.equal([['Playbook', 'document'], ['Archive', 'folder'], ['Link to Care', 'file']])
      expect(result.items[0]).to.include({ changedBy: 'Lars', changedAt: '2026-10-10T09:00:00Z', link: 'https://drive.google.com/playbook000' })
      expect(seen.claims.scope).to.equal('https://www.googleapis.com/auth/drive.readonly')
      expect(seen.claims.iss).to.equal('robot@agora-7bp.iam.gserviceaccount.com')
    })

    it('opens a folder inside the circle\'s folder', async () => {
      const result = await Drive.circleFiles('governance0', 'archive0000')
      expect(result.folder).to.include({ id: 'archive0000', name: 'Archive', isCircleFolder: false })
      expect(result.items.map(i => i.name)).to.deep.equal(['Old minutes.pdf'])
    })

    it('gives one and the same answer for every folder that cannot be opened', async () => {
      // another circle's folder, outside the main folder, the main folder,
      // a file, a shortcut, a folder in the bin, a folder inside one, and an id that does not exist
      for (const id of ['care0000000', 'private0000', 'root0000000', 'playbook000', 'shortcut000', 'binned00000', 'inbin000000', 'doesnotexist00']) {
        await expectNotFound(Drive.circleFiles('governance0', id))
      }
    })

    it('says so when no folder is linked to a circle', async () => {
      expect(await Drive.circleFiles(null)).to.deep.equal({ folder: null })
    })

    it('treats a linked folder outside the main folder, or the main folder itself, as a broken link', async () => {
      for (const id of ['private0000', 'root0000000', 'playbook000', 'binned00000', 'doesnotexist00']) {
        await expectCode(Drive.circleFiles(id), 'link_broken')
      }
    })

    it('only links folders inside the main folder', async () => {
      expect(await Drive.folderToLink('https://drive.google.com/drive/folders/care0000000')).to.deep.equal({ id: 'care0000000', name: 'Care' })
      await expectCode(Drive.folderToLink('private0000'), 'link_broken')
      expect((await Drive.mainFolders()).map(f => f.id)).to.deep.equal(['governance0', 'care0000000'])
    })
  })

  describe('the Files page', () => {
    let member, other, impostor, governance, fakeGovernance

    before(() => setup.clearDb()
      .then(() => Promise.props({
        m: new User({ name: 'Amara', email: 'files@agora.test', active: true }).save(),
        o: new User({ name: 'Lars', email: 'other@agora.test', active: true }).save(),
        i: new User({ name: 'Mallory', email: 'impostor@agora.test', active: true }).save(),
        g: new Group({ slug: 'governance', name: 'Governance' }).save(),
        f: new Group({ slug: 'governance-2', name: 'Governance' }).save()
      }))
      .then(async props => {
        ({ m: member, o: other, i: impostor, g: governance, f: fakeGovernance } = props)
        await member.joinGroup(governance)
        await impostor.joinGroup(fakeGovernance)
        await DriveLinks.link(governance.id, 'governance0', 'test')
      }))

    function call (action, { params = {}, query = {}, userId } = {}) {
      const req = mockRequest({ params: { groupSlug: 'governance', ...params }, query, userId })
      const res = factories.mock.response()
      res.headers = {}
      res.set = (name, value) => { res.headers[name] = value }
      return AgoraFilesController[action](req, res).then(() => res)
    }

    it('sends people who are not logged in to the login page', async () => {
      const res = await call('page')
      expect(res.redirected).to.equal('https://agora.example.org/login?returnToUrl=%2Fnoo%2Fagora%2Ffiles%2Fgovernance')
    })

    it('shows the page to anyone logged in, with the circle filled in safely', async () => {
      await governance.save({ name: 'Governance </script>' }, { patch: true })
      const res = await call('page', { userId: other.id })
      await governance.save({ name: 'Governance' }, { patch: true })
      expect(res.body).to.contain('"circleName":"Governance \\u003c/script>"')
      expect(res.body).not.to.contain('Governance </script>')
      expect(res.body).not.to.contain('__AGORA_BOOT__')
    })

    it('lets the login policy stop a list call from someone not logged in', async () => {
      // The tests lift Sails without its policies, so read the file afresh.
      const file = require.resolve('../../../config/policies')
      delete require.cache[file]
      const rules = require(file).policies.AgoraFilesController
      expect(rules.list).to.equal(undefined)
      expect(rules['*']).to.equal('sessionAuth')
      const req = mockRequest({ params: { groupSlug: 'governance' } })
      const res = factories.mock.response()
      let passed = false
      sessionAuth(req, res, () => { passed = true })
      expect(passed).to.equal(false)
      expect(res.statusCode).to.equal(401)
      // and the controller refuses too, should the policy ever be changed
      expect((await call('list')).statusCode).to.equal(401)
    })

    it('lists the circle\'s files for a member', async () => {
      const res = await call('list', { userId: member.id })
      expect(res.body.configured).to.equal(true)
      expect(res.body.folder.id).to.equal('governance0')
      expect(res.body.items).to.have.length(3)
      expect(res.body.canAdd).to.equal(false)
    })

    it('does not list a circle\'s files for someone who is not a member', async () => {
      const res = await call('list', { userId: other.id })
      expect(res.statusCode).to.equal(403)
      expect(res.body.items).to.equal(undefined)
    })

    it('never shows a circle\'s folder to a second circle with the same name', async () => {
      const res = await call('list', { userId: impostor.id, params: { groupSlug: 'governance-2' } })
      expect(res.body).to.include({ configured: true, folder: null })
      const theirs = await call('list', { userId: impostor.id, query: { folder: 'archive0000' }, params: { groupSlug: 'governance-2' } })
      expect(theirs.body.folder).to.equal(null)
      expect((await call('list', { userId: impostor.id })).statusCode).to.equal(403)
    })

    it('answers 404, always the same, for a folder that is not the circle\'s', async () => {
      const answers = []
      for (const folder of ['private0000', 'care0000000', 'binned00000', 'shortcut000', 'playbook000', 'doesnotexist00']) {
        const res = await call('list', { userId: member.id, query: { folder } })
        expect(res.statusCode).to.equal(404)
        answers.push(res.body.error)
      }
      expect(new Set(answers).size).to.equal(1)
    })

    it('answers 404 for a circle that does not exist', async () => {
      const res = await call('list', { params: { groupSlug: 'nope' }, userId: member.id })
      expect(res.statusCode).to.equal(404)
    })

    it('says Drive is not connected when the settings are missing', async () => {
      const key = process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY
      delete process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY
      const res = await call('list', { userId: member.id })
      process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY = key
      expect(res.body).to.deep.equal({ configured: false })
    })
  })
})

async function expectCode (promise, code) {
  try {
    await promise
  } catch (err) {
    expect(err.code).to.equal(code)
    return err
  }
  throw new Error(`expected a ${code} error`)
}

async function expectNotFound (promise) {
  const err = await expectCode(promise, 'not_found')
  expect(err.message).to.equal(Drive.NOT_HERE)
}
