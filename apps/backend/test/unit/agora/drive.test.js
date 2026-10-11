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
import AgoraFilesController from '../../../api/controllers/AgoraFilesController'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const FOLDER = 'application/vnd.google-apps.folder'
const DOC = 'application/vnd.google-apps.document'

// The fake Drive: the main folder, two circle folders, a folder inside one of
// them, and a folder outside the main folder that must never be shown.
const tree = {
  root0000000: { name: '7BP', mimeType: FOLDER, parents: [] },
  governance0: { name: 'Governance ', mimeType: FOLDER, parents: ['root0000000'] },
  care0000000: { name: 'Care', mimeType: FOLDER, parents: ['root0000000'] },
  note0000000: { name: 'Read me', mimeType: DOC, parents: ['root0000000'] },
  playbook000: { name: 'Playbook', mimeType: DOC, parents: ['governance0'], modifiedTime: '2026-10-10T09:00:00Z', lastModifyingUser: { displayName: 'Lars' } },
  archive0000: { name: 'Archive', mimeType: FOLDER, parents: ['governance0'] },
  minutes0000: { name: 'Old minutes.pdf', mimeType: 'application/pdf', parents: ['archive0000'] },
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
        .filter(([, f]) => f.parents.includes(parent))
        .map(([id, f]) => ({ id, webViewLink: `https://drive.google.com/${id}`, ...f }))
      return reply(200, { files })
    }
    const id = pathname.split('/').pop()
    if (!tree[id]) return reply(404, {})
    return reply(200, { id, ...tree[id], webViewLink: `https://drive.google.com/${id}` })
  }
}

describe('Agora files', () => {
  const saved = {}
  const seen = {}

  before(() => {
    for (const name of ['AGORA_DRIVE_FOLDER_ID', 'AGORA_GOOGLE_SERVICE_ACCOUNT_KEY', 'PROTOCOL', 'DOMAIN']) saved[name] = process.env[name]
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const key = { client_email: 'robot@agora-7bp.iam.gserviceaccount.com', private_key: privateKey }
    process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY = Buffer.from(JSON.stringify(key)).toString('base64')
    process.env.AGORA_DRIVE_FOLDER_ID = 'https://drive.google.com/drive/folders/root0000000?usp=sharing'
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

    it('lists the folder with the circle\'s name, logged in read-only', async () => {
      const result = await Drive.circleFiles('governance')
      expect(result.folder).to.include({ id: 'governance0', isCircleFolder: true })
      expect(result.items.map(i => [i.name, i.kind])).to.deep.equal([['Playbook', 'document'], ['Archive', 'folder']])
      expect(result.items[0]).to.include({ changedBy: 'Lars', changedAt: '2026-10-10T09:00:00Z', link: 'https://drive.google.com/playbook000' })
      expect(seen.claims.scope).to.equal('https://www.googleapis.com/auth/drive.readonly')
      expect(seen.claims.iss).to.equal('robot@agora-7bp.iam.gserviceaccount.com')
    })

    it('opens a folder inside the circle\'s folder', async () => {
      const result = await Drive.circleFiles('Governance', 'archive0000')
      expect(result.folder).to.include({ id: 'archive0000', name: 'Archive', isCircleFolder: false })
      expect(result.items.map(i => i.name)).to.deep.equal(['Old minutes.pdf'])
    })

    it('does not open another circle\'s folder through this circle', async () => {
      await expectNotFound(Drive.circleFiles('Governance', 'care0000000'))
    })

    it('never shows a folder outside the main folder', async () => {
      await expectNotFound(Drive.circleFiles('Governance', 'private0000'))
      await expectNotFound(Drive.circleFiles('Governance', 'root0000000'))
    })

    it('does not open a file as if it were a folder', async () => {
      await expectNotFound(Drive.circleFiles('Governance', 'playbook000'))
    })

    it('says so when a circle has no folder yet', async () => {
      expect(await Drive.circleFiles('Stories')).to.deep.equal({ folder: null })
    })
  })

  describe('the Files page', () => {
    let user, group

    before(() => setup.clearDb()
      .then(() => Promise.props({
        u: new User({ name: 'Amara', email: 'files@agora.test', active: true }).save(),
        g: new Group({ slug: 'governance', name: 'Governance' }).save()
      }))
      .then(props => {
        user = props.u
        group = props.g
      }))

    function call (action, params, userId) {
      const req = factories.mock.request()
      req.params = params
      req.originalUrl = `/noo/agora/files/${params.groupSlug}`
      if (userId) req.login(userId)
      const res = factories.mock.response()
      res.headers = {}
      res.set = (name, value) => { res.headers[name] = value }
      return AgoraFilesController[action](req, res).then(() => res)
    }

    it('sends people who are not logged in to the login page', async () => {
      const res = await call('page', { groupSlug: 'governance' })
      expect(res.redirected).to.equal('https://agora.example.org/login?returnToUrl=%2Fnoo%2Fagora%2Ffiles%2Fgovernance')
    })

    it('shows the page to anyone logged in, with the circle filled in safely', async () => {
      await group.save({ name: 'Governance </script>' }, { patch: true })
      const res = await call('page', { groupSlug: 'governance' }, user.id)
      await group.save({ name: 'Governance' }, { patch: true })
      expect(res.body).to.contain('"circleName":"Governance \\u003c/script>"')
      expect(res.body).not.to.contain('Governance </script>')
      expect(res.body).not.to.contain('__AGORA_BOOT__')
    })

    it('lists the circle\'s files', async () => {
      const res = await call('list', { groupSlug: 'governance' }, user.id)
      expect(res.body.configured).to.equal(true)
      expect(res.body.folder.id).to.equal('governance0')
      expect(res.body.items).to.have.length(2)
    })

    it('answers 404 for a folder that is not the circle\'s', async () => {
      const res = await call('list', { groupSlug: 'governance', folder: 'private0000' }, user.id)
      expect(res.statusCode).to.equal(404)
    })

    it('answers 404 for a circle that does not exist', async () => {
      const res = await call('list', { groupSlug: 'nope' }, user.id)
      expect(res.statusCode).to.equal(404)
    })

    it('says Drive is not connected when the settings are missing', async () => {
      const key = process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY
      delete process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY
      const res = await call('list', { groupSlug: 'governance' }, user.id)
      process.env.AGORA_GOOGLE_SERVICE_ACCOUNT_KEY = key
      expect(res.body).to.deep.equal({ configured: false })
    })
  })
})

async function expectNotFound (promise) {
  try {
    await promise
  } catch (err) {
    expect(err.code).to.equal('not_found')
    return
  }
  throw new Error('expected a not_found error')
}
