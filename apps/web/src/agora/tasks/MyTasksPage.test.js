// Agora: My tasks, with a pretend server.
import React from 'react'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import MyTasksPage, { sections } from './MyTasksPage'
import { addDays, today } from './api'

const base = { groupId: '1', groupSlug: 'g', groupName: 'Group', projectId: null, projectName: null, description: '', assignees: [{ id: '1', name: 'Me', avatarUrl: null }], createdBy: { id: '1', name: 'Me' }, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', completedAt: null, source: null, commentCount: 0, canEdit: true, status: 'todo', position: 1, dueDate: null }
const t0 = today()
const late = { ...base, id: '1', title: 'Late one', dueDate: addDays(t0, -3), projectId: '7', projectName: 'Garden' }
const soon = { ...base, id: '2', title: 'Soon one', dueDate: addDays(t0, 7), status: 'doing', position: 3 }
const later = { ...base, id: '3', title: 'Later one', dueDate: addDays(t0, 8) }
const undated = { ...base, id: '4', title: 'Undated one' }
const finished = { ...base, id: '5', title: 'Finished one', status: 'done', completedAt: '2026-11-05T10:00:00Z', position: 2 }
const all = [late, soon, later, undated, finished]

let calls
function fakeServer (tasks = all) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const path = url.replace('/noo/agora/tasks/api', '')
    const body = options.body ? JSON.parse(options.body) : null
    let data
    if (path === '/mine') data = { tasks }
    else if (path.startsWith('/meta')) data = { group: { id: '1' }, members: [], projects: [], canManage: true }
    else if (path.endsWith('/move')) data = { task: { ...tasks.find(x => x.id === path.split('/')[1]), status: body.status, position: body.position } }
    else if (/^\/\d+$/.test(path)) data = { task: tasks.find(x => x.id === path.slice(1)), comments: [] }
    else return { ok: false, status: 404, json: async () => ({ error: 'Not found.' }) }
    return { ok: true, status: 200, json: async () => data }
  })
}

describe('sections', () => {
  it('sorts tasks into the five sections', () => {
    const s = sections(all, t0)
    expect(s.overdue.map(x => x.id)).toEqual(['1'])
    expect(s.week.map(x => x.id)).toEqual(['2'])
    expect(s.later.map(x => x.id)).toEqual(['3'])
    expect(s.none.map(x => x.id)).toEqual(['4'])
    expect(s.done.map(x => x.id)).toEqual(['5'])
  })

  it('counts today as this week and keeps a done task out of Overdue', () => {
    const s = sections([{ ...base, id: '1', dueDate: t0 }, { ...base, id: '2', dueDate: addDays(t0, -1), status: 'done' }], t0)
    expect(s.week).toHaveLength(1)
    expect(s.overdue).toHaveLength(0)
  })
})

describe('MyTasksPage', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })
  const renderPage = () => render(<MyTasksPage />, { wrapper: AllTheProviders({}, ['/my-tasks']) })

  it('shows the sections in order with circle and project links', async () => {
    fakeServer()
    renderPage()
    await screen.findByTestId('my-tasks-overdue')
    const order = ['overdue', 'week', 'later', 'none', 'done'].map(k => screen.getByTestId('my-tasks-' + k))
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const row = within(order[0]).getByTestId('my-task-row')
    expect(within(row).getByText('Group').getAttribute('href')).toEqual('/groups/g/tasks')
    expect(within(row).getByText('Garden').getAttribute('href')).toContain('/post/7')
  })

  it('ticks a task off to Done and brings it back with Undo', async () => {
    fakeServer()
    renderPage()
    await screen.findByTestId('my-tasks-overdue')
    fireEvent.click(screen.getByLabelText('Mark Late one as done'))
    await waitFor(() => expect(within(screen.getByTestId('my-tasks-done')).getByText('Late one')).toBeInTheDocument())
    expect(screen.queryByTestId('my-tasks-overdue')).toBeNull()
    expect(JSON.parse(calls.find(c => c.url.endsWith('/1/move')).options.body).status).toEqual('done')
    fireEvent.click(await screen.findByRole('button', { name: 'Undo marking Late one as done' }))
    await waitFor(() => expect(screen.getByTestId('my-tasks-overdue')).toBeInTheDocument())
    const moves = calls.filter(c => c.url.endsWith('/1/move')).map(c => JSON.parse(c.options.body))
    expect(moves[1]).toEqual({ status: 'todo', position: 1 })
  })

  it('opens the side panel on a click', async () => {
    fakeServer()
    renderPage()
    fireEvent.click(await screen.findByText('Undated one'))
    expect(await screen.findByLabelText('Task')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Undated one')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    fakeServer([])
    renderPage()
    expect(await screen.findByText('No tasks for you yet.')).toBeInTheDocument()
  })
})
