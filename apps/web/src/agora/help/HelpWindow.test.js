// Agora: the Help window, with a pretend server.
import React, { act } from 'react'
import { useLocation } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import HelpWindow from './HelpWindow'
import { openHelp } from './openHelp'

const baseStatus = {
  claude: false,
  isAdmin: false,
  unread: 0,
  types: ['fault', 'wish', 'question'],
  urgencies: ['low', 'normal', 'urgent'],
  statuses: ['new', 'looking', 'building', 'fixed', 'wont_do']
}

let calls
function fakeServer ({ status = {}, chat = [] } = {}) {
  calls = []
  const chatAnswers = [...chat]
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined })
    const path = url.replace('/noo/agora/help/api', '')
    let body
    if (path === '/status') body = { ...baseStatus, ...status }
    else if (path === '/create') body = { id: '7' }
    else if (path === '/chat') body = chatAnswers.shift()
    else if (path === '/mine') body = { requests: [{ id: '7', title: 'Save fails', type: 'fault', status: 'looking', created_at: '2026-10-19T08:00:00Z', unread: true }] }
    else if (path === '/mine/7') body = { request: { id: '7', title: 'Save fails', type: 'fault', status: 'looking', what_happened: 'Nothing saves', conversation: [], replies: [{ id: '1', body: 'We are on it', from_desk: true, created_at: '2026-10-19T09:00:00Z' }] } }
    else return { ok: false, status: 404, json: async () => ({ error: 'This request does not exist.' }) }
    return { ok: true, status: 200, json: async () => body }
  })
}

function renderWindow () {
  return render(<HelpWindow />, { wrapper: AllTheProviders({}, ['/groups/7bp']) })
}

async function openWindow () {
  fireEvent.click(await screen.findByTestId('agora-help-button'))
}

// The window opens on the Guide; "Still stuck? Tell us" leads to the form or the chat
async function openRequest () {
  await openWindow()
  fireEvent.click(screen.getByRole('button', { name: 'Still stuck? Tell us' }))
}

describe('HelpWindow', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('opens on the guide, with its parts in order, a search and the way to the form', async () => {
    fakeServer()
    renderWindow()
    await openWindow()
    const list = screen.getByRole('list', { name: 'Agora guide' })
    expect(within(list).getAllByRole('button').map(b => b.textContent.trim())).toEqual([
      'What Agora is',
      'Circles',
      'Posts, discussions and proposals',
      'Events and meetings',
      'Files',
      'Playbook',
      'Contacts',
      'Notifications and email',
      'Your profile',
      'Getting help',
      'Rules and privacy'
    ])
    expect(screen.queryByLabelText('What happened?')).not.toBeInTheDocument()

    // The search looks in the titles and in what the parts say
    fireEvent.change(screen.getByLabelText('Search the guide'), { target: { value: 'headphones' } })
    expect(within(screen.getByRole('list', { name: 'Agora guide' })).getAllByRole('button').map(b => b.textContent.trim())).toEqual(['Events and meetings'])
    fireEvent.change(screen.getByLabelText('Search the guide'), { target: { value: 'spaceship' } })
    expect(screen.getByText(/Nothing in the guide matches/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search the guide'), { target: { value: 'meeting' } })

    // A part shows its text in the window, with a link to the full guide
    fireEvent.click(screen.getByRole('button', { name: 'Events and meetings' }))
    const part = screen.getByTestId('help-guide-part')
    expect(within(part).getByText(/Video meeting in Agora \(with minutes\)/)).toBeInTheDocument()
    expect(within(part).getByText(/A guest link/)).toBeInTheDocument()
    expect(within(part).getByRole('link', { name: 'Open the full guide' })).toHaveAttribute('href', '/guide#events')
    fireEvent.click(screen.getByRole('button', { name: /Back to the guide/ }))
    expect(screen.getByRole('list', { name: 'Agora guide' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Still stuck? Tell us' }))
    expect(screen.getByLabelText('What happened?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Guide/ }))
    expect(screen.getByLabelText('Search the guide')).toBeInTheDocument()
  })

  it('opens from other pages with openHelp, on a part of the guide or on the form', async () => {
    fakeServer()
    renderWindow()
    await screen.findByTestId('agora-help-button')
    act(() => openHelp({ view: 'guide', part: 'contacts' }))
    expect(within(screen.getByTestId('help-guide-part')).getByRole('heading')).toHaveTextContent('Contacts')
    expect(screen.getByRole('link', { name: 'Open the full guide' })).toHaveAttribute('href', '/guide#contacts')

    act(() => openHelp({ view: 'new' }))
    expect(screen.getByLabelText('What happened?')).toBeInTheDocument()

    // "Open Help" in the guide's Getting help part goes to the form
    act(() => openHelp({ view: 'guide', part: 'help' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Help' }))
    expect(screen.getByLabelText('What happened?')).toBeInTheDocument()

    act(() => openHelp({ view: 'mine' }))
    expect(await screen.findByText('Save fails')).toBeInTheDocument()
  })

  it('closes when a link in the guide is followed', async () => {
    fakeServer()
    renderWindow()
    await openWindow()
    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }))
    fireEvent.click(screen.getByRole('link', { name: 'Open Contacts' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('agora-help-button')).toBeInTheDocument()
  })

  it('sends the plain form with the page, browser and screen, when there is no Claude key', async () => {
    fakeServer()
    renderWindow()
    await openRequest()
    expect(screen.queryByText(/go to Claude/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'The save button does nothing' } })
    fireEvent.change(screen.getByLabelText('How urgent is it?'), { target: { value: 'urgent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText(/Your request is with the team/)).toBeInTheDocument()
    const sent = calls.find(c => c.url.endsWith('/create'))
    expect(sent.options.method).toBe('POST')
    expect(sent.options.headers['X-Agora']).toBe('1')
    expect(sent.body).toMatchObject({ type: 'fault', urgency: 'urgent', what_happened: 'The save button does nothing' })
    expect(sent.body.context).toHaveProperty('page')
    expect(sent.body.context).toHaveProperty('userAgent')
    expect(sent.body.context).toHaveProperty('screen')
  })

  it('asks for a description before sending', async () => {
    fakeServer()
    renderWindow()
    await openRequest()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please describe what happened')
    expect(calls.find(c => c.url.endsWith('/create'))).toBeUndefined()
  })

  it('with a Claude key, says the messages go to Claude and offers the plain form', async () => {
    fakeServer({ status: { claude: true }, chat: [{ chatId: '3', reply: 'Ask a steward for an invitation.', filed: null }] })
    renderWindow()
    await openRequest()
    expect(screen.getByText('Your messages go to Claude (Anthropic) to be answered.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'How do I join a circle?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Ask a steward for an invitation.')).toBeInTheDocument()
    expect(calls.find(c => c.url.endsWith('/chat')).body).toMatchObject({ chatId: null, message: 'How do I join a circle?' })

    fireEvent.click(screen.getByRole('button', { name: 'Use the plain form instead' }))
    expect(screen.getByLabelText('What happened?')).toBeInTheDocument()
  })

  it('falls back to the plain form, with what was written, when Claude cannot answer', async () => {
    fakeServer({ status: { claude: true }, chat: [{ fallback: true, reason: 'error' }] })
    renderWindow()
    await openRequest()
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Saving fails' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/Claude could not answer just now/)).toBeInTheDocument()
    expect(screen.getByLabelText('What happened?')).toHaveValue('Saving fails')
  })

  it('shows when Claude filed the request', async () => {
    fakeServer({ status: { claude: true }, chat: [{ chatId: '3', reply: 'I passed it on.', filed: { id: '7', title: 'Save fails' } }] })
    renderWindow()
    await openRequest()
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Saving fails' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Sent to the team as a request: Save fails')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See my request' }))
    expect(await screen.findByText('We are on it')).toBeInTheDocument()
  })

  it('shows new answers on the button and under My requests', async () => {
    fakeServer({ status: { unread: 1 } })
    renderWindow()
    const button = await screen.findByTestId('agora-help-button')
    expect(button).toHaveTextContent('1')
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: /My requests/ }))
    expect(await screen.findByText('New answer')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Save fails'))
    expect(await screen.findByText('We are on it')).toBeInTheDocument()
    expect(screen.getByText('Nothing saves')).toBeInTheDocument()
  })

  it('sits higher on chat pages, above the send button', async () => {
    fakeServer()
    useLocation.mockReturnValue({ pathname: '/groups/7bp/chat/general', search: '' })
    try {
      renderWindow()
      expect(await screen.findByTestId('agora-help-button')).toHaveClass('bottom-28')
    } finally {
      useLocation.mockReturnValue({ pathname: '', search: '' })
    }
  })

  it('shows the way to the Help desk only to its admins', async () => {
    fakeServer()
    const { unmount } = renderWindow()
    await openWindow()
    expect(screen.queryByRole('button', { name: 'Help desk' })).not.toBeInTheDocument()
    unmount()

    fakeServer({ status: { isAdmin: true } })
    renderWindow()
    await openWindow()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Help desk' })).toBeInTheDocument())
  })
})
