// Agora: the "Your tasks here" block on a circle's home page.
import React from 'react'
import { AllTheProviders, render, screen, waitFor } from 'util/testing/reactTestingLibraryExtended'
import YourTasksHere from './YourTasksHere'

const mk = (id, extra = {}) => ({ id: String(id), title: 'Task ' + id, status: 'todo', position: id, dueDate: null, ...extra })
const renderBlock = () => render(<YourTasksHere groupId='1' groupSlug='g' />, { wrapper: AllTheProviders({}, ['/groups/g']) })

describe('YourTasksHere', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('shows at most five open tasks, soonest due first, linking to the circle page', async () => {
    const tasks = [mk(1), mk(2, { status: 'done' }), mk(3, { dueDate: '2999-01-01' }), mk(4), mk(5), mk(6), mk(7, { dueDate: '2998-01-01' })]
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ tasks }) }))
    renderBlock()
    await screen.findByTestId('your-tasks-here')
    expect(global.fetch.mock.calls[0][0]).toContain('groupId=1&mine=1')
    const links = screen.getAllByRole('link')
    expect(links.map(l => l.textContent)).toEqual(['Task 7', 'Task 3', 'Task 1', 'Task 4', 'Task 5', 'All my tasks'])
    expect(links[0].getAttribute('href')).toEqual('/groups/g/tasks?task=7')
    expect(links[5].getAttribute('href')).toEqual('/my-tasks')
  })

  it('shows nothing when there are none', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ tasks: [mk(1, { status: 'done' })] }) }))
    renderBlock()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('your-tasks-here')).toBeNull()
  })

  it('shows nothing when the viewer is not a member', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'no' }) }))
    renderBlock()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('your-tasks-here')).toBeNull()
  })
})
