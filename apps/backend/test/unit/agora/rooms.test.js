/* eslint-env mocha */
/**
 * Agora: rooms made by members (lib/agora/rooms.js, createSpace/updateSpace/archiveSpace).
 * Needs a database and empties it:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/rooms.test.js
 *
 * "A muted room sends no notifications" is covered where it is enforced:
 * test/unit/models/Activity.test.js (postNotifications = none for a chat).
 */
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const { assignAdministrator } = require(rootPath('test/setup/roleHelpers'))
// Required inside before(): loading the mutations before the app has started stalls the run
let archiveSpace, createSpace, deleteSpace, updateSpace

describe('Agora rooms made by members', () => {
  let steward, member, otherMember, outsider, circle
  const privateRoom = { visibility: 0, accessibility: 0 } // Hidden + Closed
  const openRoom = { visibility: 1, accessibility: 2 } // Protected + Open (only the circle sees it)

  before(async () => {
    ({ archiveSpace, createSpace, deleteSpace, updateSpace } = require(rootPath('api/graphql/mutations/spaces')))
    await setup.clearDb()
    steward = await factories.user().save()
    member = await factories.user().save()
    otherMember = await factories.user().save()
    outsider = await factories.user().save()
    circle = await factories.group().save()
    await assignAdministrator(steward, circle)
    await member.joinGroup(circle)
    await otherMember.joinGroup(circle)
  })

  after(async () => setup.clearDb())

  it('lets a plain member make an open room and makes them its steward', async () => {
    const room = await createSpace(member.id, { parentGroupId: circle.id, name: 'Kitchen talk', description: 'Recipes', ...openRoom }, {})
    expect(room.get('type')).to.equal('space')
    expect(room.get('created_by_id')).to.equal(member.id)
    expect(room.get('accessibility')).to.equal(Group.Accessibility.OPEN)
    const membership = await GroupMembership.forPair(member.id, room.id).fetch()
    expect(membership.get('active')).to.be.true
    await deleteSpace(steward.id, room.id, {})
  })

  it('makes a room private when the member says nothing', async () => {
    const room = await createSpace(member.id, { parentGroupId: circle.id, name: 'Quiet corner' }, {})
    expect(room.get('visibility')).to.equal(Group.Visibility.HIDDEN)
    expect(room.get('accessibility')).to.equal(Group.Accessibility.CLOSED)
    await deleteSpace(steward.id, room.id, {})
  })

  it('does not let someone outside the circle make a room', async () => {
    try {
      await createSpace(outsider.id, { parentGroupId: circle.id, name: 'Sneaky' }, {})
      expect.fail('should throw')
    } catch (e) {
      expect(e.message).to.match(/don.t have permission/)
    }
  })

  it('keeps paywall, role gates and auto-add for circle stewards', async () => {
    for (const extra of [{ paywall: true }, { autoAddMembers: true }, { status: 'draft' }, { visibility: 1, accessibility: 1 }]) {
      try {
        await createSpace(member.id, { parentGroupId: circle.id, name: 'Too much', ...extra }, {})
        expect.fail('should throw for ' + JSON.stringify(extra))
      } catch (e) {
        expect(e.message).to.not.equal('should throw for ' + JSON.stringify(extra))
      }
    }
  })

  it('lets the room steward rename, describe and archive their room, but nothing else', async () => {
    const room = await createSpace(member.id, { parentGroupId: circle.id, name: 'Mine', ...privateRoom }, {})
    await updateSpace(member.id, { id: room.id, name: 'Mine renamed', description: 'A short line' }, {})
    const saved = await Group.find(room.id)
    expect(saved.get('name')).to.equal('Mine renamed')
    expect(saved.get('description')).to.equal('A short line')

    for (const bad of [{ paywall: true }, { slug: 'x' }, { requiredRoles: [1] }, { autoAddMembers: true }, { status: 'draft' }]) {
      try {
        await updateSpace(member.id, { id: room.id, ...bad }, {})
        expect.fail('should throw for ' + JSON.stringify(bad))
      } catch (e) {
        expect(e.message).to.not.equal('should throw for ' + JSON.stringify(bad))
      }
    }

    try {
      await deleteSpace(member.id, room.id, {})
      expect.fail('should throw')
    } catch (e) {
      expect(e.message).to.match(/don.t have permission/)
    }

    await archiveSpace(member.id, room.id, {})
    expect((await Group.find(room.id)).get('status')).to.equal(Group.Status.ARCHIVED)
    await deleteSpace(steward.id, room.id, {})
  })

  it('does not let another member change or archive someone else\'s room', async () => {
    const room = await createSpace(member.id, { parentGroupId: circle.id, name: 'Not yours', ...openRoom }, {})
    for (const attempt of [
      () => updateSpace(otherMember.id, { id: room.id, name: 'Hijacked' }, {}),
      () => archiveSpace(otherMember.id, room.id, {})
    ]) {
      try {
        await attempt()
        expect.fail('should throw')
      } catch (e) {
        expect(e.message).to.match(/don.t have permission/)
      }
    }
    await deleteSpace(steward.id, room.id, {})
  })

  it('refuses the Public + Open preset, which every logged-in user could see', async () => {
    try {
      await createSpace(member.id, { parentGroupId: circle.id, name: 'Everyone sees', visibility: 2, accessibility: 2 }, {})
      expect.fail('should throw')
    } catch (e) {
      expect(e.message).to.equal('A room is either open or private')
    }
  })

  it('refuses extra settings a member cannot pick in the dialog', async () => {
    for (const extra of [{ slug: 'mine' }, { purpose: 'x' }, { location: 'Here' }, { bannerUrl: 'http://x/y.png' }, { avatarUrl: 'http://x/y.png' }, { addToMenu: false }]) {
      try {
        await createSpace(member.id, { parentGroupId: circle.id, name: 'Extras', ...extra }, {})
        expect.fail('should throw for ' + JSON.stringify(extra))
      } catch (e) {
        expect(e.message).to.match(/don.t have permission/)
      }
    }
  })

  it('takes the room steward powers away when they leave the circle', async () => {
    const leaver = await factories.user().save()
    await leaver.joinGroup(circle)
    const room = await createSpace(leaver.id, { parentGroupId: circle.id, name: 'Left behind', ...openRoom }, {})
    await bookshelf.knex('group_memberships').where({ user_id: leaver.id, group_id: circle.id }).update({ active: false })
    for (const attempt of [
      () => updateSpace(leaver.id, { id: room.id, name: 'Still mine' }, {}),
      () => archiveSpace(leaver.id, room.id, {})
    ]) {
      try {
        await attempt()
        expect.fail('should throw')
      } catch (e) {
        expect(e.message).to.match(/don.t have permission/)
      }
    }
    await deleteSpace(steward.id, room.id, {})
  })

  it('lets a circle steward still manage a member-made room', async () => {
    const room = await createSpace(member.id, { parentGroupId: circle.id, name: 'Steward can', ...openRoom }, {})
    await archiveSpace(steward.id, room.id, {})
    expect((await Group.find(room.id)).get('status')).to.equal(Group.Status.ARCHIVED)
    await deleteSpace(steward.id, room.id, {})
  })
})
