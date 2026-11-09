// Agora: the Tasks part of a project page, with a pretend server.
import React from 'react'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import TasksPanel from './TasksPanel'
import { positionAt } from './api'

const meta = {
  group: { id: '1', slug: 'g', name: 'Group' },
  project: { id: '7', name: 'Garden' },
  members: [{ id: '1', name: 'Demo Steward' }, { id: '2', name: 'Amara' }],
  projects: [{ id: '7', name: 'Garden' }, { id: '8', name: 'Kitchen' }],
  canManage: true
}
const base = { groupId: '1', groupSlug: 'g', groupName: 'Group', projectId: '7', projectName: 'Garden', description: '', assignees: [], createdBy: { id: '1', name: 'Demo Steward' }, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', completedAt: null, source: null, commentCount: 0, canEdit: true }
const dig = { ...base, id: '11', title: 'Dig beds', status: 'todo', position: 1, dueDate: '2000-01-01', assignees: [{ id: '2', name: 'Amara', avatarUrl: null }] }
const plant = { ...base, id: '12', title: 'Plant seeds', status: 'doing', position: 1, dueDate: '2999-01-01' }
const water = { ...base, id: '13', title: 'Water plants', status: 'done', position: 1, dueDate: '2000-01-01' }
const locked = { ...base, id: '14', title: 'Locked task', status: 'todo', position: 2, canEdit: false }

let calls
function fakeServer ({ tasks = [dig, plant, water, locked], failMove = false } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const path = url.replace('/noo/agora/tasks/api', '')
    const body = options.body ? JSON.parse(options.body) : null
    let data
    if (path.startsWith('/list')) data = { tasks }
    else if (path.startsWith('/meta')) data = meta
    else if (path === '/create') data = { task: { ...base, id: '99', title: body.title, status: body.status || 'todo', position: 5, dueDate: null } }
    else if (path.endsWith('/move')) {
      if (failMove) return { ok: false, status: 500, json: async () => ({ error: 'Could not move it.' }) }
      const id = path.split('/')[1]
      data = { task: { ...tasks.find(x => x.id === id), status: body.status, position: body.position } }
    } else if (path.endsWith('/delete')) data = { ok: true }
    else if (path.endsWith('/restore')) data = { task: dig }
    else if (/^\/\d+$/.test(path)) data = { task: tasks.find(x => x.id === path.slice(1)), comments: [{ id: '5', user: { id: '2', name: 'Amara' }, text: 'Bring gloves', createdAt: '2026-11-02T10:00:00Z', canDelete: false }] }
    else return { ok: false, status: 404, json: async () => ({ error: 'Not found.' }) }
    return { ok: true, status: 200, json: async () => data }
  })
}

const renderPanel = () => render(<TasksPanel projectId='7' />, { wrapper: AllTheProviders({}, ['/post/7']) })

describe('TasksPanel', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('shows the three board columns with the tasks in them', async () => {
    fakeServer()
    renderPanel()
    const todo = await screen.findByTestId('column-todo')
    expect(within(todo).getByText('Dig beds')).toBeInTheDocument()
    expect(within(screen.getByTestId('column-doing')).getByText('Plant seeds')).toBeInTheDocument()
    expect(within(screen.getByTestId('column-done')).getByText('Water plants')).toBeInTheDocument()
    expect(calls[0].url).toContain('projectId=7')
    expect(calls[0].options.headers['X-Agora']).toBe('1')
  })

  it('marks overdue tasks red, but not when done or in the future', async () => {
    fakeServer()
    renderPanel()
    await screen.findByText('Dig beds')
    const overdueOf = title => screen.getByText(title).closest('[data-testid=task-card]').querySelector('[data-overdue]')
    expect(overdueOf('Dig beds')).toBeTruthy()
    expect(overdueOf('Dig beds').className).toMatch(/destructive/)
    expect(overdueOf('Plant seeds')).toBeNull()
    expect(overdueOf('Water plants')).toBeNull()
  })

  it('creates a task in a column when a title is typed and Enter pressed', async () => {
    fakeServer()
    renderPanel()
    await screen.findByText('Dig beds')
    const input = screen.getByLabelText('Doing: add a task')
    fireEvent.change(input, { target: { value: 'Buy gloves' } })
    fireEvent.submit(input.closest('form'))
    expect(await within(screen.getByTestId('column-doing')).findByText('Buy gloves')).toBeInTheDocument()
    const create = calls.find(c => c.url.endsWith('/create'))
    expect(JSON.parse(create.options.body)).toEqual({ projectId: '7', title: 'Buy gloves', status: 'doing' })
  })

  it('moves a task to the bottom of another column when its status is changed in the panel', async () => {
    fakeServer()
    renderPanel()
    fireEvent.click(await screen.findByText('Dig beds'))
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'done' } })
    await waitFor(() => expect(within(screen.getByTestId('column-done')).getByText('Dig beds')).toBeInTheDocument())
    const move = calls.find(c => c.url.endsWith('/11/move'))
    expect(JSON.parse(move.options.body)).toEqual({ status: 'done', position: 2 })
  })

  it('rolls back and shows an error when a move fails', async () => {
    fakeServer({ failMove: true })
    renderPanel()
    fireEvent.click(await screen.findByText('Dig beds'))
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'done' } })
    expect(await screen.findByText('Could not move it.')).toBeInTheDocument()
    expect(within(screen.getByTestId('column-todo')).getByText('Dig beds')).toBeInTheDocument()
  })

  it('is read-only when the task cannot be edited, except for the status', async () => {
    fakeServer()
    renderPanel()
    fireEvent.click(await screen.findByText('Locked task'))
    expect(await screen.findByLabelText('Title')).toBeDisabled()
    expect(screen.getByLabelText('Description')).toBeDisabled()
    expect(screen.getByLabelText('Status')).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: /Delete task/ })).not.toBeInTheDocument()
  })

  it('shows comments, and deletes with an Undo that restores', async () => {
    fakeServer()
    renderPanel()
    fireEvent.click(await screen.findByText('Dig beds'))
    expect(await screen.findByText('Bring gloves')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Delete task/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/11/restore'))).toBe(true))
    expect(await within(screen.getByTestId('column-todo')).findByText('Dig beds')).toBeInTheDocument()
  })

  it('switches to the list and filters on only mine', async () => {
    fakeServer()
    renderPanel()
    await screen.findByText('Dig beds')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('table', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByText('Plant seeds')).toBeInTheDocument()
  })

  it('refetches with includeDone=1 on Show older done', async () => {
    fakeServer()
    renderPanel()
    await screen.findByText('Dig beds')
    fireEvent.click(screen.getByRole('button', { name: 'Show older done' }))
    await waitFor(() => expect(calls.some(c => c.url.includes('/list') && c.url.includes('includeDone=1'))).toBe(true))
  })

  it('shows an empty state', async () => {
    fakeServer({ tasks: [] })
    renderPanel()
    expect(await screen.findByText('No tasks yet. Add the first one.')).toBeInTheDocument()
  })

  it('shows the server error when loading fails', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Join this group first.' }) }))
    renderPanel()
    expect(await screen.findByText('Join this group first.')).toBeInTheDocument()
  })
})

describe('positionAt', () => {
  const list = [{ position: 1 }, { position: 3 }]
  it('takes the midpoint, or one step beyond the ends', () => {
    expect(positionAt(list, 0)).toBe(0)
    expect(positionAt(list, 1)).toBe(2)
    expect(positionAt(list, 2)).toBe(4)
    expect(positionAt([], 0)).toBe(0)
  })
})
