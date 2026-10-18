/* eslint-env mocha */
/**
 * Agora: stewards may invite people, also on a database made from schema.sql
 * (lib/agora/stewardRoles.js).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/stewardRoles.test.js
 */
import { ensureStewardResponsibilities, repairCircleRoles } from '../../../lib/agora/stewardRoles'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))

describe('Agora steward roles', () => {
  const knex = () => bookshelf.knex
  const mayInvite = (user, group) =>
    GroupMembership.hasResponsibility(user.id, group.id, Responsibility.constants.RESP_ADD_MEMBERS)

  // A database made from schema.sql: the responsibilities table is empty
  async function emptyResponsibilities () {
    await knex()('group_roles_responsibilities').del()
    await knex()('responsibilities').del()
  }

  before(() => setup.clearDb())

  after(async () => {
    // Leave the four rows in place for other tests
    await ensureStewardResponsibilities(knex())
  })

  it('adds the four responsibilities when they are missing, and only once', async () => {
    await emptyResponsibilities()
    expect(await ensureStewardResponsibilities(knex())).to.deep.equal(['Administration', 'Add Members', 'Remove Members', 'Manage Content'])
    expect(await ensureStewardResponsibilities(knex())).to.deep.equal([])
    const titles = (await knex()('responsibilities').where({ type: 'system' }).select('title')).map(r => r.title).sort()
    expect(titles).to.deep.equal(['Add Members', 'Administration', 'Manage Content', 'Remove Members'])
  })

  it('lets the maker of a circle invite when the rows were there first', async () => {
    await ensureStewardResponsibilities(knex())
    const maker = await new User({ name: 'Maker', email: 'maker@agora.test', active: true }).save()
    const circle = await Group.create(maker.id, { name: 'After', slug: 'after-rows' })
    expect(await mayInvite(maker, circle)).to.equal(true)
  })

  it('repairs a circle made while the rows were missing', async () => {
    await emptyResponsibilities()
    const early = await new User({ name: 'Early', email: 'early@agora.test', active: true }).save()
    const circle = await Group.create(early.id, { name: 'Before', slug: 'before-rows' })
    await ensureStewardResponsibilities(knex())
    // The rows alone do not help a circle made before them
    expect(await mayInvite(early, circle)).to.equal(false)

    const checked = await repairCircleRoles()
    expect(checked).to.be.at.least(1)
    expect(await mayInvite(early, circle)).to.equal(true)

    // Safe to run again: no double links
    const before = await knex()('group_roles_responsibilities').count('* as n').first()
    await repairCircleRoles()
    const after = await knex()('group_roles_responsibilities').count('* as n').first()
    expect(Number(after.n)).to.equal(Number(before.n))
  })
})
