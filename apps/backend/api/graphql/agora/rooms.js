/**
 * Agora: the GraphQL part of adding people to a room. The schema is in
 * rooms.graphql next to this file; who may do what is checked in lib/agora/rooms.js.
 * makeSchema.js adds both to Hylo's schema, for logged-in people only.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { GraphQLError } from 'graphql'
import Rooms from '../../../lib/agora/rooms'
import { notifyGroupUpdated } from '../mutations/notifyGroupUpdated'
import { userRoom, pushToSockets } from '../../services/Websockets'

export const agoraRoomsTypeDefs = readFileSync(join(__dirname, 'rooms.graphql')).toString()

/** Turns a RoomError into a message the page can show; other errors stay hidden. */
function answer (fn) {
  return async (root, args, context) => {
    try {
      return await fn(context.currentUserId, args, context)
    } catch (err) {
      if (err instanceof Rooms.RoomError) throw new GraphQLError(err.message)
      throw err
    }
  }
}

/** Tells the room's members' browsers to refresh the menu (ids only, no content). */
async function tellMenus (context, room, userIds) {
  const parentId = room.get('parent_id')
  const parent = await Group.find(parentId)
  notifyGroupUpdated(context, parent, parentId)
  userIds.forEach(id => pushToSockets(userRoom(id), 'groupUpdated', { groupId: parentId, updatedByUserId: context?.currentUserId || null }))
}

export function makeAgoraRoomsQueries () {
  return {
    agoraRoomPeopleToAdd: answer(async (userId, { roomId }) =>
      (await Rooms.peopleToAdd(userId, roomId)).map(p => ({ id: p.id, name: p.name, avatarUrl: p.avatar_url })))
  }
}

export function makeAgoraRoomsMutations () {
  return {
    agoraAddRoomMembers: answer(async (userId, { roomId, userIds }, context) => {
      const added = await Rooms.addRoomMembers(userId, roomId, userIds)
      if (added.length) await tellMenus(context, await Group.find(roomId), added)
      return { success: true, addedIds: added }
    }),
    agoraRemoveRoomMember: answer(async (userId, { roomId, userId: memberId }, context) => {
      await Rooms.removeRoomMember(userId, roomId, memberId)
      await tellMenus(context, await Group.find(roomId), [memberId])
      return { success: true, addedIds: [] }
    })
  }
}
