/**
 * Agora: every event gets its meeting room as its video call link.
 *
 * Hylo shows an event's video call link on the event, in invitations, in
 * emails and in calendar entries. When the person who schedules an event
 * leaves that link empty, Agora fills in the event's own meeting room, so
 * everyone lands in the call that writes its own minutes. A link someone
 * typed themselves, for example a Zoom link, is left as it is.
 *
 * This only happens when AGORA_MEET_DOMAIN is set, because without it the
 * meeting room has no call to show.
 */

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

function needsLink (post) {
  return isEnabled() && post.get('type') === 'event' && !String(post.get('meeting_link') || '').trim()
}

/**
 * After a new event is saved: fills in its meeting room when it has no video
 * call link. Runs inside the same database transaction as the event itself.
 */
export async function fillMeetingLink (post, { transacting } = {}) {
  if (!needsLink(post)) return post
  return post.save({ meeting_link: meetingRoomUrl(post.id) }, { patch: true, transacting })
}

/**
 * Before an event is changed: when the change leaves the video call link
 * empty, puts the meeting room back.
 */
export function keepMeetingLink (post, attrs) {
  if (!isEnabled() || post.get('type') !== 'event') return attrs
  if (String(attrs.meeting_link || '').trim()) return attrs
  return { ...attrs, meeting_link: meetingRoomUrl(post.id) }
}
