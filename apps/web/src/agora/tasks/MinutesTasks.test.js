// Agora: the Action points box under minutes, "From the minutes, for you" on My tasks, and the
// "Open tasks from last time" block (fetch is mocked).
import React from 'react'
import userEvent from '@testing-library/user-event'
import { AllTheProviders, render, screen, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import MinutesActionPoints from './MinutesActionPoints'
import MinutesTasksForYou from './MinutesTasksForYou'
import OpenTasksFromLastTime from './OpenTasksFromLastTime'
import PostTaskBlocks from './PostTaskBlocks'

const person = (id, name, extra = {}) => ({ id, name, avatarUrl: null, status: 'suggested', ...extra })
const point = (id, extra = {}) => ({
  id, groupId: 1, groupSlug: 'g', groupName: 'G', meetingSessionId: 5, minutesPostId: 9, meeting: { title: 'Weekly', date: '2026-11-02' },
  actionIndex: id, whoText: 'Mariam', what: 'Task ' + id, dueDate: null, projectId: null, projectName: null, status: 'open', taskId: null, taskStatus: null,
  people: [person(7, 'Mariam', { me: true })], canDecide: true, ...extra
})
const meta = { members: [{ id: 7, name: 'Mariam' }, { id: 8, name: 'Zenab' }], projects: [{ id: 3, name: 'Website' }], canManage: true }

function mockServer (routes) {
  global.fetch = jest.fn(async (url, options = {}) => {
    const key = (options.method || 'GET') + ' ' + String(url).replace('/noo/agora/tasks/api', '')
    const hit = Object.keys(routes).find(k => key === k || key.startsWith(k + '?'))
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: 'no route ' + key }) }
    const r = routes[hit]
    const out = typeof r === 'function' ? r(options.body ? JSON.parse(options.body) : undefined) : r
    return out.status ? { ok: out.status < 400, status: out.status, json: async () => out.body } : { ok: true, status: 200, json: async () => out }
  })
}
const wrap = { wrapper: AllTheProviders({}, ['/post/9']) }

describe('Action points on a minutes post', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('shows nothing for a post that is not a minutes post, or has no action points', async () => {
    mockServer({ 'GET /suggestions': { isMinutes: false, suggestions: [], canAcceptAll: false } })
    const { rerender } = render(<MinutesActionPoints postId='9' />, wrap)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('action-points')).toBeNull()
    mockServer({ 'GET /suggestions': { isMinutes: true, suggestions: [], canAcceptAll: true } })
    rerender(<MinutesActionPoints postId='10' />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('action-points')).toBeNull()
  })

  it('shows nothing when the server refuses (not in the circle)', async () => {
    mockServer({ 'GET /suggestions': { status: 404, body: { error: 'no' } } })
    render(<MinutesActionPoints postId='9' />, wrap)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('action-points')).toBeNull()
  })

  it('adds a point as a task with the people, date and project that were chosen, then shows "Task added" with a link', async () => {
    const accepted = jest.fn()
    mockServer({
      'GET /suggestions': { isMinutes: true, canAcceptAll: false, suggestions: [point(1)] },
      'GET /meta': meta,
      'POST /suggestions/1/accept': body => { accepted(body); return { suggestion: point(1, { status: 'accepted', taskId: 40, taskStatus: 'todo', canDecide: false }), task: { id: 40 } } }
    })
    render(<MinutesActionPoints postId='9' />, wrap)
    const row = await screen.findByTestId('action-point')
    expect(within(row).getByText('Task 1')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Project')).toBeInTheDocument())
    await waitFor(() => expect(within(row).getByRole('option', { name: 'Website' })).toBeInTheDocument())
    await userEvent.selectOptions(within(row).getByLabelText('Add a person to Task 1'), '8')
    await userEvent.selectOptions(within(row).getByLabelText('Project'), '3')
    await userEvent.click(within(row).getByRole('button', { name: 'Add as task' }))
    await waitFor(() => expect(accepted).toHaveBeenCalledWith({ assigneeIds: ['7', '8'], dueDate: null, projectId: '3' }))
    const added = await screen.findByTestId('task-added')
    expect(added.textContent).toContain('Task added')
    expect(added.textContent).toContain('not done yet')
    expect(within(added).getByRole('link', { name: 'Open the task' }).getAttribute('href')).toEqual('/groups/g/tasks?task=40')
    expect(screen.queryByRole('button', { name: 'Add as task' })).toBeNull()
  })

  it('says "Not a task", and shows a done task as done', async () => {
    mockServer({
      'GET /suggestions': { isMinutes: true, canAcceptAll: false, suggestions: [point(1), point(2, { status: 'accepted', taskId: 41, taskStatus: 'done', canDecide: false })] },
      'GET /meta': meta,
      'POST /suggestions/1/dismiss': { suggestion: point(1, { status: 'dismissed', canDecide: false }) }
    })
    render(<MinutesActionPoints postId='9' />, wrap)
    await screen.findAllByTestId('action-point')
    expect(screen.getByTestId('task-added').textContent).toContain('done')
    expect(screen.getByTestId('task-added').textContent).not.toContain('not done')
    await userEvent.click(screen.getByRole('button', { name: 'Not a task' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Not a task' })).toBeNull())
    expect(screen.getByText('Not a task')).toBeInTheDocument() // the row now says so
  })

  it('shows Add all only to the host and stewards, and applies the answer', async () => {
    const all = jest.fn()
    const list = canAcceptAll => ({ isMinutes: true, canAcceptAll, suggestions: [point(1), point(2)] })
    mockServer({
      'GET /suggestions': list(true),
      'GET /meta': meta,
      'POST /suggestions/accept-all': body => { all(body); return { suggestions: [point(1, { status: 'accepted', taskId: 50, taskStatus: 'todo', canDecide: false }), point(2, { status: 'accepted', taskId: 51, taskStatus: 'todo', canDecide: false })], tasks: [] } }
    })
    const { unmount } = render(<MinutesActionPoints postId='9' />, wrap)
    await userEvent.click(await screen.findByRole('button', { name: 'Add all' }))
    await waitFor(() => expect(all).toHaveBeenCalledWith({ minutesPostId: '9' }))
    await waitFor(() => expect(screen.getAllByTestId('task-added')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: 'Add all' })).toBeNull()
    unmount()

    mockServer({ 'GET /suggestions': list(false), 'GET /meta': meta })
    render(<MinutesActionPoints postId='9' />, wrap)
    await screen.findAllByTestId('action-point')
    expect(screen.queryByRole('button', { name: 'Add all' })).toBeNull()
  })

  it('gives someone who cannot decide a read-only row', async () => {
    mockServer({ 'GET /suggestions': { isMinutes: true, canAcceptAll: false, suggestions: [point(1, { canDecide: false })] } })
    render(<MinutesActionPoints postId='9' />, wrap)
    await screen.findByTestId('action-point')
    expect(screen.queryByRole('button', { name: 'Add as task' })).toBeNull()
    expect(screen.getByText('Waiting for a decision')).toBeInTheDocument()
    expect(global.fetch.mock.calls.some(c => String(c[0]).includes('/meta'))).toBe(false)
  })

  it('shows an error from the server', async () => {
    mockServer({
      'GET /suggestions': { isMinutes: true, canAcceptAll: false, suggestions: [point(1)] },
      'GET /meta': meta,
      'POST /suggestions/1/accept': { status: 409, body: { error: 'This action point was already decided.' } }
    })
    render(<MinutesActionPoints postId='9' />, wrap)
    await userEvent.click(await screen.findByRole('button', { name: 'Add as task' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already decided')
  })
})

describe('From the minutes, for you', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('is hidden when there is nothing', async () => {
    mockServer({ 'GET /suggestions/mine': { suggestions: [] } })
    render(<MinutesTasksForYou />, wrap)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('minutes-for-you')).toBeNull()
  })

  it('adds a point to my tasks and lets the server keep everyone who is named', async () => {
    const accepted = jest.fn()
    const onAdded = jest.fn()
    mockServer({
      'GET /suggestions/mine': { suggestions: [point(1, { people: [person(8, 'Zenab'), person(7, 'Mariam', { me: true })] }), point(2)] },
      'POST /suggestions/1/accept': body => { accepted(body); return { suggestion: {}, task: { id: 60, title: 'Task 1' } } }
    })
    render(<MinutesTasksForYou onAdded={onAdded} />, wrap)
    const rows = await screen.findAllByTestId('minutes-for-you-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('link', { name: 'Weekly' }).getAttribute('href')).toEqual('/post/9')
    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Add to my tasks' }))
    await waitFor(() => expect(accepted).toHaveBeenCalledWith({}))
    expect(onAdded).toHaveBeenCalledWith({ id: 60, title: 'Task 1' })
    await waitFor(() => expect(screen.getAllByTestId('minutes-for-you-row')).toHaveLength(1))
  })

  it('takes me off with Not mine, and hides the section when the last one is gone', async () => {
    const called = jest.fn()
    mockServer({
      'GET /suggestions/mine': { suggestions: [point(2)] },
      'POST /suggestions/2/not-mine': () => { called(); return { suggestion: {} } }
    })
    render(<MinutesTasksForYou />, wrap)
    await userEvent.click(await screen.findByRole('button', { name: 'Not mine' }))
    await waitFor(() => expect(called).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('minutes-for-you')).toBeNull())
  })
})

describe('Open tasks from last time', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('lists the open tasks, linking to the circle page', async () => {
    mockServer({ 'GET /suggestions/last-time': { minutesPostId: 9, tasks: [{ id: 4, title: 'Call the venue', groupSlug: 'g', dueDate: '2026-12-01', assignees: [{ id: 7, name: 'Mariam', avatarUrl: null }] }] } })
    render(<OpenTasksFromLastTime postId='20' />, wrap)
    const link = await screen.findByRole('link', { name: 'Call the venue' })
    expect(link.getAttribute('href')).toEqual('/groups/g/tasks?task=4')
    expect(global.fetch.mock.calls[0][0]).toContain('eventPostId=20')
  })

  it('is hidden when there are none or the call fails', async () => {
    mockServer({ 'GET /suggestions/last-time': { minutesPostId: null, tasks: [] } })
    const { unmount } = render(<OpenTasksFromLastTime postId='20' />, wrap)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('open-from-last-time')).toBeNull()
    unmount()
    mockServer({ 'GET /suggestions/last-time': { status: 404, body: { error: 'no' } } })
    render(<OpenTasksFromLastTime postId='20' />, wrap)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('open-from-last-time')).toBeNull()
  })
})

describe('PostTaskBlocks', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('asks for action points on a discussion, open tasks on an event, and nothing on other posts', async () => {
    mockServer({ 'GET /suggestions': { isMinutes: false, suggestions: [] }, 'GET /suggestions/last-time': { tasks: [] } })
    const { rerender } = render(<PostTaskBlocks post={{ id: '1', type: 'discussion' }} />, wrap)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(String(global.fetch.mock.calls[0][0])).toContain('/suggestions?minutesPostId=1')
    rerender(<PostTaskBlocks post={{ id: '2', type: 'event' }} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(String(global.fetch.mock.calls[1][0])).toContain('/suggestions/last-time?eventPostId=2')
    rerender(<PostTaskBlocks post={{ id: '3', type: 'request' }} />)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
