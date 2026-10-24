/* eslint-env mocha */
/**
 * Agora: the 7BP Home, the main circle (lib/agora/mainGroup.js).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/mainGroup.test.js
 */
import { ensureMainGroup, everyTenMinutesMainGroup, WELCOME_TEXT } from '../../../lib/agora/mainGroup'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))

describe('Agora main circle', () => {
  const knex = () => bookshelf.knex
  let admin, ann, bob, unconfirmed, nobody, circleA, circleB, savedEnv

  const mk = (name, extra = {}) => new User(Object.assign({ name, email: `${name.toLowerCase()}@agora.test`, active: true, email_validated: true }, extra)).save()
  const mainRow = () => knex()('groups').where('slug', '7bp').first()
  const memberIds = async groupId => (await knex()('group_memberships').where({ group_id: groupId, active: true }).select('user_id')).map(r => String(r.user_id)).sort()

  before(async () => {
    savedEnv = { admins: process.env.AGORA_ADMINS, slug: process.env.AGORA_MAIN_GROUP_SLUG, name: process.env.AGORA_MAIN_GROUP_NAME }
    delete process.env.AGORA_MAIN_GROUP_SLUG
    delete process.env.AGORA_MAIN_GROUP_NAME
    await setup.clearDb()
    admin = await mk('Admin')
    ann = await mk('Ann')
    bob = await mk('Bob')
    unconfirmed = await mk('Unconfirmed', { email_validated: false })
    nobody = await mk('Nobody')
    process.env.AGORA_ADMINS = `99999,${admin.id}`
    circleA = await Group.create(ann.id, { name: 'Circle A', slug: 'circle-a' })
    circleB = await Group.create(bob.id, { name: 'Circle B', slug: 'circle-b' })
    await circleA.addMembers([unconfirmed.id])
  })

  after(() => {
    for (const [key, value] of [['AGORA_ADMINS', savedEnv.admins], ['AGORA_MAIN_GROUP_SLUG', savedEnv.slug], ['AGORA_MAIN_GROUP_NAME', savedEnv.name]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('a dry run lists everything and saves nothing', async () => {
    const r = await ensureMainGroup({ apply: false })
    expect(r.main.create).to.equal(true)
    expect(r.main.creator.id).to.equal(String(admin.id)) // 99999 matches no account, so the next one
    expect(r.links.map(l => l.name).sort()).to.deep.equal(['Circle A', 'Circle B'])
    expect(r.joins.map(j => j.name).sort()).to.deep.equal(['Ann', 'Bob'])
    expect(r.changes).to.be.at.least(5)
    expect(await mainRow()).to.equal(undefined)
  })

  it('the cron job never makes the circle itself', async () => {
    expect(await everyTenMinutesMainGroup()).to.equal(0)
    expect(await mainRow()).to.equal(undefined)
    const r = await ensureMainGroup({ apply: true, create: false })
    expect(r.blocked).to.match(/by hand/)
    expect(await mainRow()).to.equal(undefined)
  })

  it('a: makes the circle with the right name, slug, visibility and a Hylo chat room and roles', async () => {
    const r = await ensureMainGroup({ apply: true })
    expect(r.failures).to.deep.equal([])
    const main = await mainRow()
    expect(main.name).to.equal('7BP')
    expect(main.active).to.equal(true)
    expect(Number(main.visibility)).to.equal(Group.Visibility.HIDDEN)
    expect(Number(main.accessibility)).to.equal(Group.Accessibility.RESTRICTED)
    expect(String(main.created_by_id)).to.equal(String(admin.id))
    expect(main.allow_in_public).to.not.equal(true)
    // Hylo's own path: roles and a creator who is Administrator
    expect(Boolean(await GroupRole.findSystemRole(main.id, 'Administrator'))).to.equal(true)
    expect(await GroupMembership.hasResponsibility(admin.id, main.id, Responsibility.constants.RESP_ADMINISTRATION)).to.equal(true)
  })

  it('b: every other circle becomes an active child, and the children are not changed', async () => {
    const main = await mainRow()
    const rels = await knex()('group_relationships').where({ parent_group_id: main.id }).select('child_group_id', 'active')
    expect(rels.map(r => String(r.child_group_id)).sort()).to.deep.equal([String(circleA.id), String(circleB.id)].sort())
    expect(rels.every(r => r.active)).to.equal(true)
    expect(await memberIds(circleA.id)).to.deep.equal([String(ann.id), String(unconfirmed.id)].sort())
    expect(await memberIds(circleB.id)).to.deep.equal([String(bob.id)])
    const a = await knex()('groups').where('id', circleA.id).first()
    expect(Number(a.visibility)).to.equal(Group.Visibility.PROTECTED)
  })

  it('c: confirmed members of any circle become members; others do not', async () => {
    const main = await mainRow()
    expect(await memberIds(main.id)).to.deep.equal([String(admin.id), String(ann.id), String(bob.id)].sort())
    const m = await knex()('group_memberships').where({ group_id: main.id, user_id: ann.id }).first()
    expect(m.settings.agoraMainAutoJoined).to.equal(true)
    expect(m.settings.showJoinForm).to.equal(false)
    // plain Member: no Administrator role
    expect(await GroupMembership.hasResponsibility(ann.id, main.id, Responsibility.constants.RESP_ADMINISTRATION)).to.equal(false)
  })

  it('d: the home page has welcome (with the text), stream, events, members, chat and the circles', async () => {
    const main = await mainRow()
    const views = await knex()('group_views').where('group_id', main.id).orderBy('order').select('type', 'order', 'page_content', 'linked_group_id')
    const types = views.map(v => v.type)
    for (const t of ['welcome', 'all', 'events', 'members', 'chat']) expect(types).to.include(t)
    expect(views[0].type).to.equal('welcome')
    expect(views[0].page_content).to.contain(WELCOME_TEXT)
    expect(main.home_route).to.equal('/welcome')
    const linked = views.filter(v => v.type === 'group').map(v => String(v.linked_group_id)).sort()
    expect(linked).to.deep.equal([String(circleA.id), String(circleB.id)].sort())
  })

  it('e: running again changes nothing, in a dry run and when saving', async () => {
    const dry = await ensureMainGroup({ apply: false })
    expect(dry.changes).to.equal(0)
    const before = await knex()('group_views').where('group_id', (await mainRow()).id).count()
    const again = await ensureMainGroup({ apply: true })
    expect(again.changes).to.equal(0)
    expect(again.failures).to.deep.equal([])
    expect(await knex()('group_views').where('group_id', (await mainRow()).id).count()).to.deep.equal(before)
  })

  it('later joiners and later circles are picked up, and a removed menu entry stays removed', async () => {
    const main = await mainRow()
    await circleA.addMembers([nobody.id])
    const circleC = await Group.create(nobody.id, { name: 'Circle C', slug: 'circle-c' })
    // a steward removes the menu entry of Circle B
    await knex()('group_views').where({ group_id: main.id, linked_group_id: circleB.id }).del()
    const r = await ensureMainGroup({ apply: true })
    expect(r.joins.map(j => j.name)).to.deep.equal(['Nobody'])
    expect(r.links.map(l => l.name)).to.deep.equal(['Circle C'])
    expect(await memberIds(main.id)).to.include(String(nobody.id))
    const linked = (await knex()('group_views').where({ group_id: main.id, type: 'group' }).select('linked_group_id')).map(v => String(v.linked_group_id))
    expect(linked).to.include(String(circleC.id))
    expect(linked).to.not.include(String(circleB.id))
    expect((await ensureMainGroup({ apply: true })).changes).to.equal(0)
  })

  it('someone who left the main circle is not added again', async () => {
    const main = await Group.find('7bp')
    await main.removeMembers([ann.id])
    const r = await ensureMainGroup({ apply: true })
    expect(r.joins).to.deep.equal([])
    expect(r.leftOnPurpose.map(l => l.name)).to.deep.equal(['Ann'])
    expect(await memberIds(main.id)).to.not.include(String(ann.id))
  })

  it('a relationship a steward switched off stays off', async () => {
    const main = await mainRow()
    await knex()('group_relationships').where({ parent_group_id: main.id, child_group_id: circleB.id }).update({ active: false })
    const r = await ensureMainGroup({ apply: true })
    expect(r.links).to.deep.equal([])
    expect(r.keptApart.map(k => k.name)).to.deep.equal(['Circle B'])
    const rel = await knex()('group_relationships').where({ parent_group_id: main.id, child_group_id: circleB.id }).first()
    expect(rel.active).to.equal(false)
  })

  it('a switched-off circle is not a child and its members alone do not count', async () => {
    const lone = await mk('Lone')
    const dead = await Group.create(lone.id, { name: 'Dead', slug: 'dead-circle' })
    await knex()('groups').where('id', dead.id).update({ active: false })
    const r = await ensureMainGroup({ apply: false })
    expect(r.links.map(l => l.name)).to.not.include('Dead')
    expect(r.joins.map(j => j.name)).to.not.include('Lone')
  })

  it('the cron wrapper never throws', async () => {
    expect(await everyTenMinutesMainGroup()).to.equal(0)
    const original = bookshelf.knex
    // A broken database connection must be caught
    const broken = () => { throw new Error('boom') }
    const real = Group.where
    Group.where = broken
    try {
      expect(await everyTenMinutesMainGroup()).to.equal(0)
    } finally {
      Group.where = real
      expect(bookshelf.knex).to.equal(original)
    }
  })

  it('does nothing and says why when no Agora admin can make the circle', async () => {
    await knex()('groups').where('slug', '7bp').update({ slug: 'old-7bp' })
    process.env.AGORA_ADMINS = '99999'
    const r = await ensureMainGroup({ apply: true })
    expect(r.blocked).to.match(/AGORA_ADMINS/)
    expect(await mainRow()).to.equal(undefined)
    process.env.AGORA_ADMINS = String(admin.id)
  })

  it('does not make a circle when the slug belongs to a switched-off circle', async () => {
    await knex()('groups').where('slug', 'old-7bp').update({ slug: '7bp', active: false })
    const r = await ensureMainGroup({ apply: true })
    expect(r.blocked).to.match(/switched off/)
  })
})
