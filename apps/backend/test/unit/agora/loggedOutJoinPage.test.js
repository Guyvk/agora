/* eslint-env mocha */
/**
 * Agora: nothing is visible without logging in. Someone who is logged out and opens a
 * circle's join link gets the name of the circle and nothing else
 * (api/graphql/makeSchema.js, makePublicQueries).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test node node_modules/mocha/bin/mocha \
 *     -r test/setup/core -r @babel/register --exit --timeout 60000 test/unit/agora/loggedOutJoinPage.test.js
 */
const { graphql } = require('graphql')
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

describe('Agora: what a logged-out person can read', () => {
  let circle, member

  async function ask (query) {
    const makeSchema = require('../../../api/graphql/makeSchema').default
    const schema = await makeSchema({ req: { session: {} } })
    return graphql({ schema, source: query, contextValue: { req: { session: {} } } })
  }

  before(async () => {
    await setup.clearDb()
    member = await factories.user({ email: 'member@agora.test' }).save()
    circle = await factories.group({
      name: 'Governance',
      slug: 'governance',
      access_code: 'join-governance',
      description: 'A secret description of the circle',
      purpose: 'A secret purpose',
      visibility: Group.Visibility.PUBLIC,
      accessibility: Group.Accessibility.OPEN
    }).save()
    await member.joinGroup(circle)
    const post = await factories.post({ user_id: member.id, type: 'discussion', name: 'A secret post' }).save()
    await circle.posts().attach(post.id)
  })

  it('gives only the name and address of the circle of a valid join link', async () => {
    const result = await ask('{ group(slug: "governance", accessCode: "join-governance") { id name slug description purpose } }')
    expect(result.errors).to.equal(undefined)
    expect(result.data.group.name).to.equal('Governance')
    expect(result.data.group.slug).to.equal('governance')
    expect(result.data.group.description).to.equal(null)
    expect(result.data.group.purpose).to.equal(null)
  })

  it('gives no members, posts or count of the circle of a valid join link', async () => {
    const result = await ask('{ group(slug: "governance", accessCode: "join-governance") { name memberCount postCount members { items { id name } } posts { items { id title } } } }')
    const group = result.data?.group
    // Either the fields are empty, or a field the page cannot read is refused: never any content
    const text = JSON.stringify(result)
    expect(text).to.not.contain('A secret post')
    expect(text).to.not.contain('member@agora.test')
    expect(text).to.not.contain(member.get('name'))
    if (group) {
      expect(group.memberCount).to.not.equal(1)
      expect(group.postCount).to.not.equal(1)
    }
  })

  it('gives nothing about a circle without a valid link, even a public one', async () => {
    const result = await ask('{ group(slug: "governance") { id name description } }')
    expect(result.data.group).to.equal(null)
  })

  it('gives nothing with a link of another circle', async () => {
    await factories.group({ name: 'Other', slug: 'other', access_code: 'join-other' }).save()
    const result = await ask('{ group(slug: "governance", accessCode: "join-other") { id name } }')
    expect(result.data.group).to.equal(null)
  })

  it('lists no circles, posts or people', async () => {
    const result = await ask(`{
      groups { total items { id name } }
      posts { total items { id } }
      post(id: "1") { id }
      person(id: "${member.id}") { id name }
    }`)
    expect(result.errors).to.equal(undefined)
    expect(result.data.groups.items).to.deep.equal([])
    expect(result.data.posts.items).to.deep.equal([])
    expect(result.data.post).to.equal(null)
    expect(result.data.person).to.equal(null)
  })

  it('tells only what is needed to sign up about a valid join link', async () => {
    const result = await ask('{ checkInvitation(accessCode: "join-governance") { valid groupName groupSlug } }')
    expect(result.errors).to.equal(undefined)
    expect(result.data.checkInvitation).to.deep.equal({ valid: true, groupName: 'Governance', groupSlug: 'governance' })
  })

  describe('circle profiles (Murmurations)', () => {
    it('are only for people who are logged in', () => {
      // Sails rewrites the loaded policies while the server runs, so read the file itself
      const text = require('fs').readFileSync(rootPath('config/policies.js'), 'utf8')
      expect(text).to.match(/MurmurationsController: \{\s*group: 'sessionAuth'\s*\}/)
    })

    it('answer an unknown circle with not found, not an error', async () => {
      const MurmurationsController = require(rootPath('api/controllers/MurmurationsController'))
      const req = factories.mock.request()
      req.params = { groupSlug: 'no-such-circle' }
      const res = factories.mock.response()
      res.notFound = spy()
      await MurmurationsController.group(req, res)
      expect(res.notFound).to.have.been.called()
    })
  })
})
