// Agora: "10 minutes ago" in the reader's language, for "3 replies, last 10 minutes ago"
const STEPS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

export default function relativeTime (date, locale = 'en', now = Date.now()) {
  const then = new Date(date).getTime()
  if (!date || Number.isNaN(then)) return ''
  const seconds = Math.round((then - now) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.trunc(seconds / size), unit)
  }
  return formatter.format(0, 'second') // "now"
}
