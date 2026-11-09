/**
 * Agora: the Build page. It shows the public GitHub Project board "Agora build"
 * (https://github.com/users/Guyvk/projects/1) so the Tech Support circle can look
 * at it and move cards in meetings. Only the server talks to GitHub; the browser
 * never sees the key.
 *
 * Settings (see .env.example):
 *   AGORA_BUILD_CIRCLE         slug of the one circle whose members may use the page.
 *                              Not set: nobody sees the page.
 *   AGORA_GITHUB_BOARD_TOKEN   a classic GitHub token with only the `project` scope.
 *                              Not set: the page opens and says the board is not connected.
 *
 * One copy of the board is kept in memory for everybody, for 5 minutes. Refresh may
 * force a new copy at most once a minute. After a move the board is read again. If GitHub
 * fails, the last copy is shown with its age and a short warning.
 * The token is never logged and never sent to the browser.
 */
const GRAPHQL_URL = 'https://api.github.com/graphql'
const OWNER = 'Guyvk'
const PROJECT_NUMBER = 1
const BOARD_URL = `https://github.com/users/${OWNER}/projects/${PROJECT_NUMBER}`
const COLUMNS = ['To do', 'Doing', 'In review', 'Live']
const CACHE_MS = 5 * 60 * 1000
const FORCE_MS = 60 * 1000
const WENT_LIVE_DAYS = 14
const HELP_LINE = 80

class BuildError extends Error {
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

const knex = () => bookshelf.knex

const QUERY = `
query ($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      url
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
      items(first: 100) {
        nodes {
          id
          updatedAt
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId updatedAt } }
          owner: fieldValueByName(name: "Owner") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          circle: fieldValueByName(name: "Circle") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            ... on Issue {
              number title body state closedAt url
              closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { number state isDraft url } }
            }
          }
        }
      }
    }
  }
}`

const MOVE_MUTATION = `
mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) {
    projectV2Item { id }
  }
}`

/* ----------------------------------------------------------------------- */
/* Settings and who may use the page                                       */
/* ----------------------------------------------------------------------- */

const circleSlug = () => String(process.env.AGORA_BUILD_CIRCLE || '').trim()
const token = () => String(process.env.AGORA_GITHUB_BOARD_TOKEN || '').trim()

/** What the admin area shows: the circle (null when the page is off) and whether the token is set. */
function status () {
  return { circle: circleSlug() || null, connected: Boolean(token()) }
}

/** { allowed, circle }: allowed is true for an active member of the Build circle. */
async function access (userId) {
  const slug = circleSlug()
  if (!userId || !slug) return { allowed: false, circle: slug || null }
  const row = await knex()('group_memberships')
    .join('groups', 'groups.id', 'group_memberships.group_id')
    .where({ 'groups.slug': slug, 'group_memberships.user_id': userId, 'group_memberships.active': true, 'groups.active': true })
    .first('group_memberships.id')
  return { allowed: Boolean(row), circle: slug }
}

async function requireAccess (userId) {
  if (!userId) throw new BuildError(401, 'Please log in.')
  const { allowed } = await access(userId)
  if (!allowed) throw new BuildError(403, 'The Build page is not open to you.')
}

/* ----------------------------------------------------------------------- */
/* GitHub                                                                  */
/* ----------------------------------------------------------------------- */

async function graphql (query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'User-Agent': 'agora-build-page' },
    body: JSON.stringify({ query, variables })
  })
  const data = await res.json().catch(() => ({}))
  // The messages only say what went wrong in general: never the answer, never the token
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  if (data.errors && data.errors.length) throw new Error('GitHub refused the request')
  return data.data
}

function prState (pr) {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.state === 'CLOSED') return 'closed'
  return pr.isDraft ? 'draft' : 'open'
}

/** Turns GitHub's answer into plain cards. */
function normalize (data) {
  const project = data && data.user && data.user.projectV2
  if (!project) throw new Error('The board was not found')
  const field = project.field || {}
  const options = field.options || []
  const cards = []
  for (const node of project.items.nodes) {
    const issue = node.content
    if (!issue || !issue.number) continue // a note or a pull request on the board: not shown
    const prs = ((issue.closedByPullRequestsReferences || {}).nodes || []).map(p => ({ number: p.number, url: p.url, state: prState(p) }))
    const column = node.status && COLUMNS.includes(node.status.name) ? node.status.name : 'To do'
    cards.push({
      itemId: node.id,
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      url: issue.url,
      issueState: issue.state,
      closedAt: issue.closedAt || null,
      updatedAt: node.updatedAt,
      status: column,
      owner: node.owner ? node.owner.name : null,
      circle: node.circle ? node.circle.name : null,
      prs,
      mergedGoesLive: column === 'In review' && prs.some(p => p.state === 'merged')
    })
  }
  return { projectId: project.id, fieldId: field.id, options: options.map(o => ({ id: o.id, name: o.name })), cards }
}

/* ----------------------------------------------------------------------- */
/* The copy in memory                                                      */
/* ----------------------------------------------------------------------- */

let cache = null // { project, at }
let lastForced = 0

function resetCache () {
  cache = null
  lastForced = 0
}

/** Reads the board from GitHub into the copy. Throws when GitHub fails. */
async function readFromGitHub () {
  const project = normalize(await graphql(QUERY, { owner: OWNER, number: PROJECT_NUMBER }))
  cache = { project, at: Date.now() }
  return cache
}

/**
 * The copy to show: { copy, warning }. force asks for a new one, which is
 * allowed once a minute; a second ask within the minute gets the copy we have.
 */
async function currentCopy ({ force = false } = {}) {
  const now = Date.now()
  const fresh = cache && now - cache.at < CACHE_MS
  const mayForce = force && now - lastForced >= FORCE_MS
  if (fresh && !mayForce) return { copy: cache, warning: null }
  if (mayForce) lastForced = now
  try {
    return { copy: await readFromGitHub(), warning: null }
  } catch (err) {
    if (cache) return { copy: cache, warning: 'GitHub could not be reached, so this may be out of date.' }
    throw new BuildError(502, 'GitHub could not be reached. Try again in a minute.')
  }
}

/* ----------------------------------------------------------------------- */
/* What the page shows                                                     */
/* ----------------------------------------------------------------------- */

/**
 * Cards in Live that went live in the last 14 days, newest first. The date is
 * the card's updatedAt on the board (it changes when the card is moved to Live),
 * or else the issue's closedAt.
 */
function wentLive (cards, now = Date.now()) {
  const since = now - WENT_LIVE_DAYS * 24 * 3600 * 1000
  return cards
    .filter(c => c.status === 'Live')
    .map(c => ({ number: c.number, title: c.title, url: c.url, date: c.updatedAt || c.closedAt }))
    .filter(c => c.date && new Date(c.date).getTime() >= since)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

/** Help desk requests (new or looking) that no card mentions as `Help desk #<id>`. */
async function helpDeskNew (cards) {
  const text = cards.map(c => `${c.title}\n${c.body}`).join('\n')
  const mentioned = new Set()
  const re = /help desk #(\d+)/gi
  let m
  while ((m = re.exec(text))) mentioned.add(m[1])
  const rows = await knex()('agora_help_requests')
    .whereIn('status', ['new', 'looking'])
    .orderBy('created_at', 'desc')
    .limit(100)
    .select('id', 'type', 'title', 'created_at')
  return rows
    .filter(r => !mentioned.has(String(r.id)))
    .slice(0, 20)
    .map(r => ({
      id: String(r.id),
      type: r.type,
      text: String(r.title || '').slice(0, HELP_LINE),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null
    }))
}

async function present ({ copy, warning }) {
  const cards = copy.project.cards
  return {
    configured: true,
    boardUrl: BOARD_URL,
    columns: COLUMNS.map(name => ({ name, cards: cards.filter(c => c.status === name).sort((a, b) => a.number - b.number) })),
    wentLive: wentLive(cards),
    helpDesk: await helpDeskNew(cards),
    fetchedAt: new Date(copy.at).toISOString(),
    ageSeconds: Math.round((Date.now() - copy.at) / 1000),
    warning
  }
}

/** The board for a member of the Build circle. force: the Refresh button. */
async function board (userId, { force = false } = {}) {
  await requireAccess(userId)
  if (!token()) return { configured: false, boardUrl: BOARD_URL, columns: [], wentLive: [], helpDesk: [] }
  return present(await currentCopy({ force }))
}

/** Moves a card (by its item id on the board) to a column, then reads the board again. */
async function move (userId, { itemId, status: target } = {}) {
  await requireAccess(userId)
  if (!token()) throw new BuildError(409, 'The board is not connected yet.')
  if (!COLUMNS.includes(target)) throw new BuildError(400, 'That column does not exist.')
  const { copy } = await currentCopy()
  const project = copy.project
  if (!project.cards.some(c => c.itemId === itemId)) throw new BuildError(404, 'This card is not on the board.')
  const option = project.options.find(o => o.name === target)
  if (!option || !project.fieldId) throw new BuildError(409, 'The board has no column with that name.')
  try {
    await graphql(MOVE_MUTATION, { project: project.projectId, item: itemId, field: project.fieldId, option: option.id })
  } catch (err) {
    throw new BuildError(502, 'The card could not be moved. Try again in a minute.')
  }
  try {
    await readFromGitHub()
  } catch (err) {
    cache = null // the copy is now wrong: the next look reads again
    throw new BuildError(502, 'The card was moved, but the board could not be read again. Press Refresh.')
  }
  return present({ copy: cache, warning: null })
}

module.exports = { BuildError, COLUMNS, BOARD_URL, status, access, board, move, wentLive, resetCache }
