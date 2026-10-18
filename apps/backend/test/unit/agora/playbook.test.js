/* eslint-env mocha */
/**
 * Agora: the playbook page of a group, through GraphQL as the web page uses it.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep. Run them with the other Agora tests, so the test
 * setup loads first:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test node node_modules/mocha/bin/mocha -r test/setup/core -r @babel/register --exit --timeout 60000 test/unit/agora/
 */
import { createRequestHandler } from '../../../api/graphql'
import Playbook from '../../../lib/agora/playbook'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const { assignAdministrator } = require(rootPath('test/setup/roleHelpers'))

const PLAYBOOK = `query ($groupSlug: String) {
  agoraPlaybook(groupSlug: $groupSlug) {
    groupId canEdit statuses
    chapters { id position title status summary link owner { id name } updatedBy { name } updatedAt }
    members { id name }
  }
}`
const CREATE = `mutation ($groupId: ID!, $data: AgoraPlaybookChapterInput!) {
  createAgoraPlaybookChapter(groupId: $groupId, data: $data) { id position title status summary link owner { id name } updatedBy { name } updatedAt }
}`
const UPDATE = `mutation ($id: ID!, $data: AgoraPlaybookChapterInput!) {
  updateAgoraPlaybookChapter(id: $id, data: $data) { id position title status summary link owner { id name } updatedAt }
}`
const DELETE = 'mutation ($id: ID!) { deleteAgoraPlaybookChapter(id: $id) { success } }'

describe('Agora playbook', () => {
  let handler, steward, member, outsider, group, otherGroup

  async function gql (document, variables, user) {
    const req = factories.mock.request()
    req.url = '/noo/graphql'
    req.method = 'POST'
    req.headers = { 'Content-Type': 'application/json' }
    req.session = user ? { userId: user.id, destroy: () => {} } : {}
    const { executionResult } = await handler.inject({ document, variables, serverContext: { req, res: factories.mock.response() } })
    return executionResult
  }

  const errorOf = result => result.errors && result.errors[0] && result.errors[0].message

  before(async () => {
    await setup.clearDb()
    handler = createRequestHandler()
    steward = await new User({ name: 'Demo Steward', email: 'steward@agora.test', active: true }).save()
    member = await new User({ name: 'Amara', email: 'amara@agora.test', active: true }).save()
    outsider = await new User({ name: 'Kenji', email: 'kenji@agora.test', active: true }).save()
    group = await new Group({ slug: '7bp', name: '7 Billion Presidents', active: true }).save()
    otherGroup = await new Group({ slug: 'care', name: 'Care', active: true }).save()
    await assignAdministrator(steward, group)
    await member.joinGroup(group)
    await outsider.joinGroup(otherGroup)
  })

  describe('who sees what', () => {
    it('gives a steward an empty playbook that they may edit, with the members to choose an owner from', async () => {
      const result = await gql(PLAYBOOK, { groupSlug: '7bp' }, steward)
      expect(result.errors).to.equal(undefined)
      const playbook = result.data.agoraPlaybook
      expect(playbook.canEdit).to.equal(true)
      expect(playbook.chapters).to.deep.equal([])
      expect(playbook.statuses).to.deep.equal(['not_started', 'draft', 'in_review', 'agreed'])
      expect(playbook.members.map(m => m.name)).to.include.members(['Demo Steward', 'Amara'])
    })

    it('lets a member read but not edit, and does not hand them the member list', async () => {
      const playbook = (await gql(PLAYBOOK, { groupSlug: '7bp' }, member)).data.agoraPlaybook
      expect(playbook.canEdit).to.equal(false)
      expect(playbook.members).to.deep.equal([])
    })

    it('gives someone outside the group nothing', async () => {
      const result = await gql(PLAYBOOK, { groupSlug: '7bp' }, outsider)
      expect(result.errors).to.equal(undefined)
      expect(result.data.agoraPlaybook).to.equal(null)
    })

    it('gives someone who is not logged in nothing', async () => {
      const result = await gql(PLAYBOOK, { groupSlug: '7bp' }, null)
      expect(result.data && result.data.agoraPlaybook).to.equal(null)
    })
  })

  describe('changing chapters', () => {
    let onboarding

    it('lets a steward add a chapter, with an owner, status, text and link', async () => {
      const result = await gql(CREATE, {
        groupId: group.id,
        data: { title: 'Onboarding', status: 'draft', summary: 'How someone joins 7BP.', link: 'docs.google.com/document/d/made-up', ownerId: member.id }
      }, steward)
      expect(result.errors).to.equal(undefined)
      onboarding = result.data.createAgoraPlaybookChapter
      expect(onboarding).to.include({ title: 'Onboarding', status: 'draft', summary: 'How someone joins 7BP.', position: 1 })
      expect(onboarding.link).to.equal('https://docs.google.com/document/d/made-up')
      expect(onboarding.owner).to.deep.equal({ id: String(member.id), name: 'Amara' })
      expect(onboarding.updatedBy.name).to.equal('Demo Steward')
      expect(new Date(onboarding.updatedAt).getTime()).to.be.closeTo(Date.now(), 60000)
    })

    it('lists chapters by their order, a new chapter goes last', async () => {
      await gql(CREATE, { groupId: group.id, data: { title: 'Governance', status: 'agreed' } }, steward)
      await gql(CREATE, { groupId: group.id, data: { title: 'Tech', position: 0 } }, steward)
      const chapters = (await gql(PLAYBOOK, { groupSlug: '7bp' }, member)).data.agoraPlaybook.chapters
      expect(chapters.map(c => c.title)).to.deep.equal(['Tech', 'Onboarding', 'Governance'])
      expect(chapters.map(c => c.position)).to.deep.equal([0, 1, 2])
      expect(chapters[0].status).to.equal('not_started')
    })

    it('lets a steward change a chapter; what is left out stays as it was', async () => {
      const before = (await AgoraPlaybookChapter.where({ id: onboarding.id }).fetch()).get('updated_at')
      await new Promise(resolve => setTimeout(resolve, 20))
      const result = await gql(UPDATE, { id: onboarding.id, data: { status: 'in_review', position: 5 } }, steward)
      expect(result.errors).to.equal(undefined)
      const changed = result.data.updateAgoraPlaybookChapter
      expect(changed).to.include({ title: 'Onboarding', status: 'in_review', position: 5, summary: 'How someone joins 7BP.' })
      expect(changed.owner.name).to.equal('Amara')
      expect(new Date(changed.updatedAt).getTime()).to.be.above(new Date(before).getTime())
    })

    it('keeps the status when an update sends status null or empty', async () => {
      for (const status of [null, '']) {
        const changed = (await gql(UPDATE, { id: onboarding.id, data: { status } }, steward)).data.updateAgoraPlaybookChapter
        expect(changed.status).to.equal('in_review')
      }
      const fresh = (await gql(CREATE, { groupId: group.id, data: { title: 'Empty status', status: '' } }, steward)).data.createAgoraPlaybookChapter
      expect(fresh.status).to.equal('not_started')
      await gql(DELETE, { id: fresh.id }, steward)
    })

    it('stores a link as a tidy web address', async () => {
      const changed = (await gql(UPDATE, { id: onboarding.id, data: { link: '//made-up.example/doc' } }, steward)).data.updateAgoraPlaybookChapter
      expect(changed.link).to.equal('https://made-up.example/doc')
    })

    it('lets a steward clear the owner, the text and the link', async () => {
      const changed = (await gql(UPDATE, { id: onboarding.id, data: { ownerId: null, summary: '', link: '' } }, steward)).data.updateAgoraPlaybookChapter
      expect(changed.owner).to.equal(null)
      expect(changed.summary).to.equal(null)
      expect(changed.link).to.equal(null)
    })

    it('keeps members from adding, changing or removing chapters', async () => {
      const add = await gql(CREATE, { groupId: group.id, data: { title: 'Fundraising' } }, member)
      expect(errorOf(add)).to.equal('Only stewards of this group can change the playbook.')
      const change = await gql(UPDATE, { id: onboarding.id, data: { status: 'agreed' } }, member)
      expect(errorOf(change)).to.equal('Only stewards of this group can change the playbook.')
      const remove = await gql(DELETE, { id: onboarding.id }, member)
      expect(errorOf(remove)).to.equal('Only stewards of this group can change the playbook.')
      const row = await AgoraPlaybookChapter.where({ id: onboarding.id }).fetch()
      expect(row.get('status')).to.equal('in_review')
    })

    it('tells someone outside the group only that the chapter does not exist', async () => {
      const change = await gql(UPDATE, { id: onboarding.id, data: { title: 'Taken over' } }, outsider)
      expect(errorOf(change)).to.equal('This chapter does not exist.')
      const add = await gql(CREATE, { groupId: group.id, data: { title: 'Taken over' } }, outsider)
      expect(errorOf(add)).to.equal('Only stewards of this group can change the playbook.')
    })

    it('says what is wrong with a chapter that cannot be saved', async () => {
      const cases = [
        [{ title: '' }, 'A title is needed.'],
        [{ title: 'x'.repeat(201) }, 'A title is too long (at most 200 characters).'],
        [{ title: 'Events', status: 'finished' }, 'That status does not exist.'],
        [{ title: 'Events', link: 'javascript:alert(1)' }, 'The link must be a web address that starts with https://'],
        [{ title: 'Events', ownerId: outsider.id }, 'The owner must be a member of this group.'],
        [{ title: 'Events', position: -1 }, 'The order must be a whole number from 0 to 9999.'],
        [{ title: 'Events', link: 'https://made-up.example/' + 'a b'.repeat(325) }, 'The link is too long (at most 1000 characters).']
      ]
      for (const [data, message] of cases) {
        expect(errorOf(await gql(CREATE, { groupId: group.id, data }, steward))).to.equal(message)
      }
    })

    it('lets a steward remove a chapter', async () => {
      const result = await gql(DELETE, { id: onboarding.id }, steward)
      expect(result.data.deleteAgoraPlaybookChapter.success).to.equal(true)
      expect(await AgoraPlaybookChapter.where({ id: onboarding.id }).fetch()).to.equal(null)
      const again = await gql(DELETE, { id: onboarding.id }, steward)
      expect(errorOf(again)).to.equal('This chapter does not exist.')
    })

    it('lets a steward of the main group run the playbook of a space they did not join; its members only read', async () => {
      const space = await new Group({ slug: '7bp-space', name: 'A space', type: 'space', parent_id: group.id, active: true }).save()
      await member.joinGroup(space)
      expect(await GroupMembership.hasActiveMembership(steward.id, space.id)).to.equal(false)

      const created = await gql(CREATE, { groupId: space.id, data: { title: 'Space chapter', ownerId: member.id } }, steward)
      expect(created.errors).to.equal(undefined)
      const id = created.data.createAgoraPlaybookChapter.id

      const read = (await gql(PLAYBOOK, { groupSlug: '7bp-space' }, steward)).data.agoraPlaybook
      expect(read.canEdit).to.equal(true)
      expect(read.chapters.map(c => c.title)).to.deep.equal(['Space chapter'])
      expect(read.members.map(m => m.name)).to.deep.equal(['Amara'])

      const updated = await gql(UPDATE, { id, data: { status: 'agreed' } }, steward)
      expect(updated.errors).to.equal(undefined)
      expect(updated.data.updateAgoraPlaybookChapter.status).to.equal('agreed')

      const asMember = (await gql(PLAYBOOK, { groupSlug: '7bp-space' }, member)).data.agoraPlaybook
      expect(asMember.canEdit).to.equal(false)
      expect(asMember.chapters.length).to.equal(1)
      expect(errorOf(await gql(UPDATE, { id, data: { status: 'draft' } }, member))).to.equal('Only stewards of this group can change the playbook.')

      const removed = await gql(DELETE, { id }, steward)
      expect(removed.data.deleteAgoraPlaybookChapter.success).to.equal(true)
    })

    it('keeps each group to its own playbook', async () => {
      const care = await Playbook.playbook(outsider.id, { groupSlug: 'care' })
      expect(care.chapters).to.deep.equal([])
      expect(care.canEdit).to.equal(false)
    })
  })
})
