/**
 * Agora: ends meetings that are still open, so their minutes get written.
 * For administrators, run in the Terminal from apps/backend (on the server:
 * /srv/agora/apps/backend, as the agora user):
 *
 *   node scripts/agora-end-open-meetings.js
 *        only shows the open meetings; nothing is changed
 *   node scripts/agora-end-open-meetings.js --apply
 *        ends every open meeting
 *   node scripts/agora-end-open-meetings.js --apply --session 12
 *        ends only meeting session 12
 *
 * Ending works exactly like pressing "End meeting for everyone" in the room:
 * the meeting is marked as ending and the worker writes the minutes and posts
 * them in the event's circle, normally within a minute or two (the worker,
 * agora-worker, must be running). A meeting in which nothing was said or
 * typed is closed without a post.
 *
 * Since this change, meetings also end by themselves (10 minutes after the
 * last person left, or at the latest 2 hours after the event's end time; see
 * MeetingSession.closeStale). This script is for meetings that are open now
 * and should not wait, such as ones left open before that existed.
 * Safe to run again: a meeting that has ended is not touched.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

function when (date) {
  return date ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '(unknown)'
}

async function run ({ apply, only }) {
  const { reasonToEnd, lastPresence } = require('../lib/agora/meetingChat')
  const open = await MeetingSession.query(q => {
    q.where({ status: MeetingSession.Status.OPEN })
    if (only) q.where({ id: only })
    q.orderBy('id', 'asc')
  }).fetchAll({ withRelated: ['post'] })

  if (only && open.length === 0) {
    console.log(`\nMeeting session ${only} is not open (it does not exist or has ended already). Nothing to do.\n`)
    return
  }
  console.log(`\nOpen meetings: ${open.length}`)

  for (const session of open.models) {
    const post = session.relations.post
    const reason = await reasonToEnd(session, post)
    const segments = await bookshelf.knex('meeting_segments').where({ session_id: session.id, status: MeetingSegment.Status.DONE }).count('id as count').first()
    const chat = await bookshelf.knex('meeting_chat_messages').where({ session_id: session.id }).count('id as count').first()
    console.log(`  session ${session.id}, event post ${session.get('post_id')} "${post ? post.get('name') : '?'}"`)
    console.log(`    started ${when(session.get('started_at'))}, last person seen ${when(await lastPresence(session))}`)
    console.log(`    ${segments.count} transcribed lines, ${chat.count} chat messages`)
    console.log(`    ${reason === 'empty' ? 'nobody is in it any more: it would end by itself on the next 10-minute run'
      : reason === 'late' ? 'it is more than 2 hours past the event\'s end: it would end by itself on the next 10-minute run'
      : 'someone may still be in it'}`)
    if (apply) {
      await MeetingSession.end({ sessionId: session.id })
      console.log('    ENDED: the worker now writes and posts the minutes')
    }
  }

  if (!apply && open.length) {
    console.log('\nNothing was changed. To end these meetings: node scripts/agora-end-open-meetings.js --apply')
    console.log('To end only one: node scripts/agora-end-open-meetings.js --apply --session <number>')
  }
  console.log('')
}

skiff.lift({
  start: function (argv) {
    const only = argv.session !== undefined ? String(argv.session) : null
    if (only !== null && !/^\d{1,18}$/.test(only)) {
      console.error('\n--session needs the number of a meeting session, for example --session 1\n')
      process.exitCode = 1
      return skiff.lower()
    }
    run({ apply: Boolean(argv.apply), only })
      .catch(err => {
        console.error(`\nCould not end the open meetings: ${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
