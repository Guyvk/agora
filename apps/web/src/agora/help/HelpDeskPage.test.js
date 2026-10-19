// Agora: the Help desk page, with a pretend server.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import HelpDeskPage from './HelpDeskPage'

const request = {
  id: '7',
  title: 'Save fails',
  type: 'fault',
  urgency: 'urgent',
  status: 'new',
  mode: 'form',
  what_happened: 'Nothing saves',
  page_url: 'https://agora.example.org/groups/7bp',
  user_agent: 'Mozilla/5.0 (Test)',
  screen: '1440x900',
  app_version: 'abc1234',
  internal_note: '',
  builder_task: '',
  conversation: [],
  person: { id: '2', name: 'Amara', email: 'amara@agora.test' },
  replies: [],
  claude: false,
  created_at: '2026-10-19T08:00:00Z'
}

let calls
function fakeServer ({ forbidden = false } = {}) {
  calls = []
  const current = { ...request }
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined })
    const path = url.replace('/noo/agora/help/api', '')
    if (forbidden) return { ok: false, status: 403, json: async () => ({ error: 'The Help desk is for the people who run Agora.' }) }
    let body
    if (path.startsWith('/desk?') || path === '/desk') body = { requests: [{ id: '7', title: 'Save fails', type: 'fault', urgency: 'urgent', status: 'new', user_name: 'Amara', updated_at: '2026-10-19T08:00:00Z', unread: true }], counts: { new: 1, looking: 0, building: 0, fixed: 0, wont_do: 0 } }
    else if (path === '/desk/7') body = { request: current }
    else if (path === '/desk/7/build') {
      current.builder_task = JSON.parse(options.body).task
      body = { id: '7', builder_task: current.builder_task, by: 'admin', warning: null }
    } else if (path === '/desk/7/reply') body = { ok: true, emailed: true }
    else if (path === '/desk/7/update') body = { id: '7' }
    else return { ok: false, status: 404, json: async () => ({ error: 'This request does not exist.' }) }
    return { ok: true, status: 200, json: async () => body }
  })
}

function renderAt (requestId) {
  useParams.mockReturnValue(requestId ? { requestId } : {})
  return render(<HelpDeskPage />, { wrapper: AllTheProviders({}, ['/help-desk']) })
}

describe('HelpDeskPage', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('tells someone who is not an admin that the Help desk is not for them', async () => {
    fakeServer({ forbidden: true })
    renderAt(null)
    expect(await screen.findByText('The Help desk is for the people who run Agora.')).toBeInTheDocument()
  })

  it('lists the requests and filters them by status', async () => {
    fakeServer()
    renderAt(null)
    expect(await screen.findByText('Save fails')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'fixed' } })
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/desk?status=fixed'))).toBe(true))
  })

  it('shows a request with who sent it and the browser details', async () => {
    fakeServer()
    renderAt('7')
    expect(await screen.findByText('Nothing saves')).toBeInTheDocument()
    expect(screen.getByText(/amara@agora.test/)).toBeInTheDocument()
    expect(screen.getByText('Mozilla/5.0 (Test)')).toBeInTheDocument()
    expect(screen.getByText('abc1234')).toBeInTheDocument()
  })

  it('answers the person and changes the status', async () => {
    fakeServer()
    renderAt('7')
    await screen.findByText('Nothing saves')
    fireEvent.change(screen.getByLabelText('Answer the person'), { target: { value: 'We are on it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/desk/7/reply'))).toBeDefined())
    expect(calls.find(c => c.url.endsWith('/desk/7/reply')).body).toEqual({ body: 'We are on it' })
    expect(calls.find(c => c.url.endsWith('/desk/7/reply')).options.headers['X-Agora']).toBe('1')

    fireEvent.change(screen.getByLabelText('Status', { selector: '#agora-desk-status' }), { target: { value: 'looking' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/desk/7/update'))).toBeDefined())
    expect(calls.find(c => c.url.endsWith('/desk/7/update')).body).toMatchObject({ status: 'looking' })
  })

  it('stores a typed builder task with Build this, and copies it', async () => {
    fakeServer()
    const writeText = jest.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    renderAt('7')
    await screen.findByText('Nothing saves')
    expect(screen.getByRole('button', { name: /Build this/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Builder task'), { target: { value: 'Goal: saving works.' } })
    fireEvent.click(screen.getByRole('button', { name: /Build this/ }))
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/desk/7/build'))).toBeDefined())
    expect(calls.find(c => c.url.endsWith('/desk/7/build')).body).toEqual({ task: 'Goal: saving works.' })
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Goal: saving works.'))
  })
})
