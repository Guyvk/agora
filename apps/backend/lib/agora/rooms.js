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

/** A private room: hidden or invite only. Its posts go only to its own members. */
function isPrivateRoom (space) {
  return space.get('visibility') === Group.Visibility.HIDDEN || space.get('accessibility') === Group.Accessibility.CLOSED
}

module.exports = { isPrivateRoom, roomPresets, ROOM_CREATE_FIELDS, restrictedCreateFields, ROOM_STEWARD_FIELDS, isCircleSteward, canCreateRoom, isRoomSteward, restrictedRoomFields, presetFor }
