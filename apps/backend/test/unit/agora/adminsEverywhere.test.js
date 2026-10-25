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
import { addAgoraAdminsEverywhere, addAgoraAdminsToGroup, hourlyAgoraAdminsEverywhere, removeAgoraAdminFromEverywhere, resolveAgoraAdmins } from '../../../lib/agora/adminsEverywhere'
import { isAgoraAdmin, isHelpDeskAdmin } from '../../../lib/agora/admins'
import { createSpace } from '../../../api/graphql/mutations/spaces'
import { groupFilter } from '../../../api/graphql/filters'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

describe('Agora admins everywhere', () => {
  let saved, guy, boss, maker, member, outsider, sleeping, unconfirmed, emailOnly
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
  // Runs fn and returns what it logged as warnings
  const warnings = async fn => {
    const logged = []
    const warn = sails.log.warn
    sails.log.warn = message => logged.push(message)
    try { await fn() } finally { sails.log.warn = warn }
    return logged
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
    emailOnly = await user({ name: 'Listed by email', email: 'listed@agora.test' })
    // Two ids, an unknown id, a deactivated account, and entries that are not
    // ids: email addresses (also of a confirmed account, in other capitals) and nonsense
    process.env.AGORA_ADMINS = `${guy.id}, ${boss.id}, 99999999, ${sleeping.id}, Listed@Agora.test, unconfirmed@agora.test, nonsense`
  })

  after(() => {
    if (saved === undefined) delete process.env.AGORA_ADMINS
    else process.env.AGORA_ADMINS = saved
  })

  it('finds the active admins and skips the ids that match no active account', async () => {
    const { ids, skipped } = await resolveAgoraAdmins()
    expect(ids.sort()).to.deep.equal([String(guy.id), String(boss.id)].sort())
    expect(skipped).to.deep.equal(['99999999', String(sleeping.id)])
  })

  it('ignores email addresses, with a warning in the log, and grants them nothing', async () => {
    const value = process.env.AGORA_ADMINS
    process.env.AGORA_ADMINS = `${guy.id}, fresh-entry@agora.test`
    try {
      const logged = await warnings(() => resolveAgoraAdmins())
      expect(logged).to.have.length(1)
      expect(logged[0]).to.equal('Agora: AGORA_ADMINS entry "fresh-entry@agora.test" ignored: use the account\'s number')
    } finally {
      process.env.AGORA_ADMINS = value
    }
    // Even an address of a confirmed, active account counts for nothing
    const { ids } = await resolveAgoraAdmins()
    expect(ids).to.not.include(String(emailOnly.id))
    expect(await isAgoraAdmin(emailOnly.id)).to.equal(false)
    expect(await isHelpDeskAdmin(emailOnly.id)).to.equal(false)
    const circle = await Group.create(maker.id, { name: 'Emails', slug: 'emails' })
    expect(await isMember(emailOnly, circle.id)).to.equal(false)
    expect(await isAdministrator(emailOnly, circle.id)).to.equal(false)
    // Ids still work, for both features
    expect(await isAgoraAdmin(guy.id)).to.equal(true)
    expect(await isHelpDeskAdmin(guy.id)).to.equal(true)
    expect(await isAgoraAdmin(outsider.id)).to.equal(false)
    await circle.save({ active: false }, { patch: true })
  })

  it('gives nothing to a person who changes their email address to a listed one', async () => {
    const climber = await new User({ name: 'Climber', email: 'climber@agora.test', active: true, email_validated: true, created_at: new Date() }).save()
    const value = process.env.AGORA_ADMINS
    process.env.AGORA_ADMINS = `${guy.id}, newadmin@agora.test`
    try {
      // What Hylo allows: the address changes and email_validated stays true
      await knex()('users').where({ id: climber.id }).update({ email: 'newadmin@agora.test' })
      expect(await isAgoraAdmin(climber.id)).to.equal(false)
      expect(await isHelpDeskAdmin(climber.id)).to.equal(false)
      const circle = await Group.create(maker.id, { name: 'Climbing', slug: 'climbing' })
      expect(await isMember(climber, circle.id)).to.equal(false)
      expect(await isAdministrator(climber, circle.id)).to.equal(false)
      const { changes } = await addAgoraAdminsEverywhere({ apply: true })
      expect(changes.some(c => c.userId === String(climber.id))).to.equal(false)
      expect(await isMember(climber, circle.id)).to.equal(false)
      await circle.save({ active: false }, { patch: true })
    } finally {
      process.env.AGORA_ADMINS = value
    }
  })

  it('makes the admins members and Administrator of a new circle, and leaves everyone else alone', async () => {
    const circle = await Group.create(maker.id, { name: 'Media', slug: 'media' })
    for (const admin of [guy, boss]) {
      expect(await isMember(admin, circle.id)).to.equal(true)
      expect(await isAdministrator(admin, circle.id)).to.equal(true)
    }
    // The maker keeps their own role, as in Hylo
    expect(await isAdministrator(maker, circle.id)).to.equal(true)
    // Unknown ids, deactivated accounts and email entries were skipped without trouble
    for (const other of [sleeping, unconfirmed, emailOnly, outsider]) {
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

  it('lets the admins see everything in a hidden circle and a hidden, paywalled space', async () => {
    const circle = await Group.create(maker.id, { name: 'Secret', slug: 'secret', visibility: Group.Visibility.HIDDEN })
    const space = await createSpace(maker.id, { parentGroupId: circle.id, name: 'Paid', paywall: true, visibility: Group.Visibility.HIDDEN }, {})
    const post = await factories.post({ user_id: maker.id }).save()
    await knex()('groups_posts').insert({ group_id: space.id, post_id: post.id })
    const paid = await Group.find(space.id)

    expect(await Post.isVisibleToUser(post.id, guy.id)).to.equal(true)
    expect(await paid.canAccess(guy.id)).to.equal(true)
    const visibleIds = (await groupFilter(guy.id)(Group.collection()).fetch()).pluck('id').map(String)
    expect(visibleIds).to.include.members([String(circle.id), String(space.id)])

    expect(await Post.isVisibleToUser(post.id, outsider.id)).to.equal(false)
    expect(await paid.canAccess(outsider.id)).to.equal(false)
    const outsiderIds = (await groupFilter(outsider.id)(Group.collection()).fetch()).pluck('id').map(String)
    expect(outsiderIds).to.not.include(String(space.id))
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

    it('brings an admin who left or was removed back in the hourly run, and says so in the log', async () => {
      await old.removeMembers([guy.id])
      expect(await isAdministrator(guy, old.id)).to.equal(false)
      expect(await isMember(guy, oldSpace.id)).to.equal(false)
      // Leaving only a space counts too
      await oldSpace.removeMembers([boss.id])
      expect(await isMember(boss, oldSpace.id)).to.equal(false)

      const logged = []
      const info = sails.log.info
      sails.log.info = message => logged.push(message)
      let count
      try {
        count = await hourlyAgoraAdminsEverywhere()
      } finally {
        sails.log.info = info
      }
      expect(count).to.equal(4)
      expect(await isMember(guy, old.id)).to.equal(true)
      expect(await isAdministrator(guy, old.id)).to.equal(true)
      expect(await isMember(guy, oldSpace.id)).to.equal(true)
      expect(await isMember(boss, oldSpace.id)).to.equal(true)
      const back = logged.filter(m => m.includes('brought Agora admin'))
      expect(back).to.have.length(3)
      expect(back.some(m => m.includes(`admin ${guy.id} back into group ${old.id}`))).to.equal(true)
      expect(back.some(m => m.includes(`admin ${boss.id} back into group ${oldSpace.id}`))).to.equal(true)
      // And quiet again
      expect((await addAgoraAdminsEverywhere({ apply: true })).changes).to.deep.equal([])
    })

    it('gives the role back when a steward took it away from an admin who is still a member', async () => {
      await GroupMembership.removeAdministratorRole(boss.id, old.id)
      expect(await isAdministrator(boss, old.id)).to.equal(false)
      const changes = await addAgoraAdminsToGroup(old.id, { apply: true })
      expect(changes).to.deep.equal([{ userId: String(boss.id), groupId: String(old.id), change: 'administrator' }])
      expect(await isAdministrator(boss, old.id)).to.equal(true)
    })
  })

  describe('one broken group', () => {
    it('is logged and listed, and the other groups are still updated', async () => {
      const [broken, fine] = await withoutAdmins(async () => [
        await Group.create(maker.id, { name: 'Broken', slug: 'broken' }),
        await Group.create(maker.id, { name: 'Fine', slug: 'fine' })
      ])
      const find = Group.find
      Group.find = function (idOrSlug, ...rest) {
        if (String(idOrSlug) === String(broken.id)) return Promise.reject(new Error('disk on fire'))
        return find.call(this, idOrSlug, ...rest)
      }
      const errors = []
      const error = sails.log.error
      sails.log.error = message => errors.push(message)
      let result
      try {
        result = await addAgoraAdminsEverywhere({ apply: true })
      } finally {
        Group.find = find
        sails.log.error = error
      }
      expect(result.failures).to.deep.equal([{ groupId: String(broken.id), message: 'disk on fire' }])
      expect(errors).to.deep.equal([`Agora: could not update group ${broken.id}: disk on fire`])
      expect(await isMember(guy, broken.id)).to.equal(false)
      expect(await isAdministrator(guy, fine.id)).to.equal(true)
      expect(await isAdministrator(boss, fine.id)).to.equal(true)
      // The next run, without the problem, finishes the job
      const again = await addAgoraAdminsEverywhere({ apply: true })
      expect(again.failures).to.deep.equal([])
      expect(await isAdministrator(guy, broken.id)).to.equal(true)
      await broken.save({ active: false }, { patch: true })
      await fine.save({ active: false }, { patch: true })
    })
  })

  describe('offboarding with --remove', () => {
    it('takes back only what the feature gave, and only when applied', async () => {
      const leaver = await new User({ name: 'Leaver', email: 'leaver@agora.test', active: true, email_validated: true, created_at: new Date() }).save()
      const value = process.env.AGORA_ADMINS
      process.env.AGORA_ADMINS = `${guy.id}, ${boss.id}, ${leaver.id}`
      let given, givenSpace, own
      try {
        given = await Group.create(maker.id, { name: 'Given', slug: 'given' })
        givenSpace = await createSpace(maker.id, { parentGroupId: given.id, name: 'Given space' }, {})
        // A circle the leaver joined on their own, with the Administrator role
        own = await withoutAdmins(() => Group.create(maker.id, { name: 'Own', slug: 'own' }))
        await own.addMembers([leaver.id])
        await GroupMembership.assignAdministratorRole(leaver.id, own.id)
      } finally {
        // Taken out of the list first, as the README says
        process.env.AGORA_ADMINS = value
      }
      expect(await isAdministrator(leaver, given.id)).to.equal(true)
      expect(await isMember(leaver, givenSpace.id)).to.equal(true)

      const before = await snapshot()
      const dry = await removeAgoraAdminFromEverywhere(leaver.id)
      expect(dry.changes.map(c => c.groupId).sort()).to.deep.equal([String(given.id), String(givenSpace.id)].sort())
      expect(dry.kept).to.deep.equal([String(own.id)])
      expect(await snapshot()).to.deep.equal(before)

      const done = await removeAgoraAdminFromEverywhere(leaver.id, { apply: true })
      expect(done.changes).to.have.length(2)
      expect(done.failures).to.deep.equal([])
      expect(await isMember(leaver, given.id)).to.equal(false)
      expect(await isAdministrator(leaver, given.id)).to.equal(false)
      expect(await isMember(leaver, givenSpace.id)).to.equal(false)
      // Their own membership and role stay
      expect(await isMember(leaver, own.id)).to.equal(true)
      expect(await isAdministrator(leaver, own.id)).to.equal(true)
      // The other admins and the maker are untouched
      for (const admin of [guy, boss]) {
        expect(await isMember(admin, given.id)).to.equal(true)
        expect(await isAdministrator(admin, given.id)).to.equal(true)
      }
      expect(await isAdministrator(maker, given.id)).to.equal(true)
      // Not in the list any more, so the hourly run does not bring them back
      await addAgoraAdminsEverywhere({ apply: true })
      expect(await isMember(leaver, given.id)).to.equal(false)
      // A second time finds nothing to take back
      expect((await removeAgoraAdminFromEverywhere(leaver.id, { apply: true })).changes).to.deep.equal([])
    })
  })
})
