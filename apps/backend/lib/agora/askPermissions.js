/**
 * Agora: THE permissions rule of the Ask tab, in one place.
 *
 * Decided on 19 October 2026 (Guy may change it later; change it here and
 * nowhere else):
 *
 *   1. Ask answers a person only from what they can already see in Agora:
 *      the posts, comments, chat, proposals and votes, events, playbook,
 *      library items (file texts) and meeting transcripts and minutes of a
 *      circle they are an active member of.
 *   2. The Ask tab of a circle draws only from that one circle. A member of
 *      circle A never gets anything from circle B through A's Ask tab, and
 *      someone who is not a member of a circle cannot use its Ask tab.
 *   3. Private messages (Hylo's direct message threads) never enter the
 *      knowledge index and never reach the AI as they are. Only anonymised
 *      themes made from them (lib/agora/privateThemes.js) can be used, and
 *      only in circles that the people in the conversation share.
 *   4. Logged out: nothing.
 *
 * askScope() is asked before every answer. indexablePost() decides what may
 * go into a circle's index at all. Both are used by lib/agora/ask.js and
 * lib/agora/askIndex.js.
 */

const knex = () => bookshelf.knex

// Post types that never go into a circle's index. "thread" is a private
// message thread; "chat_activity" is only a notice that chat happened.
const NEVER_INDEXED_POST_TYPES = ['thread', 'chat_activity']

/**
 * What a person may ask about in a circle.
 * @returns {Promise<null | { groupIds: string[], includePrivateThemes: boolean }>}
 *   null when they may not use the Ask tab of this circle at all.
 */
export async function askScope (userId, groupId) {
  if (!userId || !groupId) return null
  if (!/^\d+$/.test(String(userId)) || !/^\d+$/.test(String(groupId))) return null
  const row = await knex()('group_memberships as gm')
    .join('groups as g', 'g.id', 'gm.group_id')
    .join('users as u', 'u.id', 'gm.user_id')
    .where('gm.user_id', userId)
    .where('gm.group_id', groupId)
    .where('gm.active', true)
    .where('g.active', true)
    .where('u.active', true)
    .first('gm.id')
  if (!row) return null
  return {
    groupIds: [String(groupId)],
    includePrivateThemes: privateThemesOn()
  }
}

/** AGORA_ASK_PRIVATE_THEMES=off keeps anonymised private themes out of every answer. Default on. */
export function privateThemesOn () {
  return String(process.env.AGORA_ASK_PRIVATE_THEMES || 'on').trim().toLowerCase() !== 'off'
}

/**
 * Whether a post may be in the index of circles, and of which ones: only an
 * active post of a type that is not private, and only for the active
 * circles it was posted in.
 * @param {{ type: string, active: boolean }} post a row of the posts table
 * @param {Array<{ id, active }>} groups the circles it is in (groups_posts)
 * @returns {string[]} the ids of the circles whose index it may be in
 */
export function indexableGroupIds (post, groups) {
  if (!post || post.active === false) return []
  if (NEVER_INDEXED_POST_TYPES.includes(post.type)) return []
  return (groups || []).filter(g => g && g.active !== false).map(g => String(g.id))
}

export function isPrivatePostType (type) {
  return type === 'thread'
}

export default { askScope, privateThemesOn, indexableGroupIds, isPrivatePostType, NEVER_INDEXED_POST_TYPES }
