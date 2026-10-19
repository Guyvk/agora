// Agora: the Ask tab of a circle, with a pretend server.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import AskPage from './AskPage'
import AskMenuLink from './AskMenuLink'

const answered = {
  id: '7',
  question: 'What did we decide last week?',
  answer: 'The circle decided to plant trees [1]. Members find refunds slow [2].',
  status: 'answered',
  sources: [
    { n: 1, type: 'post', title: 'Tree planting', url: '/groups/circle-a/post/12', date: '2026-10-14T10:00:00Z' },
    { n: 2, type: 'private_theme', title: 'From private conversations (anonymised)', url: null, date: null }
  ],
  sharedPostId: null,
  createdAt: '2026-10-19T10:00:00Z'
}

let calls
function fakeServer ({ status = { enabled: true, configured: true, capReached: false, groupId: '3', groupName: 'Circle A' }, history = [], statusCode = 200, askError = null } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined })
    const reply = (code, data) => ({ ok: code < 400, status: code, json: async () => data })
    if (url.endsWith('/status')) return statusCode === 200 ? reply(200, status) : reply(statusCode, { error: 'no' })
    if (url.endsWith('/history')) return reply(200, { questions: history })
    if (url.endsWith('/ask')) return askError ? reply(429, { error: askError, code: 'per_hour' }) : reply(200, { question: answered })
    if (url.includes('/share')) return reply(200, { postId: '99', alreadyShared: false })
    return reply(404, {})
  })
}

function renderPage () {
  useParams.mockReturnValue({ groupSlug: 'circle-a' })
  return render(<AskPage />, { wrapper: AllTheProviders({}, ['/groups/circle-a/ask']) })
}

describe('AskPage', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('shows the question box, suggested questions and the notice about Infomaniak in Switzerland', async () => {
    fakeServer()
    renderPage()
    expect(await screen.findByLabelText('Your question')).toBeInTheDocument()
    expect(screen.getByText('Which proposals are open?')).toBeInTheDocument()
    expect(screen.getByTestId('ask-notice')).toHaveTextContent("Infomaniak's AI in Switzerland")
  })

  it('asks, and shows the answer with numbered source chips; a private theme has no link', async () => {
    fakeServer()
    renderPage()
    fireEvent.change(await screen.findByLabelText('Your question'), { target: { value: 'What did we decide last week?' } })
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/ }))
    const card = await screen.findByTestId('ask-answer')
    expect(within(card).getByTestId('ask-answer-text')).toHaveTextContent('The circle decided to plant trees [1].')
    const ask = calls.find(c => c.url.endsWith('/ask'))
    expect(ask.url).toBe('/noo/agora/ask/api/circle-a/ask')
    expect(ask.body).toEqual({ question: 'What did we decide last week?' })
    expect(ask.options.headers['X-Agora']).toBe('1')
    const chips = within(card).getAllByTestId('ask-source-title')
    expect(chips.map(c => c.textContent)).toEqual(['Tree planting', 'From private conversations (anonymised)'])
    expect(chips[0].closest('a')).toHaveAttribute('href', '/groups/circle-a/post/12')
    expect(chips[1].closest('a')).toBeNull()
  })

  it('asks a suggested question with one click', async () => {
    fakeServer()
    renderPage()
    fireEvent.click(await screen.findByText('Which proposals are open?'))
    await screen.findByTestId('ask-answer')
    expect(calls.find(c => c.url.endsWith('/ask')).body).toEqual({ question: 'Which proposals are open?' })
  })

  it('shares an answer in the circle and then links to the post', async () => {
    fakeServer()
    renderPage()
    fireEvent.click(await screen.findByText('Which proposals are open?'))
    fireEvent.click(await screen.findByRole('button', { name: /Share this answer in the circle/ }))
    const link = await screen.findByText('Shared in the circle: open the post')
    expect(link.closest('a')).toHaveAttribute('href', '/groups/circle-a/post/99')
    expect(calls.find(c => c.url.includes('/share')).url).toBe('/noo/agora/ask/api/answers/7/share')
  })

  it('lists the person\'s own earlier questions as private', async () => {
    fakeServer({ history: [{ ...answered, id: '5', question: 'Who works on chapter 3?' }] })
    renderPage()
    expect(await screen.findByText('Who works on chapter 3?')).toBeInTheDocument()
    expect(screen.getByText('Only you can see these.')).toBeInTheDocument()
  })

  it('tells someone outside the circle that Ask is for members', async () => {
    fakeServer({ statusCode: 404 })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask is for members of this circle.')
  })

  it('says so when Ask is off, and when the budget is used up', async () => {
    fakeServer({ status: { enabled: false } })
    const { unmount } = renderPage()
    expect(await screen.findByText('Ask is not switched on in this Agora.')).toBeInTheDocument()
    unmount()
    fakeServer({ status: { enabled: true, configured: true, capReached: true, groupName: 'Circle A' } })
    renderPage()
    expect(await screen.findByText(/used up this month's budget/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your question')).toBeDisabled()
  })

  it('shows the server\'s message when a question is refused', async () => {
    fakeServer({ askError: 'You asked 20 questions in the last hour. Please wait a while.' })
    renderPage()
    fireEvent.click(await screen.findByText('Which proposals are open?'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('You asked 20 questions'))
  })
})

describe('AskMenuLink', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('shows the Ask line when Ask is on for this person', async () => {
    fakeServer()
    render(<AskMenuLink groupSlug='circle-a' />, { wrapper: AllTheProviders({}, ['/groups/circle-a']) })
    expect(await screen.findByRole('link', { name: /Ask/ })).toHaveAttribute('href', '/groups/circle-a/ask')
  })

  it('shows nothing when Ask is off or the person is not a member', async () => {
    fakeServer({ status: { enabled: false } })
    render(<AskMenuLink groupSlug='circle-a' />, { wrapper: AllTheProviders({}, ['/groups/circle-a']) })
    await waitFor(() => expect(calls.length).toBe(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('link', { name: /Ask/ })).not.toBeInTheDocument()
  })
})
