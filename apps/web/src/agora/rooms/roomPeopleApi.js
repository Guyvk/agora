/**
 * Agora: talks to the server part of "add people to a room" through GraphQL
 * (apps/backend/api/graphql/agora/rooms.js). Who may do it is checked there.
 */
const GRAPHQL = '/noo/graphql'

export const PEOPLE_TO_ADD_QUERY = `query AgoraRoomPeopleToAdd ($roomId: ID) {
  agoraRoomPeopleToAdd(roomId: $roomId) { id name avatarUrl }
}`

export const ADD_PEOPLE_MUTATION = `mutation AgoraAddRoomMembers ($roomId: ID, $userIds: [ID]) {
  agoraAddRoomMembers(roomId: $roomId, userIds: $userIds) { success addedIds }
}`

export async function roomPeopleApi (query, variables = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const body = await res.json().catch(() => ({}))
  if (body.errors && body.errors.length) throw new Error(body.errors[0].message || 'Something went wrong. Try again in a minute.')
  if (!res.ok || !body.data) throw new Error('Something went wrong. Try again in a minute.')
  return body.data
}
