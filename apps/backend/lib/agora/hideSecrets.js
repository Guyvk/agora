/**
 * Agora: keeps the secret of a calendar link out of logs and error reports.
 *
 * A calendar link is /noo/agora/calendar/<secret>.ics (lib/agora/calendar.js).
 * Whatever comes after /noo/agora/calendar/ is hidden, with or without .ics,
 * except the calendar page's own calls under /noo/agora/calendar/api/.
 * Used by the request log (config/http.js) and the error reporter (lib/sentry.js).
 */
const CALENDAR_SECRET = /(\/noo\/agora\/calendar\/)(?!api(?:[/?]|$))[^/?#]+/g

function hideCalendarSecret (url) {
  if (url == null) return url
  return String(url).replace(CALENDAR_SECRET, '$1(hidden)')
}

module.exports = { hideCalendarSecret }
