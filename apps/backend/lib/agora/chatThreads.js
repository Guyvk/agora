/**
 * Agora: Slack-style threads in chat.
 *
 * A "thread" is the set of Hylo comments on a chat message. Two small helpers:
 *
 *  - lastCommentAt(postId): when the newest reply was written (for "3 replies, last 10 min ago").
 *  - pushThreadSummary(postId): after a reply is saved, tells everyone who has the circle's
 *    chat open the new reply count, who replied and when, so the counter under the message
 *    updates live. The rooms are the ones that carry new chat messages (same rules as
 *    createPost.js): a private room goes only to its members' own user rooms, an open room
 *    to its own room and its parent circle's room (where the web client listens).
 */
import { groupRoom, pushToSockets } from '../../api/services/Websockets'
import { isPrivateRoom, memberUserRooms } from './rooms'

export async function lastCommentAt (postId) {
  const row = await bookshelf.knex('comments')
    .where({ post_id: postId, active: true })
    .max('created_at as last')
    .first()
  return (row && row.last) || null
}

export async function pushThreadSummary (postId) {
  const post = await Post.find(postId)
  if (!post || post.get('type') !== 'chat') return null

  const [last, commenters, groups] = await Promise.all([
    lastCommentAt(postId),
    post.getCommenters(3).then(users => users.models.map(u => ({
      id: u.id, name: u.get('name'), avatarUrl: u.get('avatar_url')
    }))),
    post.groups().fetch().then(groups => groups.models)
  ])

  const payload = {
    postId: String(postId),
    commentsTotal: post.get('num_comments') || 0,
    commentersTotal: post.get('num_commenters') || 0,
    lastCommentAt: last ? new Date(last).toISOString() : null,
    commenters
  }

  const pushes = []
  const seen = new Set()
  const push = (room, groupId) => {
    if (seen.has(room + '|' + groupId)) return
    seen.add(room + '|' + groupId)
    pushes.push(pushToSockets(room, 'chatThreadUpdated', Object.assign({ groupId: String(groupId) }, payload)))
  }
  for (const g of groups) {
    const isSpace = g.get('type') === 'space'
    if (isSpace && isPrivateRoom(g)) {
      // Never the room's own channel or the parent circle's: members only, each in their own user room
      const userRooms = await memberUserRooms(g.id)
      userRooms.forEach(room => push(room, g.id))
      continue
    }
    push(groupRoom(g.id), g.id)
    // The web client joins the parent circle's room, not each space's
    if (isSpace && g.get('parent_id')) push(groupRoom(g.get('parent_id')), g.id)
  }
  await Promise.all(pushes)
  return payload
}
