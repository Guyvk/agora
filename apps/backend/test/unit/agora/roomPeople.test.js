/* eslint-env mocha */
/**
 * Agora: the maker of a room adds people from the room's circle (lib/agora/rooms.js,
 * api/graphql/agora/rooms.js). Needs a database and empties it:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/roomPeople.test.js
 */
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const { assignAdministrator } = require(rootPath('test/setup/roleHelpers'))

describe('Agora: adding people to a room', () => {
  let Rooms, createSpace, mutations
  let circleSteward, maker, friend, other, outsider, circle, room

  const isIn = async (user, group) => {
    const m = await GroupMembership.forPair(user.id, group.id).fetch()
    return !!(m && m.get('active'))
  }
  const expectRefused = async (fn, pattern) => {
    try {
      await fn()
      expect.fail('should throw')
    } catch (e) {
      expect(e.message).to.match(pattern)
    }
  }

  before(async () => {
    Rooms = require(rootPath('lib/agora/rooms'))
    ;({ createSpace } = require(rootPath('api/graphql/mutations/spaces')))
    mutations = require(rootPath('api/graphql/agora/rooms')).makeAgoraRoomsMutations()
    await setup.clearDb()
    circleSteward = await factories.user().save()
    maker = await factories.user().save()
    friend = await factories.user().save()
    other = await factories.user().save()
    outsider = await factories.user().save()
    circle = await factories.group().save()
    await assignAdministrator(circleSteward, circle)
    for (const u of [maker, friend, other]) await u.joinGroup(circle)
    room = await createSpace(maker.id, { parentGroupId: circle.id, name: 'Secret plans' }, {}) // private by default
  })

  after(async () => setup.clearDb())

  it('lets the room maker add a member of the circle, who is then in the room', async () => {
    expect(await isIn(friend, room)).to.be.false
    const toAdd = await Rooms.peopleToAdd(maker.id, room.id)
    expect(toAdd.map(p => String(p.id))).to.include(String(friend.id))
    expect(toAdd.map(p => String(p.id))).to.not.include(String(maker.id))
    expect(toAdd.map(p => String(p.id))).to.not.include(String(outsider.id))
    const added = await Rooms.addRoomMembers(maker.id, room.id, [friend.id])
    expect(added.map(String)).to.deep.equal([String(friend.id)])
    expect(await isIn(friend, room)).to.be.true
    expect((await Rooms.peopleToAdd(maker.id, room.id)).map(p => String(p.id))).to.not.include(String(friend.id))
  })

  it('does not add someone who is not in the circle', async () => {
    await expectRefused(() => Rooms.addRoomMembers(maker.id, room.id, [outsider.id]), /only add people who are in this circle/)
    expect(await isIn(outsider, room)).to.be.false
  })

  it('does not let another member add people', async () => {
    await expectRefused(() => Rooms.addRoomMembers(other.id, room.id, [other.id]), /don.t have permission/)
    await expectRefused(() => Rooms.peopleToAdd(other.id, room.id), /don.t have permission/)
    expect(await isIn(other, room)).to.be.false
  })

  it('does not let the maker add people to a room made by someone else', async () => {
    const otherRoom = await createSpace(other.id, { parentGroupId: circle.id, name: 'Not yours' }, {})
    await expectRefused(() => Rooms.addRoomMembers(maker.id, otherRoom.id, [friend.id]), /don.t have permission/)
  })

  it('lets a circle steward add people', async () => {
    await Rooms.addRoomMembers(circleSteward.id, room.id, [other.id])
    expect(await isIn(other, room)).to.be.true
  })

  it('lets the maker take someone out, but not themselves', async () => {
    await Rooms.removeRoomMember(maker.id, room.id, other.id)
    expect(await isIn(other, room)).to.be.false
    await expectRefused(() => Rooms.removeRoomMember(maker.id, room.id, maker.id), /maker can.t be taken out/)
  })

  it('refuses to take out someone who is not in the room, and the member count stays right', async () => {
    const count = async () => (await Group.find(room.id)).get('num_members')
    const before = await count()
    await expectRefused(() => Rooms.removeRoomMember(maker.id, room.id, other.id), /not in the room/)
    expect(await count()).to.equal(before)
  })

  it('can add someone again after they were taken out', async () => {
    await Rooms.addRoomMembers(maker.id, room.id, [other.id])
    expect(await isIn(other, room)).to.be.true
    await Rooms.removeRoomMember(maker.id, room.id, other.id)
    expect(await isIn(other, room)).to.be.false
  })

  it('does not add a deactivated account', async () => {
    const gone = await factories.user().save()
    await gone.joinGroup(circle)
    await gone.save({ active: false }, { patch: true })
    await expectRefused(() => Rooms.addRoomMembers(maker.id, room.id, [gone.id]), /only add people who are in this circle/)
    expect(await isIn(gone, room)).to.be.false
  })

  it('refuses when nobody is logged in', async () => {
    await expectRefused(() => mutations.agoraAddRoomMembers({}, { roomId: room.id, userIds: [other.id] }, {}), /log in/)
    await expectRefused(() => Rooms.addRoomMembers(undefined, room.id, [other.id]), /log in/)
  })

  it('lets the maker add people through the GraphQL mutation', async () => {
    const result = await mutations.agoraAddRoomMembers({}, { roomId: room.id, userIds: [other.id] }, { currentUserId: maker.id })
    expect(result.addedIds.map(String)).to.deep.equal([String(other.id)])
    await Rooms.removeRoomMember(maker.id, room.id, other.id)
  })

  it('takes the powers away from a maker who left the circle', async () => {
    await bookshelf.knex('group_memberships').where({ user_id: maker.id, group_id: circle.id }).update({ active: false })
    await expectRefused(() => Rooms.addRoomMembers(maker.id, room.id, [other.id]), /don.t have permission/)
    await bookshelf.knex('group_memberships').where({ user_id: maker.id, group_id: circle.id }).update({ active: true })
  })
})
