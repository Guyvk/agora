#!/usr/bin/env node
// Agora: keeps the "Agora build" board (GitHub Project 1 of Guyvk) in step with the real work.
//
//   node agora/board-sync.mjs                    show what would move (changes nothing)
//   node agora/board-sync.mjs --apply <commit>   move cards; <commit> = what the server runs now
//
// Rules:
// - A card whose issue has a linked pull request (open, draft or merged) goes to In review.
// - A card whose linked pull request is merged AND whose merge is inside <commit> goes to Live,
//   and the issue gets one comment saying since when it is live.
// - Cards never move back from Live, and cards without a linked pull request are left alone.
//
// GitHub closes an issue as soon as its pull request is merged, before the server is updated.
// That is why nothing on GitHub moves cards to Live by itself: Claude runs this script after
// every update of the server. It uses your own `gh` login (needs the `project` scope).

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const OWNER = 'Guyvk'
const REPO = 'Guyvk/agora'
const PROJECT_NUMBER = 1

export const COLUMNS = { todo: 'To do', doing: 'Doing', review: 'In review', live: 'Live' }

// Decide the column for one card. `isDeployed(oid)` tells whether a merge commit is on the server.
// Returns the new column name, or null to leave the card where it is.
export function decide (card, isDeployed) {
  if (card.status === COLUMNS.live) return null
  const prs = card.pullRequests || []
  if (prs.length === 0) return null
  const live = prs.some(pr => pr.state === 'MERGED' && pr.mergeCommit && isDeployed(pr.mergeCommit))
  if (live) return COLUMNS.live
  const linked = prs.some(pr => pr.state === 'OPEN' || pr.state === 'MERGED')
  if (linked && card.status !== COLUMNS.review) return COLUMNS.review
  return null
}

function gh (args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function graphql (query, vars = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`)
  return JSON.parse(gh(args)).data
}

function loadBoard () {
  const data = graphql(`query($owner:String!, $number:Int!) {
    user(login:$owner) { projectV2(number:$number) {
      id
      field(name:"Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
      items(first:100) { nodes {
        id
        fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content { ... on Issue {
          number title repository { nameWithOwner }
          closedByPullRequestsReferences(first:10, includeClosedPrs:true) {
            nodes { number state mergeCommit { oid } }
          }
        } }
      } }
    } }
  }`, { owner: OWNER, number: PROJECT_NUMBER })
  const project = data.user.projectV2
  const cards = project.items.nodes
    .filter(n => n.content && n.content.number && n.content.repository.nameWithOwner === REPO)
    .map(n => ({
      itemId: n.id,
      number: n.content.number,
      title: n.content.title,
      status: n.fieldValueByName ? n.fieldValueByName.name : null,
      pullRequests: n.content.closedByPullRequestsReferences.nodes.map(pr => ({
        number: pr.number, state: pr.state, mergeCommit: pr.mergeCommit ? pr.mergeCommit.oid : null
      }))
    }))
  return { projectId: project.id, field: project.field, cards }
}

function makeIsDeployed (deployed) {
  const cache = new Map()
  return oid => {
    if (!deployed) return false
    if (!cache.has(oid)) {
      let ok = false
      try {
        const status = gh(['api', `repos/${REPO}/compare/${oid}...${deployed}`, '--jq', '.status']).trim()
        ok = status === 'ahead' || status === 'identical'
      } catch (e) { ok = false }
      cache.set(oid, ok)
    }
    return cache.get(oid)
  }
}

function main () {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const deployed = args.find(a => !a.startsWith('--')) || null
  if (apply && !deployed) {
    console.error('Give the commit the server runs now, for example: node agora/board-sync.mjs --apply 53b4a90fc2')
    process.exit(1)
  }
  const { projectId, field, cards } = loadBoard()
  const optionId = name => field.options.find(o => o.name === name)?.id
  const isDeployed = makeIsDeployed(deployed)
  const today = new Date().toISOString().slice(0, 10)
  let moved = 0
  for (const card of cards) {
    const to = decide(card, isDeployed)
    if (!to) continue
    moved++
    console.log(`#${card.number} ${card.title}: ${card.status || '(none)'} -> ${to}`)
    if (!apply) continue
    gh(['project', 'item-edit', '--project-id', projectId, '--id', card.itemId,
      '--field-id', field.id, '--single-select-option-id', optionId(to)])
    if (to === COLUMNS.live) {
      gh(['issue', 'comment', String(card.number), '-R', REPO,
        '-b', `Live on Agora since ${today} (server update to ${deployed.slice(0, 10)}).`])
    }
  }
  console.log(moved ? `${moved} card(s) ${apply ? 'moved' : 'would move'}.` : 'Nothing to move.')
  if (!apply && moved) console.log('Run again with --apply <commit> to move them.')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
