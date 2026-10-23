/**
 * Agora: links to Google documents, kept in a circle's Files page.
 *
 * A member pastes the address of a Google Doc, Sheet, Slides, Form or a file
 * or folder in Google Drive. Agora keeps only the address and a title; the
 * document itself stays at Google, where comments and suggestions happen.
 * Agora never calls Google about it: it only checks that the address is one
 * it is willing to send people to.
 *
 * Allowed: https, exactly docs.google.com or drive.google.com, the normal
 * port, no user name or password in the address, and a path that belongs to
 * a document, spreadsheet, presentation, form or Drive file or folder.
 * Everything else is refused, so the list can never hold a link to another
 * website, a script, or a page that only looks like Google's.
 */
const { KdriveError } = require('./kdrive')

const MAX_URL_LENGTH = 2000

// Where each kind of link lives. Paths are checked from the start.
const KINDS = [
  { kind: 'docs', host: 'docs.google.com', prefix: '/document/', title: 'Google Doc' },
  { kind: 'sheets', host: 'docs.google.com', prefix: '/spreadsheets/', title: 'Google Sheet' },
  { kind: 'slides', host: 'docs.google.com', prefix: '/presentation/', title: 'Google Slides' },
  { kind: 'forms', host: 'docs.google.com', prefix: '/forms/', title: 'Google Form' },
  { kind: 'drive', host: 'drive.google.com', prefix: '/file/', title: 'Google Drive file' },
  { kind: 'drive', host: 'drive.google.com', prefix: '/drive/', title: 'Google Drive folder' },
  { kind: 'drive', host: 'drive.google.com', prefix: '/folderview', title: 'Google Drive folder' },
  { kind: 'drive', host: 'drive.google.com', prefix: '/open', title: 'Google Drive file' }
]

const KIND_NAMES = ['docs', 'sheets', 'slides', 'forms', 'drive']

// Query parts that only track where a link was shared from.
const TRACKING = /^(utm_.*|fbclid|gclid|mc_.*|usp|usp_sharing|ouid|rtpof|sd)$/i

function refused () {
  return new KdriveError(
    'bad_request',
    'Paste the address of a Google Doc, Sheet, Slides, Form, or a file or folder in Google Drive. It must start with https://docs.google.com or https://drive.google.com.'
  )
}

/**
 * Checks an address and cleans it. Answers { url, kind, defaultTitle }, or
 * throws a bad_request KdriveError. Makes no request to anyone.
 */
function parse (value) {
  // Only text: a list or an object sent in its place is refused, not turned into text.
  if (typeof value !== 'string') throw refused()
  const text = value.trim()
  // Spaces, control characters and backslashes never belong in a link to a document.
  // eslint-disable-next-line no-control-regex
  if (!text || text.length > MAX_URL_LENGTH || /[\s\u0000-\u001f\u007f\\]/.test(text)) throw refused()
  let url
  try {
    url = new URL(text)
  } catch (err) {
    throw refused()
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw refused()
  const match = KINDS.find(k => url.hostname === k.host && url.pathname.startsWith(k.prefix))
  if (!match) throw refused()
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING.test(key)) url.searchParams.delete(key)
  }
  const clean = url.toString()
  if (clean.length > MAX_URL_LENGTH) throw refused()
  return { url: clean, kind: match.kind, defaultTitle: match.title }
}

module.exports = { parse, KIND_NAMES, MAX_URL_LENGTH }
