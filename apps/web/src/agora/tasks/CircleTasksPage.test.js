// Agora: the circle's Tasks page, with a pretend server and a pretend group.
import React from 'react'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import CircleTasksPage from './CircleTasksPage'

jest.setTimeout(30000)
jest.mock('store/selectors/getGroupForSlug', () => () => ({ id: '1', slug: 'g', name: 'Group' }))

const meta = {
  group: { id: '1', slug: 'g', name: 'Group' },
  project: null,
  members: [{ id: '1', name: 'Demo Steward' }, { id: '2', name: 'Amara' }],
  projects: [{ id: '7', name: 'Garden' }, { id: '8', name: 'Kitchen' }],
  canManage: true
}
const base = { groupId: '1', groupSlug: 'g', groupName: 'Group', description: '', assignees: [], createdBy: { id: '1', name: 'Demo Steward' }, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', completedAt: null, source: null, commentCount: 0, canEdit: true, status: 'todo', position: 1, dueDate: null }
const dig = { ...base, id: '11', title: 'Dig beds', projectId: '7', projectName: 'Garden', assignees: [{ id: '1', name: 'Demo Steward', avatarUrl: null }] }
const bake = { ...base, id: '12', title: 'Bake bread', projectId: '8', projectName: 'Kitchen' }
const loose = { ...base, id: '13', title: 'Loose end', projectId: null, projectName: null }

let calls
function fakeServer () {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const path = url.replace('/noo/agora/tasks/api', '')
    const body = options.body ? JSON.parse(options.body) : null
    let data
    if (path.startsWith('/list')) data = { tasks: [dig, bake, loose] }
    else if (path.startsWith('/meta')) data = meta
    else if (path === '/create') data = { task: { ...base, id: '99', title: body.title, projectId: body.projectId || null, projectName: null } }
    else if (/^\/\d+$/.test(path)) data = { task: [dig, bake, loose].find(x => x.id === path.slice(1)), comments: [] }
    else return { ok: false, status: 404, json: async () => ({ error: 'Not found.' }) }
    return { ok: true, status: 200, json: async () => data }
  })
}

const renderPage = (path = '/groups/g/tasks') => render(<CircleTasksPage groupSlug='g' />, { wrapper: AllTheProviders({}, [path]) })
const filter = () => screen.getByLabelText('Show tasks of')

describe('CircleTasksPage', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('loads the tasks of the whole circle and shows each card\'s project', async () => {
    fakeServer()
    renderPage()
    const todo = await screen.findByTestId('column-todo')
    expect(within(todo).getByText('Dig beds')).toBeInTheDocument()
    expect(within(todo).getByText('Bake bread')).toBeInTheDocument()
    expect(within(todo).getByText('Garden')).toBeInTheDocument()
    expect(within(todo).getByText('No project')).toBeInTheDocument()
    expect(calls[0].url).toContain('groupId=1')
  })

  it('filters on a project and on No project', async () => {
    fakeServer()
    renderPage()
    await screen.findByTestId('column-todo')
    fireEvent.change(filter(), { target: { value: '8' } })
    expect(screen.queryByText('Dig beds')).toBeNull()
    expect(screen.getByText('Bake bread')).toBeInTheDocument()
    expect(screen.queryByTestId('task-project')).toBeNull()
    fireEvent.change(filter(), { target: { value: 'none' } })
    expect(screen.getByText('Loose end')).toBeInTheDocument()
    expect(screen.queryByText('Bake bread')).toBeNull()
  })

  it('filters on only mine', async () => {
    fakeServer()
    renderPage()
    await screen.findByTestId('column-todo')
    // the test user is not the logged-in user, so nothing of the pretend tasks is "mine"
    fireEvent.click(screen.getByLabelText('Only mine'))
    expect(screen.queryByText('Dig beds')).toBeNull()
    expect(screen.getByText('No tasks match this filter.')).toBeInTheDocument()
  })

  it('creates without a project in All and in No project, and in the chosen project otherwise', async () => {
    fakeServer()
    renderPage()
    const add = async title => {
      const input = within(await screen.findByTestId('column-todo')).getByPlaceholderText('Add a task…')
      fireEvent.change(input, { target: { value: title } })
      fireEvent.submit(input.closest('form'))
      await screen.findByText(title)
    }
    await add('One')
    fireEvent.change(filter(), { target: { value: 'none' } })
    await add('Two')
    fireEvent.change(filter(), { target: { value: '7' } })
    await add('Three')
    const created = calls.filter(c => c.url.endsWith('/create')).map(c => JSON.parse(c.options.body))
    expect(created[0]).toMatchObject({ groupId: '1', title: 'One' })
    expect(created[0].projectId).toBeUndefined()
    expect(created[1].projectId).toBeUndefined()
    expect(created[2]).toMatchObject({ groupId: '1', projectId: '7', title: 'Three' })
  })

  it('groups the list by project, No project last', async () => {
    fakeServer()
    renderPage()
    await screen.findByTestId('column-todo')
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    const groups = screen.getAllByTestId('project-group')
    expect(groups.map(g => g.querySelector('th').textContent)).toEqual(['Garden', 'Kitchen', 'No project'])
    expect(within(groups[2]).getByText('Loose end')).toBeInTheDocument()
  })

  it('opens the task named in the address in the side panel', async () => {
    fakeServer()
    renderPage('/groups/g/tasks?task=12')
    expect(await screen.findByLabelText('Task')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Bake bread')).toBeInTheDocument()
  })

  it('highlights the task from the address when the server sends number ids', async () => {
    const numbered = [dig, bake, loose].map(x => ({ ...x, id: Number(x.id) }))
    global.fetch = jest.fn(async (url) => {
      const path = url.replace('/noo/agora/tasks/api', '')
      if (path.startsWith('/list')) return { ok: true, status: 200, json: async () => ({ tasks: numbered }) }
      if (path.startsWith('/meta')) return { ok: true, status: 200, json: async () => meta }
      if (/^\/\d+$/.test(path)) return { ok: true, status: 200, json: async () => ({ task: numbered.find(x => x.id === Number(path.slice(1))), comments: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    renderPage('/groups/g/tasks?task=12')
    await screen.findByDisplayValue('Bake bread')
    await waitFor(() => {
      const card = document.querySelector('[data-testid="task-card"][data-task-id="12"]')
      expect(card.className).toContain('border-accent')
    }, { timeout: 10000 })
  })

  it('shows a quiet line, no red alert, when the viewer is not a member', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Tasks are for members of the circle.' }) }))
    renderPage()
    expect(await screen.findByText('Tasks are for members of this circle.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
