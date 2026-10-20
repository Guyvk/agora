/**
 * Agora: who may change a post.
 *
 * Hylo's updatePost checked nothing: anyone logged in could change any post
 * they could name, also one in a circle they are not in (and since Meetings
 * and Events for all of 7BP are visible to every member, such posts are easy
 * to find). Agora allows a change only by:
 * - the person who made the post, or
 * - someone with the Manage Content or Administration responsibility in at
 *   least one of the circles the post is in now (the same people who may
 *   mark someone else's post as done, see postFulfillmentPermissions.js).
 *
 * Used by updatePost (api/models/post/updatePost.js) and by the proposal
 * option changes (api/graphql/mutations/post.js).
 */
import { GraphQLError } from 'graphql'

export const NOT_ALLOWED = "You don't have permission to modify this post"

/** True when the person may change the post (a Post model or its id). */
export async function canEditPost (userId, postOrId) {
  if (!userId || !postOrId) return false
  const post = typeof postOrId === 'object' ? postOrId : await Post.find(postOrId)
  if (!post) return false
  if (String(post.get('user_id')) === String(userId)) return true

  const groupIds = await bookshelf.knex('groups_posts')
    .join('groups', 'groups.id', 'groups_posts.group_id')
    .where({ 'groups_posts.post_id': post.id, 'groups.active': true })
    .pluck('groups.id')
  const { RESP_ADMINISTRATION, RESP_MANAGE_CONTENT } = Responsibility.constants
  // Hylo's own check, which also lets stewards of a parent circle act in its spaces
  for (const groupId of groupIds) {
    if (await GroupMembership.hasResponsibility(userId, groupId, RESP_ADMINISTRATION)) return true
    if (await GroupMembership.hasResponsibility(userId, groupId, RESP_MANAGE_CONTENT)) return true
  }
  return false
}

/** Throws the same error Hylo uses elsewhere when the person may not change the post. */
export async function assertCanEditPost (userId, postId) {
  const post = await Post.find(postId)
  if (!post) throw new GraphQLError('Post not found')
  if (!(await canEditPost(userId, post))) throw new GraphQLError(NOT_ALLOWED)
  return post
}
