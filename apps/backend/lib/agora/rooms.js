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

// The two choices a member sees: open and private. Same values as the 'open'
// and 'invite' presets in apps/web .../ContextMenu/spaceFormConstants.js
// (a function, because the Group model only exists once the app has started)
const roomPresets = () => ({
  open: { visibility: Group.Visibility.PUBLIC, accessibility: Group.Accessibility.OPEN },
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

/** The steward of a room is the person who made it. */
function isRoomSteward (userId, space) {
  const creator = space && space.get('created_by_id')
  return !!(userId && creator && String(creator) === String(userId))
}

/** True when this member may only use the simple member dialog (not a circle steward). */
function restrictedRoomFields (changes) {
  return Object.keys(changes).filter(k => changes[k] !== undefined && !ROOM_STEWARD_FIELDS.includes(k))
}

/** Maps a simple open/private choice to Hylo's visibility + accessibility numbers. */
function presetFor (visibility, accessibility) {
  return Object.values(roomPresets()).some(p => p.visibility === visibility && p.accessibility === accessibility)
}

module.exports = { roomPresets, ROOM_STEWARD_FIELDS, isCircleSteward, canCreateRoom, isRoomSteward, restrictedRoomFields, presetFor }
