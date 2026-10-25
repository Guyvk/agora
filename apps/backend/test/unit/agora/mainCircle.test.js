/* eslint-env mocha */
/**
 * Agora: what the web reads to show the 7BP Home (lib/agora/mainCircle.js),
 * through GraphQL as the web uses it. These checks empty the database first:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/mainCircle.test.js
 */
import { createRequestHandler } from '../../../api/graphql'
import { mainCircleFor } from '../../../lib/agora/mainCircle'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const QUERY = 'query { agoraMainCircle { id slug name avatarUrl circles { id slug name avatarUrl memberCount } } }'

describe('Agora main circle for the web', () => {
  const knex = () => bookshelf.knex
  let handler, ann, bob, outsider, main, a, b, kept, hidden, savedSlug

  async function gql (user) {
    const req = factories.mock.request()
    req.url = '/noo/graphql'
    req.method = 'POST'
    req.headers = { 'Content-Type': 'application/json' }
    req.session = user ? { userId: user.id, destroy: () => {} } : {}
    const { executionResult } = await handler.inject({ document: QUERY, variables: {}, serverContext: { req, res: factories.mock.response() } })
    return executionResult
  }

  before(async () => {
    savedSlug = process.env.AGORA_MAIN_GROUP_SLUG
    delete process.env.AGORA_MAIN_GROUP_SLUG
    await setup.clearDb()
    handler = createRequestHandler()
    const mk = name => new User({ name, email: `${name.toLowerCase()}@agora.test`, active: true, email_validated: true }).save()
    ann = await mk('Ann')
    bob = await mk('Bob')
    outsider = await mk('Outsider')
    main = await Group.create(ann.id, { name: '7BP', slug: '7bp' })
    a = await Group.create(ann.id, { name: 'Alpha', slug: 'alpha', visibility: Group.Visibility.PROTECTED })
    b = await Group.create(bob.id, { name: 'Beta', slug: 'beta', visibility: Group.Visibility.PROTECTED })
    kept = await Group.create(ann.id, { name: 'Kept apart', slug: 'kept-apart', visibility: Group.Visibility.PROTECTED })
    hidden = await Group.create(bob.id, { name: 'Secret', slug: 'secret', visibility: Group.Visibility.HIDDEN })
    for (const g of [a, b, kept, hidden]) await g.parentGroups().attach(main.id)
    await knex()('group_relationships').where({ parent_group_id: main.id, child_group_id: kept.id }).update({ active: false })
    await main.addMembers([bob.id])
    await a.addMembers([bob.id])
  })

  after(() => {
    if (savedSlug === undefined) delete process.env.AGORA_MAIN_GROUP_SLUG
    else process.env.AGORA_MAIN_GROUP_SLUG = savedSlug
  })

  it('lists the active child circles with member counts, not the switched-off one', async () => {
    const r = await mainCircleFor(ann.id)
    expect(r.slug).to.equal('7bp')
    expect(r.name).to.equal('7BP')
    expect(r.circles.map(c => c.slug)).to.deep.equal(['alpha', 'beta'])
    const alpha = r.circles.find(c => c.slug === 'alpha')
    expect(alpha.memberCount).to.equal(2)
  })

  it('leaves out a hidden circle the person is not in', async () => {
    const r = await mainCircleFor(bob.id)
    expect(r.circles.map(c => c.slug)).to.include('secret') // Bob is in it
    const m = await Group.find(main.id)
    await m.addMembers([outsider.id])
    const o = await mainCircleFor(outsider.id)
    expect(o.circles.map(c => c.slug)).to.deep.equal(['alpha', 'beta'])
  })

  it('answers null to someone outside the main circle and to nobody logged in', async () => {
    await knex()('group_memberships').where({ group_id: main.id, user_id: outsider.id }).update({ active: false })
    expect(await mainCircleFor(outsider.id)).to.equal(null)
    expect(await mainCircleFor(null)).to.equal(null)
  })

  it('works through GraphQL for a member and answers null when logged out', async () => {
    const ok = await gql(ann)
    expect(ok.errors).to.equal(undefined)
    expect(ok.data.agoraMainCircle.id).to.equal(String(main.id))
    expect(ok.data.agoraMainCircle.circles.length).to.be.greaterThan(0)
    const anon = await gql(null)
    expect(anon.data == null || anon.data.agoraMainCircle == null).to.equal(true)
  })

  it('follows AGORA_MAIN_GROUP_SLUG', async () => {
    process.env.AGORA_MAIN_GROUP_SLUG = 'nothing-here'
    expect(await mainCircleFor(ann.id)).to.equal(null)
    delete process.env.AGORA_MAIN_GROUP_SLUG
  })
})
