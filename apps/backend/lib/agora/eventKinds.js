/**
 * Agora: Meetings and Events.
 *
 * Hylo has one kind of post with a date and time, the event. Agora uses that
 * same engine for two kinds of things, told apart by posts.agora_kind:
 *
 * - a Meeting is for the team. It always has its Agora meeting room and its
 *   minutes (lib/agora/meetingLink.js), and it is never public.
 * - an Event is a gathering: a talk, an info evening, a festival stand, a
 *   demonstration. It has a place and replies (RSVPs), never a meeting room,
 *   and it may be public when its circle allows public posts.
 *
 * The server decides, whatever a web page, an app or the API sends:
 * - an event post without a kind is a Meeting (the safe choice: internal);
 * - a Meeting is never public;
 * - only Meetings get a meeting room (see lockedMeetingLink in meetingLink.js).
 *
 * The kind may change when the post is edited. A Meeting that becomes an
 * Event loses its meeting room; an Event that becomes a Meeting gets one and
 * stops being public. People who replied hear about it through Hylo's usual
 * "changed" email, because the video call link changed.
 *
 * "For all of 7BP" (posts.agora_for_all): a steward of the main 7BP circle
 * may mark a Meeting or an Event for everyone. It then shows in every Agora
 * member's calendar and calendar feed, and every logged-in member may open it
 * (api/graphql/filters.js postFilter, Post.isVisibleToUser). The main circle
 * is the group whose slug is AGORA_MAIN_GROUP_SLUG (default "7bp").
 */
import { GraphQLError } from 'graphql'

export const MEETING = 'meeting'
export const EVENT = 'event'

/** The slug of the main 7BP circle, whose stewards may mark things for all of 7BP. */
export function mainGroupSlug () {
  return (process.env.AGORA_MAIN_GROUP_SLUG || '').trim() || '7bp'
}

/** The main 7BP circle, or null when there is none with that slug. */
export async function mainGroup () {
  const row = await bookshelf.knex('groups').where({ slug: mainGroupSlug(), active: true }).first('id', 'name', 'slug')
  return row || null
}

/**
 * The kind of a post: 'meeting', 'event', or null for posts that are not
 * events. Takes a Post model or a plain database row. An event without a
 * kind (made by an older version) counts as a Meeting.
 */
export function kindOf (post) {
  if (!post) return null
  const get = key => typeof post.get === 'function' ? post.get(key) : post[key]
  if (get('type') !== 'event') return null
  return get('agora_kind') === EVENT ? EVENT : MEETING
}

export function isMeeting (post) {
  return kindOf(post) === MEETING
}

/** True when the person is an active member of the main 7BP circle with the Administration responsibility. */
export async function canMarkForAll (userId) {
  if (!userId) return false
  const group = await mainGroup()
  if (!group) return false
  const member = await bookshelf.knex('group_memberships')
    .where({ user_id: userId, group_id: group.id, active: true })
    .first('id')
  if (!member) return false
  return GroupMembership.hasResponsibility(userId, group.id, Responsibility.constants.RESP_ADMINISTRATION)
}

function readKind (value) {
  if (value === undefined || value === null || value === '') return undefined
  if (value === MEETING || value === EVENT) return value
  throw new GraphQLError('A meeting or event must be of the kind "meeting" or "event".')
}

/**
 * Before a post is saved: fills in its kind and its "for all of 7BP" mark,
 * and makes a Meeting private. `params` is what the client sent (agoraKind,
 * agoraForAll); `post` is the saved post when it is being changed.
 *
 * - The kind: what was sent, else the kind it had, else Meeting.
 * - "For all of 7BP": only a steward of the main circle may switch it on or
 *   off. Leaving it as it was needs no check, so others can still edit.
 * - Posts that are not events have neither.
 */
export async function withKind (userId, attrs, params = {}, post = null) {
  const type = attrs.type || (post && post.get('type'))
  if (type !== 'event') {
    return { ...attrs, agora_kind: null, agora_for_all: false }
  }

  const kind = readKind(params.agoraKind) || (post ? kindOf(post) : MEETING)

  const before = post ? Boolean(post.get('agora_for_all')) : false
  const asked = params.agoraForAll
  const forAll = asked === undefined || asked === null ? before : Boolean(asked)
  if (forAll !== before && !(await canMarkForAll(userId))) {
    throw new GraphQLError('Only stewards of the main 7BP circle can mark a meeting or event for all of 7BP.')
  }

  const result = { ...attrs, agora_kind: kind, agora_for_all: forAll }
  if (kind === MEETING) result.is_public = false
  return result
}

/** The same for updatePost, which loads the post itself later. */
export async function withKindForUpdate (userId, postId, attrs, params) {
  const post = await Post.find(postId)
  if (!post) return attrs
  return withKind(userId, attrs, params, post)
}

/**
 * After a new post is saved: when its maker asked for it and it is for all
 * of 7BP, everyone gets a calendar invitation by email (a background job,
 * see lib/agora/calendar.js). Only when a new post is made, never on a change,
 * so nobody gets the same invitation twice.
 */
export function afterCreate (post, params = {}, userId) {
  if (!params.agoraInviteEveryone) return
  if (post.get('type') !== 'event' || !post.get('agora_for_all')) return
  return Queue.classMethod('AgoraCalendar', 'inviteEveryone', { postId: post.id, inviterId: userId })
}
