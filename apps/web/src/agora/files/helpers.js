/**
 * Agora: small helpers of the Files page, kept apart so they can be tested
 * without drawing anything.
 */

/**
 * Folders first, always. Then files and links mixed, by the chosen column.
 * Same rule as the server's byFolderThenName (lib/agora/kdriveCircles.js) for
 * the name; other columns fall back to the name for equal values, and
 * folders (which have no size) are ordered by name when sorting by size.
 * key: 'name', 'addedBy', 'date' or 'size'. direction: 'asc' or 'desc'.
 */
export function sortItems (items, key = 'name', direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const value = item => {
    if (key === 'addedBy') return item.addedBy ? item.addedBy.toLowerCase() : null
    if (key === 'date') return item.changedAt ? Date.parse(item.changedAt) : null
    if (key === 'size') return item.size === null || item.size === undefined ? null : Number(item.size)
    return null
  }
  const compare = (a, b) => {
    if (key === 'name') return sign * byName(a, b)
    const x = value(a)
    const y = value(b)
    // Empty values go last, whichever way it is sorted.
    if (x === null && y === null) return byName(a, b)
    if (x === null) return 1
    if (y === null) return -1
    if (x < y) return -sign
    if (x > y) return sign
    return byName(a, b)
  }
  return [...items].sort((a, b) => {
    const aFolder = a.kind === 'folder'
    const bFolder = b.kind === 'folder'
    if (aFolder !== bFolder) return aFolder ? -1 : 1
    return compare(a, b)
  })
}

export function formatSize (bytes, locale) {
  if (bytes === null || bytes === undefined) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = Number(bytes)
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toLocaleString(locale, { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`
}

export function formatDay (iso, locale) {
  return iso ? new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

/**
 * What may be done with a selection: only what the person may do with every
 * one of the items. (The server decides again for each item.)
 */
export function selectionActions (selected) {
  const all = selected.length > 0
  return {
    move: all && selected.every(i => i.canChange),
    remove: all && selected.every(i => i.canChange),
    download: all && selected.every(i => i.kind === 'file')
  }
}

// The kinds of Google link, with the colour of each badge.
export const SERVICES = {
  docs: { label: 'Docs', name: 'Google Docs', color: '#1a73e8' },
  sheets: { label: 'Sheets', name: 'Google Sheets', color: '#188038' },
  slides: { label: 'Slides', name: 'Google Slides', color: '#b06000' },
  forms: { label: 'Forms', name: 'Google Forms', color: '#7248b9' },
  drive: { label: 'Drive', name: 'Google Drive', color: '#5f6368' }
}

/** The address of a link, only when it is a plain https address at Google's document or Drive host. Otherwise null. */
export function googleUrl (value) {
  try {
    const url = new URL(String(value))
    const ok = url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'docs.google.com' || url.hostname === 'drive.google.com')
    return ok ? url.href : null
  } catch (e) {
    return null
  }
}

// How the viewer shows a file, by the end of its name. The same list as
// VIEWABLE in AgoraKdriveController; anything else is only downloaded.
const VIEW_KINDS = {
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  txt: 'text',
  md: 'text',
  csv: 'text',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  mp4: 'video',
  webm: 'video'
}

/** 'pdf', 'image', 'text', 'audio' or 'video' when the viewer can show the file, otherwise null. */
export function viewKind (name) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(name || ''))
  return match ? VIEW_KINDS[match[1].toLowerCase()] || null : null
}
