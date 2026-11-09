// Agora: a card dropped on the board must be saved. The board only saves a drop
// through its onMove prop, so the project page must pass it (it did not before).
import React from 'react'
import { render, waitFor } from 'util/testing/reactTestingLibraryExtended'
import TasksPanel from './TasksPanel'

let mockBoardProps
jest.mock('./TaskBoard', () => (props) => { mockBoardProps = props; return null })

const meta = { group: { id: '1', slug: 'g', name: 'Group' }, project: { id: '7', name: 'Garden' }, members: [], projects: [], canManage: false }
const task = { id: '11', groupId: '1', projectId: '7', title: 'Dig beds', description: '', status: 'todo', position: 1, dueDate: null, assignees: [], createdBy: { id: '1', name: 'A' }, source: null, commentCount: 0, canEdit: true }

it('gives the board a way to save a dropped card', async () => {
  const calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const path = url.replace('/noo/agora/tasks/api', '')
    if (path.startsWith('/list')) return { ok: true, status: 200, json: async () => ({ tasks: [task] }) }
    if (path.startsWith('/meta')) return { ok: true, status: 200, json: async () => meta }
    if (path.endsWith('/move')) return { ok: true, status: 200, json: async () => ({ task: { ...task, status: 'doing' } }) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  render(<TasksPanel projectId='7' />)
  await waitFor(() => expect(mockBoardProps && mockBoardProps.tasks.length).toBe(1), { timeout: 20000 })
  expect(typeof mockBoardProps.onMove).toBe('function')
  await mockBoardProps.onMove(task, 'doing', 2)
  expect(calls.some(c => c.url.endsWith('/11/move') && JSON.parse(c.options.body).status === 'doing')).toBe(true)
}, 60000)
