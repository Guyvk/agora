/**
 * Agora: the action points of meeting minutes, as plain functions without a database.
 *
 *   - whoText / normalizeAction: the assistant used to return `who` as one string
 *     ("Mariam and Zenab"); it now returns a list of names. Both shapes work everywhere.
 *   - matchNames: turns the names in the minutes into members who were in the meeting.
 *   - parseActionsHtml: reads the Actions list back out of a minutes post (for the backfill).
 */

const EVERYONE = new Set([
  'everyone', 'everybody', 'all', 'we all', 'all of us', 'the group', 'the whole group', 'everyone present', 'all present', 'all members',
  'iedereen', 'allemaal', 'wij allemaal', 'allen', 'alle aanwezigen',
  'alle', 'alle anwesenden', 'wir alle', 'jeder', 'alle zusammen',
  'todos', 'todo el mundo', 'todas',
  'tous', 'tout le monde', 'nous tous', 'toutes',
  'tutti', 'tutti noi'
])

/** The names in `who`, whatever shape it came in: a list, or one text such as "Mariam and Zenab". */
function whoList (who) {
  const parts = Array.isArray(who) ? who : [who]
  const out = []
  for (const part of parts) {
    if (part == null) continue
    const text = String(part).trim()
    if (!text) continue
    // A single text can name two people: "Mariam and Zenab", "Mariam, Zenab", "Mariam & Zenab"
    for (const piece of Array.isArray(who) ? [text] : text.split(/\s*(?:,|;|&|\/|\band\b|\ben\b|\bund\b|\by\b|\bet\b|\be\b)\s*/i)) {
      const name = piece.trim()
      if (name) out.push(name)
    }
  }
  return out
}

/** The names joined the way the minutes post shows them. */
function whoText (who) {
  const names = Array.isArray(who) ? who.map(n => String(n == null ? '' : n).trim()).filter(Boolean) : [String(who == null ? '' : who).trim()].filter(Boolean)
  return names.join(' and ')
}

function cleanDue (value) {
  const v = value == null ? '' : String(value).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v).toISOString().slice(0, 10) === v ? v : ''
}

/** One action as { who: [names], what, due: 'YYYY-MM-DD' or '', project: id or null }. Accepts the old shape. */
function normalizeAction (action) {
  const a = action && typeof action === 'object' ? action : {}
  const project = a.project == null || a.project === '' ? null : String(a.project).trim()
  return {
    who: whoList(a.who),
    what: String(a.what == null ? '' : a.what).trim(),
    due: cleanDue(a.due),
    project: project && /^\d+$/.test(project) ? project : null
  }
}

function fold (value) {
  return String(value == null ? '' : value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isEveryone (name) {
  return EVERYONE.has(fold(name))
}

/**
 * One name from the minutes to one member, or null when there is no single clear match.
 * "Mariam" matches "Mariam:)", "Zenab" matches "zenab suleiman". The full name wins over the
 * first word; two members that fit equally well give no match (better none than the wrong one).
 * @param {string} name
 * @param {Array<{id, name}>} members  only people who were in the meeting
 */
function matchName (name, members) {
  const n = fold(name)
  if (!n) return null
  const folded = members.map(m => ({ m, full: fold(m.name) })).map(x => ({ ...x, first: x.full.split(' ')[0] }))
  const tiers = [
    x => x.full === n,
    x => x.first === n,
    x => !x.full.includes(' ') && x.full === n.split(' ')[0] // "Zenab Suleiman" in the minutes, "Zenab" in Agora
  ]
  for (const test of tiers) {
    const hits = folded.filter(test)
    if (hits.length === 1) return hits[0].m
    if (hits.length > 1) return null
  }
  return null
}

/**
 * The people of one action point.
 * @returns {{ everyone: boolean, people: Array<{id, name}> }}  everyone: it was for all present
 */
function matchNames (names, members) {
  const list = whoList(names)
  if (list.some(isEveryone)) return { everyone: true, people: [] }
  const people = []
  for (const name of list) {
    const found = matchName(name, members)
    if (found && !people.some(p => String(p.id) === String(found.id))) people.push(found)
  }
  return { everyone: false, people }
}

function decodeEntities (html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim()
}

/**
 * The action points in the HTML of a minutes post:
 * <h3>Actions</h3><ul><li><strong>Name</strong>: what (by YYYY-MM-DD)</li>...
 * @returns {Array<{ who: string, what: string, due: string }>}
 */
function parseActionsHtml (html) {
  const section = /<h3>\s*Actions\s*<\/h3>\s*<ul>([\s\S]*?)<\/ul>/i.exec(String(html || ''))
  if (!section) return []
  const out = []
  const items = section[1].match(/<li>[\s\S]*?<\/li>/gi) || []
  for (const item of items) {
    const m = /<li>\s*<strong>([\s\S]*?)<\/strong>\s*:\s*([\s\S]*?)<\/li>/i.exec(item)
    if (!m) continue
    let what = decodeEntities(m[2])
    let due = ''
    const d = /\s*\(by (\d{4}-\d{2}-\d{2})\)\s*$/.exec(what)
    if (d) {
      due = cleanDue(d[1])
      what = what.slice(0, d.index).trim()
    } else {
      // A date in words ("by Friday") stays in the text; it is not a date we can store
      what = what.trim()
    }
    const who = decodeEntities(m[1])
    if (what) out.push({ who, what, due })
  }
  return out
}

module.exports = { whoList, whoText, normalizeAction, matchName, matchNames, isEveryone, parseActionsHtml, cleanDue }
