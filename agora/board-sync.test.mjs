// Agora: tests for agora/board-sync.mjs. Run: node --test agora/board-sync.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, COLUMNS } from './board-sync.mjs'

const deployed = new Set(['aaa'])
const isDeployed = oid => deployed.has(oid)

test('a card without a pull request stays where it is', () => {
  assert.equal(decide({ status: COLUMNS.todo, pullRequests: [] }, isDeployed), null)
})

test('an open or draft pull request moves the card to In review', () => {
  assert.equal(decide({ status: COLUMNS.todo, pullRequests: [{ state: 'OPEN' }] }, isDeployed), COLUMNS.review)
  assert.equal(decide({ status: COLUMNS.doing, pullRequests: [{ state: 'OPEN' }] }, isDeployed), COLUMNS.review)
})

test('a card already in In review is not moved again', () => {
  assert.equal(decide({ status: COLUMNS.review, pullRequests: [{ state: 'OPEN' }] }, isDeployed), null)
})

test('merged but not on the server yet stays In review', () => {
  const card = { status: COLUMNS.doing, pullRequests: [{ state: 'MERGED', mergeCommit: 'bbb' }] }
  assert.equal(decide(card, isDeployed), COLUMNS.review)
  assert.equal(decide({ ...card, status: COLUMNS.review }, isDeployed), null)
})

test('merged and on the server moves to Live', () => {
  const card = { status: COLUMNS.review, pullRequests: [{ state: 'MERGED', mergeCommit: 'aaa' }] }
  assert.equal(decide(card, isDeployed), COLUMNS.live)
})

test('a closed pull request that was not merged does not count', () => {
  assert.equal(decide({ status: COLUMNS.todo, pullRequests: [{ state: 'CLOSED' }] }, isDeployed), null)
})

test('a Live card never moves back', () => {
  assert.equal(decide({ status: COLUMNS.live, pullRequests: [{ state: 'OPEN' }] }, isDeployed), null)
})
