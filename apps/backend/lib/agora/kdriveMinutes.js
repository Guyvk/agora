/**
 * Agora: a copy of a meeting's minutes in the circle's kDrive folder.
 *
 * After the worker has posted the minutes (MeetingSession.finalize), the same
 * content as the post (MeetingMinutes.renderMarkdown: the summary and who was
 * there, or the transcript and chat when no summary could be written) is saved
 * as a Markdown file in each circle the post went to, in its folder "Minutes", named "YYYY-MM-DD <meeting title>.md".
 * kDrive never stops the minutes: a failure is written to the log, and the
 * copy is tried once more RETRY_MINUTES later by the worker
 * (MeetingSession.copyMinutesToKdrive). Without kDrive settings nothing happens.
 */
const Circles = require('./kdriveCircles')

const RETRY_MINUTES = 15

/** The file name: the meeting's date and title. */
function fileNameFor (date, title) {
  return Circles.cleanName(`${date} ${title || 'Meeting'}`.slice(0, 200) + '.md') || `${date} Meeting.md`
}

/**
 * Saves the copy in each circle. Never throws. Answers the ids of the circles
 * where it did not work.
 *   groupIds   the circles the minutes were posted in
 *   attempt    1 the first time; after a failure on attempt 1 the worker tries once more
 */
async function copy ({ sessionId, groupIds, fileName, markdown, attempt = 1 }) {
  if (!Circles.isConfigured()) return []
  const failed = []
  for (const groupId of groupIds || []) {
    try {
      const group = await Group.where({ id: groupId }).fetch()
      if (!group || !group.get('active')) continue
      await Circles.saveMinutes(group, { fileName, markdown })
      sails.log.info(`Agora kDrive: saved the minutes of meeting ${sessionId} for group ${groupId}`)
    } catch (err) {
      failed.push(groupId)
      sails.log.error(`Agora kDrive: could not save the minutes of meeting ${sessionId} for group ${groupId} (attempt ${attempt}): ${err.message}`)
    }
  }
  if (failed.length && attempt < 2) {
    try {
      await Queue.classMethod('MeetingSession', 'copyMinutesToKdrive', { sessionId, groupIds: failed, fileName, markdown, attempt: attempt + 1 }, RETRY_MINUTES * 60000)
    } catch (err) {
      sails.log.error(`Agora kDrive: could not plan another try for the minutes of meeting ${sessionId}: ${err.message}`)
    }
  }
  return failed
}

module.exports = { copy, fileNameFor, RETRY_MINUTES }
