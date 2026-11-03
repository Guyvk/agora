/**
 * Agora: the calendar, for background jobs. Queue.classMethod('AgoraCalendar',
 * 'inviteEveryone', ...) runs it in the worker. The code is in
 * lib/agora/calendar.js.
 */
const Calendar = require('../../lib/agora/calendar')

module.exports = {
  inviteEveryone: data => Calendar.inviteEveryone(data)
}
