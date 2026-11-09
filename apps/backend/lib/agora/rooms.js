/**
 * Agora: rooms made by members.
 *
 * In Agora a circle is a Hylo group and a room is a "space" inside it. Hylo only
 * lets circle stewards (Administration) make and manage spaces. Guy decided
 * (Nov 2026) that EVERY member of a circle can make a room, and the maker is the
 * steward of that room.
 *
 * All the rules about who may make or manage a room live in this file, so they
 * can be changed in one place (for example to "a steward must approve a new
 * room") without touching spaces.js.
 *
 * Hylo keeps the roles of a space on its circle, so a space cannot have its own
 * "Administrator". A room steward is therefore the person recorded in
 * groups.created_by_id of the space. Circle stewards can still do everything.
 */

// The two choices a member sees: open and private. Private is the 'invite'
// preset in apps/web .../ContextMenu/spaceFormConstants.js. Open is PROTECTED +
// OPEN (not PUBLIC): Hylo shows PUBLIC spaces to every logged-in user, while a
// PROTECTED one is seen only by members of its circle (api/graphql/filters.js).
// (a function, because the Group model only exists once the app has started)
const roomPresets = () => ({
  open: { visibility: Group.Visibility.PROTECTED, accessibility: Group.Accessibility.OPEN },
  private: { visibility: Group.Visibility.HIDDEN, accessibility: Group.Accessibility.CLOSED }
})

// What a room steward who is not a circle steward may change on their room.
const ROOM_STEWARD_FIELDS = ['id', 'name', 'description', 'icon', 'visibility', 'accessibility', 'status']

async function isCircleSteward (userId, groupId) {
  const responsibilities = await Responsibility.fetchForUserAndGroupAsStrings(userId, groupId)
  return responsibilities.includes(Responsibility.constants.RESP_ADMINISTRATION)
}

/** THE rule for making a room: any active member of the circle (or a circle steward). */
async function canCreateRoom (userId, parentGroup) {
  if (!userId || !parentGroup || parentGroup.get('type') === 'space') return false
  if (await isCircleSteward(userId, parentGroup.id)) return true
  const membership = await GroupMembership.forPair(userId, parentGroup).fetch()
  return !!(membership && membership.get('active'))
}

/** The steward of a room is the person who made it, as long as they are still in its circle. */
async function isRoomSteward (userId, space) {
  const creator = space && space.get('created_by_id')
  if (!userId || !creator || String(creator) !== String(userId)) return false
  const parentId = space.get('parent_id')
  if (!parentId) return false
  const membership = await GroupMembership.forPair(userId, parentId).fetch()
  return !!(membership && membership.get('active'))
}

// What a plain member may set when making a room (what the member dialog offers)
const ROOM_CREATE_FIELDS = ['parentGroupId', 'name', 'description', 'icon', 'visibility', 'accessibility', 'viewTypes', 'acceptedPostTypes']

/** Fields a plain member may not set when making a room. */
function restrictedCreateFields (args) {
  return Object.keys(args).filter(k => args[k] !== undefined && args[k] !== null && !ROOM_CREATE_FIELDS.includes(k) && args[k] !== false && !(Array.isArray(args[k]) && args[k].length === 0))
}

/** True when this member may only use the simple member dialog (not a circle steward). */
function restrictedRoomFields (changes) {
  return Object.keys(changes).filter(k => changes[k] !== undefined && !ROOM_STEWARD_FIELDS.includes(k))
}

/** Maps a simple open/private choice to Hylo's visibility + accessibility numbers. */
function presetFor (visibility, accessibility) {
  return Object.values(roomPresets()).some(p => p.visibility === visibility && p.accessibility === accessibility)
}

/**
 * A private room: anything that is not simply open to its circle (invite only,
 * request to join, hidden, paywalled or role-gated). Its posts, chat notices and
 * typing signs go only to its own members, never to the parent circle's channel.
 */
function isPrivateRoom (space) {
  const roles = space.get('required_roles')
  return space.get('accessibility') !== Group.Accessibility.OPEN ||
    space.get('visibility') === Group.Visibility.HIDDEN ||
    !!space.get('paywall') ||
    (Array.isArray(roles) ? roles.length > 0 : !!roles && roles !== '[]')
}

/** Socket rooms (one per active member) that a private room's live messages go to. */
async function memberUserRooms (groupId, { transacting } = {}) {
  const { userRoom } = require('../../api/services/Websockets')
  const rows = await GroupMembership.query(q => {
    q.where({ group_id: groupId, active: true })
    if (transacting) q.transacting(transacting)
  }).fetchAll()
  return rows.map(m => userRoom(m.get('user_id')))
}


// ---------------------------------------------------------------------------
// Adding people to a room (Guy, 9 Nov 2026: the maker of a private room adds
// members of its circle, Slack style). The membership is made at once, no
// invitation. Who may do it, in one place: canManageRoomPeople.

class RoomError extends Error {}

/** The room (an active space) or an error; the person asking must be logged in. */
async function findRoomFor (userId, roomId) {
  if (!userId) throw new RoomError('You need to log in')
  const room = roomId ? await Group.findActive(roomId) : null
  if (!room || room.get('type') !== 'space' || !room.get('parent_id')) throw new RoomError('Room not found')
  return room
}

/** THE rule: the room's steward (its maker, still in the circle) or a steward of its circle. */
async function canManageRoomPeople (userId, room) {
  return await isRoomSteward(userId, room) || await isCircleSteward(userId, room.get('parent_id'))
}

async function requireRoomPeopleManager (userId, roomId) {
  const room = await findRoomFor(userId, roomId)
  if (!await canManageRoomPeople(userId, room)) throw new RoomError("You don't have permission to change who is in this room")
  return room
}

/** Active members of the room's circle who are not yet in the room. */
async function peopleToAdd (userId, roomId) {
  const room = await requireRoomPeopleManager(userId, roomId)
  const knex = bookshelf.knex
  const inRoom = knex('group_memberships').where({ group_id: room.id, active: true }).select('user_id')
  return knex('users')
    .join('group_memberships', 'group_memberships.user_id', 'users.id')
    .where({ 'group_memberships.group_id': room.get('parent_id'), 'group_memberships.active': true, 'users.active': true })
    .whereNotIn('users.id', inRoom)
    .orderBy('users.name')
    .select('users.id', 'users.name', 'users.avatar_url')
}

/** Adds people to the room. Only active members of the room's circle; nobody else. */
async function addRoomMembers (userId, roomId, userIds) {
  const room = await requireRoomPeopleManager(userId, roomId)
  const ids = [...new Set((userIds || []).map(String))]
  if (!ids.length) return []
  // Agora: only active accounts that are active members of the circle (same rule as peopleToAdd)
  const inCircle = await bookshelf.knex('group_memberships')
    .join('users', 'users.id', 'group_memberships.user_id')
    .where({ 'group_memberships.group_id': room.get('parent_id'), 'group_memberships.active': true, 'users.active': true })
    .whereIn('group_memberships.user_id', ids).select('group_memberships.user_id as user_id')
  const circleIds = new Set(inCircle.map(r => String(r.user_id)))
  if (ids.some(id => !circleIds.has(id))) throw new RoomError('You can only add people who are in this circle')
  const already = await bookshelf.knex('group_memberships')
    .where({ group_id: room.id, active: true }).whereIn('user_id', ids).select('user_id')
  const alreadyIds = new Set(already.map(r => String(r.user_id)))
  const toAdd = ids.filter(id => !alreadyIds.has(id))
  if (!toAdd.length) return []
  const now = new Date()
  await room.addMembers(toAdd, {
    settings: {
      showJoinForm: false,
      agreementsAcceptedAt: now,
      joinQuestionsAnsweredAt: now,
      lastReadAt: now,
      postNotifications: 'all',
      digestFrequency: 'daily',
      sendEmail: true,
      sendPushNotifications: true
    }
  }, {})
  // Agora: like every other way into a space (joinSpace, auto-add), set up the per-view unread rows
  await Group.ensureSpaceViewUsers(room.id, toAdd)
  return toAdd
}

/** Takes someone out of the room. The maker cannot be taken out. */
async function removeRoomMember (userId, roomId, memberId) {
  const room = await requireRoomPeopleManager(userId, roomId)
  if (String(memberId) === String(room.get('created_by_id'))) throw new RoomError("The room's maker can't be taken out")
  const member = await User.find(memberId)
  if (!member) throw new RoomError('Person not found')
  // Agora: only someone who is in the room now; removing twice would lower the member count again
  const membership = await GroupMembership.forPair(member.id, room.id).fetch()
  if (!membership || !membership.get('active')) throw new RoomError('This person is not in the room')
  await member.leaveGroup(room, true)
  return true
}

module.exports = { RoomError, findRoomFor, canManageRoomPeople, peopleToAdd, addRoomMembers, removeRoomMember, isPrivateRoom, memberUserRooms, roomPresets, ROOM_CREATE_FIELDS, restrictedCreateFields, ROOM_STEWARD_FIELDS, isCircleSteward, canCreateRoom, isRoomSteward, restrictedRoomFields, presetFor }
