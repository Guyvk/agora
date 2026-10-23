/* eslint-env mocha */
/**
 * Agora: Agora admins are Administrator in every circle and space
 * (lib/agora/adminsEverywhere.js, scripts/agora-admins-everywhere.js).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/adminsEverywhere.test.js
 */
import { ensureStewardResponsibilities } from '../../../lib/agora/stewardRoles'
import { addAgoraAdminsEverywhere, addAgoraAdminsToGroup, resolveAgoraAdmins } from '../../../lib/agora/adminsEverywhere'
import { createSpace } from '../../../api/graphql/mutations/spaces'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))

describe('Agora admins everywhere', () => {
  let saved, guy, boss, maker, member, outsider, sleeping, unconfirmed
  const knex = () => bookshelf.knex

  const isAdministrator = (user, groupId) =>
    GroupMembership.hasResponsibility(user.id, groupId, Responsibility.constants.RESP_ADMINISTRATION)
  const isMember = async (user, groupId) =>
    Boolean(await knex()('group_memberships').where({ user_id: user.id, group_id: groupId, active: true }).first())
  // Everything about roles and memberships, to see that a run changed nothing
  const snapshot = async () => ({
    memberships: await knex()('group_memberships').orderBy('id').select('id', 'user_id', 'group_id', 'active'),
    roles: await knex()('group_memberships_group_roles').orderBy('id').select('id', 'user_id', 'group_id', 'group_role_id')
  })
  const withoutAdmins = async fn => {
    const value = process.env.AGORA_ADMINS
    process.env.AGORA_ADMINS = ''
    try { return await fn() } finally { process.env.AGORA_ADMINS = value }
  }

  before(async () => {
    saved = process.env.AGORA_ADMINS
    await setup.clearDb()
    await ensureStewardResponsibilities(knex())
    const user = attrs => new User({ active: true, email_validated: true, created_at: new Date(), ...attrs }).save()
    guy = await user({ name: 'Guy', email: 'guy@agora.test' })
    boss = await user({ name: 'Boss', email: 'Boss@Agora.test' })
    maker = await user({ name: 'Maker', email: 'maker@agora.test' })
    member = await user({ name: 'Member', email: 'member@agora.test' })
    outsider = await user({ name: 'Outsider', email: 'outsider@agora.test' })
    sleeping = await user({ name: 'Gone', email: 'gone@agora.test', active: false })
    unconfirmed = await user({ name: 'Not confirmed', email: 'unconfirmed@agora.test', email_validated: false })
    // An id, a confirmed address (other capitals), an unknown id, a deactivated
    // account, an unconfirmed address and nonsense
    process.env.AGORA_ADMINS = `${guy.id}, boss@agora.test, 99999999, ${sleeping.id}, unconfirmed@agora.test, nonsense`
  })

  after(() => { process.env.AGORA_ADMINS = saved })

  it('finds the active admins and skips the entries that match no active account', async () => {
    const { ids, skipped } = await resolveAgoraAdmins()
    expect(ids.sort()).to.deep.equal([String(guy.id), String(boss.id)].sort())
    expect(skipped).to.deep.equal(['99999999', String(sleeping.id), 'unconfirmed@agora.test', 'nonsense'])
  })

  it('makes the admins members and Administrator of a new circle, and leaves everyone else alone', async () => {
    const circle = await Group.create(maker.id, { name: 'Media', slug: 'media' })
    for (const admin of [guy, boss]) {
      expect(await isMember(admin, circle.id)).to.equal(true)
      expect(await isAdministrator(admin, circle.id)).to.equal(true)
    }
    // The maker keeps their own role, as in Hylo
    expect(await isAdministrator(maker, circle.id)).to.equal(true)
    // Unknown, deactivated and unconfirmed entries were skipped without trouble
    for (const other of [sleeping, unconfirmed, outsider]) {
      expect(await isMember(other, circle.id)).to.equal(false)
      expect(await isAdministrator(other, circle.id)).to.equal(false)
    }
    const members = await knex()('group_memberships').where({ group_id: circle.id, active: true }).pluck('user_id')
    expect(members.map(String).sort()).to.deep.equal([guy.id, boss.id, maker.id].map(String).sort())
  })

  it('joins quietly: no join form, nobody told "X joined", only important notices for the admin', async () => {
    const circle = await Group.create(maker.id, { name: 'Quiet', slug: 'quiet' })
    const membership = await GroupMembership.forPair(guy.id, circle.id).fetch()
    expect(membership.getSetting('showJoinForm')).to.equal(false)
    expect(Boolean(membership.getSetting('agreementsAcceptedAt'))).to.equal(true)
    expect(membership.getSetting('postNotifications')).to.equal('important')
    expect(membership.getSetting('digestFrequency')).to.equal('weekly')
    // Nothing for the stewards (Hylo's "memberJoinedGroup" is an activity by the one who joined)
    const joined = await knex()('activities').where({ group_id: circle.id }).whereIn('actor_id', [guy.id, boss.id]).count('* as n').first()
    expect(Number(joined.n)).to.equal(0)
  })

  it('still makes the circle when no admin matches an account', async () => {
    const value = process.env.AGORA_ADMINS
    process.env.AGORA_ADMINS = '99999999, nobody@agora.test'
    try {
      const circle = await Group.create(maker.id, { name: 'Lonely', slug: 'lonely' })
      expect(Boolean(circle.id)).to.equal(true)
      expect(await isAdministrator(maker, circle.id)).to.equal(true)
      const members = await knex()('group_memberships').where({ group_id: circle.id }).pluck('user_id')
      expect(members.map(String)).to.deep.equal([String(maker.id)])
      // Out of the way of the command tests below
      await circle.save({ active: false }, { patch: true })
    } finally {
      process.env.AGORA_ADMINS = value
    }
  })

  it('makes the admins members of a new space, and Administrator of the circle it sits in', async () => {
    // A circle from before this rule: the admins are not in it yet
    const circle = await withoutAdmins(() => Group.create(maker.id, { name: 'Projects', slug: 'projects' }))
    expect(await isMember(guy, circle.id)).to.equal(false)

    const space = await createSpace(maker.id, { parentGroupId: circle.id, name: 'Garden' }, {})
    for (const admin of [guy, boss]) {
      expect(await isMember(admin, space.id)).to.equal(true)
      expect(await isMember(admin, circle.id)).to.equal(true)
      expect(await isAdministrator(admin, circle.id)).to.equal(true)
      // A space uses the roles of its circle
      expect(await isAdministrator(admin, space.id)).to.equal(true)
    }
    expect(await isMember(maker, space.id)).to.equal(true)
    expect(await isMember(outsider, space.id)).to.equal(false)
    expect(await isAdministrator(outsider, space.id)).to.equal(false)
  })

  describe('the command for circles and spaces that already exist', () => {
    let old, oldSpace, before

    it('changes nothing in a dry run, but says what it would do', async () => {
      await withoutAdmins(async () => {
        old = await Group.create(maker.id, { name: 'Old circle', slug: 'old-circle' })
        await old.addMembers([member.id])
        oldSpace = await createSpace(maker.id, { parentGroupId: old.id, name: 'Old space' }, {})
      })
      // An admin who is already a member, but without the role
      await old.addMembers([boss.id])
      // A circle that is no longer active is left alone
      const gone = await withoutAdmins(() => Group.create(maker.id, { name: 'Gone', slug: 'gone-circle' }))
      await gone.save({ active: false }, { patch: true })

      before = await snapshot()
      const { changes } = await addAgoraAdminsEverywhere()
      expect(await snapshot()).to.deep.equal(before)

      const forOld = changes.filter(c => c.groupId === String(old.id)).map(c => `${c.userId}:${c.change}`).sort()
      expect(forOld).to.deep.equal([`${guy.id}:join`, `${guy.id}:administrator`, `${boss.id}:administrator`].sort())
      const forSpace = changes.filter(c => c.groupId === String(oldSpace.id)).map(c => `${c.userId}:${c.change}`).sort()
      expect(forSpace).to.deep.equal([`${guy.id}:join`, `${boss.id}:join`].sort())
      expect(changes.some(c => c.groupId === String(gone.id))).to.equal(false)
      // Circles made after the rule need nothing
      expect(changes.every(c => [String(old.id), String(oldSpace.id)].includes(c.groupId))).to.equal(true)
    })

    it('adds the missing memberships and roles with --apply', async () => {
      const { changes } = await addAgoraAdminsEverywhere({ apply: true })
      expect(changes.length).to.equal(5)
      for (const admin of [guy, boss]) {
        expect(await isMember(admin, old.id)).to.equal(true)
        expect(await isAdministrator(admin, old.id)).to.equal(true)
        expect(await isMember(admin, oldSpace.id)).to.equal(true)
      }
      // Non-admins unaffected
      expect(await isAdministrator(member, old.id)).to.equal(false)
      expect(await isMember(outsider, old.id)).to.equal(false)
      const now = await snapshot()
      const othersBefore = before.memberships.filter(m => ![guy.id, boss.id].map(String).includes(String(m.user_id)))
      const othersNow = now.memberships.filter(m => ![guy.id, boss.id].map(String).includes(String(m.user_id)))
      expect(othersNow).to.deep.equal(othersBefore)
      expect(now.roles.filter(r => ![guy.id, boss.id].map(String).includes(String(r.user_id))))
        .to.deep.equal(before.roles.filter(r => ![guy.id, boss.id].map(String).includes(String(r.user_id))))
    })

    it('finds nothing to do the second time', async () => {
      const again = await snapshot()
      const { changes } = await addAgoraAdminsEverywhere({ apply: true })
      expect(changes).to.deep.equal([])
      expect(await snapshot()).to.deep.equal(again)
    })

    it('leaves an admin out of a circle they left, unless asked to bring them back', async () => {
      await old.removeMembers([guy.id])
      expect(await isAdministrator(guy, old.id)).to.equal(false)
      expect((await addAgoraAdminsEverywhere({ apply: true })).changes).to.deep.equal([])
      expect(await isMember(guy, old.id)).to.equal(false)

      const { changes } = await addAgoraAdminsEverywhere({ apply: true, rejoin: true })
      expect(changes.map(c => `${c.groupId}:${c.change}`).sort())
        .to.deep.equal([`${old.id}:rejoin`, `${old.id}:administrator`, `${oldSpace.id}:rejoin`].sort())
      expect(await isMember(guy, old.id)).to.equal(true)
      expect(await isMember(guy, oldSpace.id)).to.equal(true)
      expect(await isAdministrator(guy, old.id)).to.equal(true)
    })

    it('gives the role back when a steward took it away from an admin who is still a member', async () => {
      await GroupMembership.removeAdministratorRole(boss.id, old.id)
      expect(await isAdministrator(boss, old.id)).to.equal(false)
      const changes = await addAgoraAdminsToGroup(old.id, { apply: true })
      expect(changes).to.deep.equal([{ userId: String(boss.id), groupId: String(old.id), change: 'administrator' }])
      expect(await isAdministrator(boss, old.id)).to.equal(true)
    })
  })
})
