/**
 * Agora: Slack-style threads in chat.
 *
 * A "thread" is the set of Hylo comments on a chat message. Two small helpers:
 *
 *  - lastCommentAt(postId): when the newest reply was written (for "3 replies, last 10 min ago").
 *  - pushThreadSummary(postId): after a reply is saved, tells everyone who has the circle's
 *    chat open the new reply count, who replied and when, so the counter under the message
 *    updates live. Rooms are the same group rooms that already carry new chat messages,
 *    and only members of the circle can join them.
 */
import { groupRoom, pushToSockets } from '../../api/services/Websockets'

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

  const [last, commenters, groupIds] = await Promise.all([
    lastCommentAt(postId),
    post.getCommenters(3).then(users => users.models.map(u => ({
      id: u.id, name: u.get('name'), avatarUrl: u.get('avatar_url')
    }))),
    bookshelf.knex('groups_posts').where({ post_id: postId }).pluck('group_id')
  ])

  const payload = {
    postId: String(postId),
    commentsTotal: post.get('num_comments') || 0,
    commentersTotal: post.get('num_commenters') || 0,
    lastCommentAt: last ? new Date(last).toISOString() : null,
    commenters
  }

  await Promise.all(groupIds.map(groupId =>
    pushToSockets(groupRoom(groupId), 'chatThreadUpdated', Object.assign({ groupId: String(groupId) }, payload))))
  return payload
}
