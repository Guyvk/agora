/**
 * Agora: every Meeting's video call goes through its own meeting room.
 *
 * Since Agora split events into Meetings and Events (lib/agora/eventKinds.js),
 * only Meetings have a meeting room. An Event (a talk, a festival stand) has
 * a place and never a video call link. Below, "event" means Hylo's event
 * post, which is either.
 *
 * Hylo shows an event's video call link on the event, in invitations, in
 * emails and in calendar entries, and lets people type any link there, for
 * example for Zoom. Agora decided that calls always run in Agora's own
 * meeting room (Jitsi on kMeet by Infomaniak, set with AGORA_MEET_DOMAIN),
 * so the room writes its own minutes. That is why:
 *
 * - an event's video call link is always its meeting room. Whatever a web
 *   page, an app or the API sends is ignored, when an event is made and when
 *   it is changed;
 * - without AGORA_MEET_DOMAIN there is no call to show, so an event has no
 *   video call link at all, and other kinds of posts never have one;
 * - a link to another video call platform is refused as an event's location,
 *   because that would be the same thing through a side door.
 *
 * scripts/agora-meeting-links.js brings events made before this into line.
 */
import { GraphQLError } from 'graphql'
import { kindOf, MEETING, EVENT } from './eventKinds'

function isEnabled () {
  return Boolean((process.env.AGORA_MEET_DOMAIN || '').trim())
}

/** The address of an event's meeting room, as people open it in the browser. */
export function meetingRoomUrl (postId) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}/noo/meeting/${postId}/room`
}

/** True when a link points at one of Agora's own meeting rooms. */
export function isMeetingRoomUrl (link) {
  return /\/noo\/meeting\/\d+\/room\/?$/.test(String(link || '').trim())
}

// Video call platforms, and the call server itself (a kMeet room other than
// the event's own one would skip the minutes too).
const CALL_HOSTS = [
  /(^|\.)zoom\.us$/,
  /(^|\.)zoom\.com$/,
  /^meet\.google\.com$/,
  /^meet\.jit\.si$/,
  /^8x8\.vc$/,
  /^teams\.microsoft\.com$/,
  /^teams\.live\.com$/,
  /(^|\.)webex\.com$/,
  /(^|\.)whereby\.com$/,
  /(^|\.)gotomeeting\.com$/,
  /(^|\.)goto\.com$/,
  /^meet\.goto\.com$/,
  /(^|\.)skype\.com$/,
  /^join\.skype\.com$/,
  /^kmeet\.infomaniak\.com$/
]

function meetHost () {
  return (process.env.AGORA_MEET_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').toLowerCase()
}

/**
 * True when the text contains a link to a video call outside Agora's meeting
 * rooms: Zoom, Google Meet, Teams, Jitsi, Webex, Whereby and the like.
 */
export function hasOutsideCallLink (text) {
  const found = String(text || '').match(/(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?/gi) || []
  const own = meetHost()
  return found.some(link => {
    let host
    try {
      host = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`).hostname.toLowerCase()
    } catch (e) {
      return false
    }
    return CALL_HOSTS.some(pattern => pattern.test(host)) || (own && host === own)
  })
}

/**
 * What a post's video call link must be: its meeting room for a Meeting, null
 * for an Event and for every other kind of post. `kind` is 'meeting' or
 * 'event'; an event post without one counts as a Meeting.
 */
export function lockedMeetingLink (postId, type, kind) {
  return isEnabled() && type === 'event' && kind !== EVENT ? meetingRoomUrl(postId) : null
}

/** The kind a post has after a change: the one being saved, else the one it had. */
function kindAfter (post, type, newKind) {
  if (type !== 'event') return null
  if (newKind === MEETING || newKind === EVENT) return newKind
  return kindOf(post) || MEETING
}

/**
 * Before an event is saved: refuses a link to another video call platform as
 * its location.
 */
export function refuseOutsideCallLocation (type, location) {
  if (type !== 'event' || !hasOutsideCallLink(location)) return
  throw new GraphQLError('Video calls in Agora only take place in a meeting\'s own meeting room. Please take the video call link out of the location.')
}

/**
 * After a new post is saved: an event gets its meeting room as its video
 * call link, and anything a client sent is replaced. Runs inside the same
 * database transaction as the post itself.
 */
export async function fillMeetingLink (post, { transacting } = {}) {
  const link = lockedMeetingLink(post.id, post.get('type'), kindOf(post))
  if ((post.get('meeting_link') || null) === link) return post
  return post.save({ meeting_link: link }, { patch: true, transacting })
}

/**
 * Before a post is changed: whatever video call link the change carries, a
 * Meeting keeps its meeting room and other posts (Events too) get none.
 */
export function keepMeetingLink (post, attrs) {
  const type = attrs.type || post.get('type')
  return { ...attrs, meeting_link: lockedMeetingLink(post.id, type, kindAfter(post, type, attrs.agora_kind)) }
}

/**
 * The same for the parameters Hylo uses to see what changed in an event (for
 * the update emails and calendar entries), so a link a client sent never
 * reaches anyone.
 */
export function lockMeetingLinkParam (post, params) {
  const type = params.type || post.get('type')
  return { ...params, meetingLink: lockedMeetingLink(post.id, type, kindAfter(post, type, params.agoraKind)) }
}

/**
 * For scripts/agora-meeting-links.js: finds posts whose video call link is not
 * what it must be (a Meeting with a Zoom link or without its room, an Event
 * with any link, a non-event with a link), and events whose location is
 * a link to another video call platform. With apply, puts them right: the
 * video call link becomes the meeting room (or nothing), and a location that
 * is only such a link is emptied. A location with more in it (an address and
 * a link) is only listed, to be changed by hand. Sends no emails; the
 * calendar files of the changed events are made again.
 * Safe to run again: a second run finds nothing more to change.
 */
export async function bringPostsIntoLine ({ apply = false } = {}) {
  const knex = bookshelf.knex
  const rows = await knex('posts')
    .where('active', true)
    .where(q => q.where('type', 'event').orWhereNotNull('meeting_link'))
    .select('id', 'type', 'agora_kind', 'name', 'meeting_link', 'location')
    .orderBy('id')

  const links = []
  const locations = []
  for (const row of rows) {
    const link = lockedMeetingLink(row.id, row.type, kindOf(row))
    if ((row.meeting_link || null) !== link) {
      links.push({ id: row.id, name: row.name, from: row.meeting_link || null, to: link })
    }
    if (row.type === 'event' && hasOutsideCallLink(row.location)) {
      const onlyLink = /^\S+$/.test(String(row.location).trim())
      locations.push({ id: row.id, name: row.name, location: row.location, cleared: onlyLink })
    }
  }

  if (apply) {
    const changed = new Set()
    for (const fix of links) {
      await knex('posts').where('id', fix.id).update({ meeting_link: fix.to })
      changed.add(fix.id)
    }
    for (const fix of locations.filter(l => l.cleared)) {
      await knex('posts').where('id', fix.id).update({ location: null })
      changed.add(fix.id)
    }
    for (const id of changed) {
      const post = await Post.find(id)
      if (post && post.isEvent()) {
        await post.createUserRsvpCalendarSubscriptions()
        await post.createGroupEventCalendarSubscriptions()
      }
    }
  }

  return { links, locations, enabled: isEnabled() }
}
