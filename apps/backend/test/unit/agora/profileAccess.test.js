/* eslint-env mocha */
/**
 * Agora: Agora admins (AGORA_ADMINS) can open every person's profile, and
 * profile links read /members/5-mariam.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/profileAccess.test.js
 */
import { createRequestHandler } from '../../../api/graphql'
import Admins from '../../../lib/agora/admins'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const ENV_NAMES = ['AGORA_ADMINS', 'AGORA_HELPDESK_ADMINS']
const SAVED_ENV = {}

describe('Agora profiles', () => {
  let handler, guy, boss, sleepy, amara, mariam, blocker, circle, otherCircle, post

  async function personAs (viewer, personId) {
    const req = factories.mock.request()
    req.url = '/noo/graphql'
    req.method = 'POST'
    req.headers = { 'Content-Type': 'application/json' }
    req.session = { userId: viewer.id, destroy: () => {} }
    req.user = viewer
    const res = factories.mock.response()
    const { executionResult } = await handler.inject({
      document: `{
        person(id: "${personId}") {
          id
          name
          bio
          memberships { id group { id slug } }
          posts { items { id } }
        }
      }`,
      serverContext: { req, res }
    })
    expect(executionResult.errors).to.equal(undefined)
    return executionResult.data.person
  }

  before(async () => {
    for (const name of ENV_NAMES) { SAVED_ENV[name] = process.env[name]; delete process.env[name] }
    await setup.clearDb()
    handler = createRequestHandler()
    const user = attrs => new User({ active: true, email_validated: true, created_at: new Date(), ...attrs }).save()
    guy = await user({ name: 'Guy', email: 'guy@agora.test' })
    boss = await user({ name: 'Boss', email: 'boss@agora.test' })
    sleepy = await user({ name: 'Sleepy', email: 'sleepy@agora.test', active: false })
    amara = await user({ name: 'Amara', email: 'amara@agora.test' })
    mariam = await user({ name: 'Mariam:)', email: 'mariam@agora.test', bio: 'Hello' })
    blocker = await user({ name: 'Blocker', email: 'blocker@agora.test' })

    // Amara shares no circle with Guy. Mariam is in no circle at all.
    circle = await factories.group({ name: 'Governance', slug: 'governance' }).save()
    otherCircle = await factories.group({ name: 'Media', slug: 'media' }).save()
    await circle.addMembers([guy.id])
    await otherCircle.addMembers([amara.id])
    post = await factories.post({ user_id: amara.id, active: true }).save()
    await post.groups().attach(otherCircle.id)
    await BlockedUser.create(blocker.id, guy.id)

    process.env.AGORA_ADMINS = `${guy.id}, BOSS@agora.test, sleepy@agora.test`
  })

  after(() => {
    for (const name of ENV_NAMES) {
      if (SAVED_ENV[name] === undefined) delete process.env[name]
      else process.env[name] = SAVED_ENV[name]
    }
  })

  it('lets an Agora admin open the profile of someone in no circle', async () => {
    const person = await personAs(guy, mariam.id)
    expect(person).to.not.equal(null)
    expect(person.name).to.equal('Mariam:)')
    expect(person.bio).to.equal('Hello')
    expect(person.memberships).to.deep.equal([])
  })

  it('also counts an admin named by a confirmed email address', async () => {
    const person = await personAs(boss, mariam.id)
    expect(person && person.id).to.equal(mariam.id)
  })

  it('shows nothing to someone who is not an Agora admin', async () => {
    expect(await personAs(amara, mariam.id)).to.equal(null)
  })

  it('shows nothing once the admin list no longer names you', async () => {
    const saved = process.env.AGORA_ADMINS
    try {
      process.env.AGORA_ADMINS = ''
      expect(await personAs(guy, mariam.id)).to.equal(null)
    } finally {
      process.env.AGORA_ADMINS = saved
    }
  })

  it('keeps the circles and posts of the profile to what a member of those circles would see', async () => {
    const person = await personAs(guy, amara.id)
    expect(person && person.id).to.equal(amara.id)
    // Amara is only in Media, which Guy is not in: the admin does not see that circle or its posts.
    expect(person.memberships).to.deep.equal([])
    expect(person.posts.items).to.deep.equal([])
  })

  it('still respects a block', async () => {
    expect(await personAs(guy, blocker.id)).to.equal(null)
  })

  it('builds the admin check as a query that matches only admins', async () => {
    const isAdmin = async id => {
      const query = Admins.agoraAdminQuery(id)
      if (!query) return false
      return (await query).length > 0
    }
    expect(await isAdmin(guy.id)).to.equal(true)
    expect(await isAdmin(boss.id)).to.equal(true)
    expect(await isAdmin(sleepy.id)).to.equal(false) // listed, but switched off
    expect(await isAdmin(amara.id)).to.equal(false)
    expect(Admins.agoraAdminQuery(null)).to.equal(null)
    expect(Admins.agoraAdminQuery('1 or 1=1')).to.equal(null)
  })

  it('also counts an admin given in the admin area', async () => {
    const isAdmin = async id => (await Admins.agoraAdminQuery(id)).length > 0
    expect(await isAdmin(amara.id)).to.equal(false)
    await bookshelf.knex('agora_roles').insert({ user_id: amara.id, role: 'admin', created_at: new Date() })
    try {
      expect(await isAdmin(amara.id)).to.equal(true)
    } finally {
      await bookshelf.knex('agora_roles').where({ user_id: amara.id }).del()
    }
  })

  describe('profile links in emails', () => {
    it('put the name after the id', () => {
      expect(Frontend.Route.profile(mariam)).to.match(/\/members\/\d+-mariam$/)
      expect(Frontend.Route.profile(mariam, circle)).to.match(/\/groups\/governance\/members\/\d+-mariam$/)
      expect(Frontend.Route.profile({ id: 7, name: 'José Núñez' })).to.match(/\/members\/7-jose-nunez$/)
    })

    it('keep a plain id when only the id is known', () => {
      expect(Frontend.Route.profile(5)).to.match(/\/members\/5$/)
      expect(Frontend.Route.profile('5')).to.match(/\/members\/5$/)
    })
  })
})
