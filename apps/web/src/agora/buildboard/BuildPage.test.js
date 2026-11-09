// Agora: the Build page and its menu line, with a pretend server.
import React from 'react'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import BuildPage from './BuildPage'
import BuildMenuLink from './BuildMenuLink'
import { resetAccess } from './api'

jest.setTimeout(180000)
const WAIT = { timeout: 90000 }

const card = (itemId, number, status, extra = {}) => ({
  itemId, number, title: `Card ${number}`, body: `Body of ${number}`, url: `https://github.com/Guyvk/agora/issues/${number}`,
  status, owner: 'Nana', circle: 'Tech Support', prs: [], mergedGoesLive: false, ...extra
})

const boardData = (extra = {}) => ({
  configured: true,
  boardUrl: 'https://github.com/users/Guyvk/projects/1',
  columns: [
    { name: 'To do', cards: [card('I1', 1, 'To do')] },
    { name: 'Doing', cards: [card('I2', 2, 'Doing', { prs: [{ number: 30, state: 'draft', url: 'https://x/30' }] })] },
    { name: 'In review', cards: [card('I3', 3, 'In review', { prs: [{ number: 31, state: 'merged', url: 'https://x/31' }], mergedGoesLive: true })] },
    { name: 'Live', cards: [] }
  ],
  wentLive: [{ number: 9, title: 'Shipped thing', url: 'u', date: '2026-11-05T10:00:00Z' }],
  helpDesk: [{ id: '4', type: 'fault', createdAt: '2026-11-06T10:00:00Z' }],
  canOpenHelpDesk: false,
  fetchedAt: new Date(Date.now() - 3 * 60000).toISOString(),
  ageSeconds: 180,
  warning: null,
  ...extra
})

let calls
function fakeServer ({ board = boardData(), boardStatus = 200, access = { allowed: true, circle: 'tech-support' } } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data })
    if (url.endsWith('/access')) return reply(200, access)
    if (url.includes('/board')) return reply(boardStatus, boardStatus === 200 ? board : { error: 'The Build page is not open to you.' })
    if (url.endsWith('/move')) {
      const body = JSON.parse(options.body)
      const moved = boardData()
      moved.columns = moved.columns.map(c => ({ ...c, cards: c.cards.filter(x => x.itemId !== body.itemId) }))
      moved.columns.find(c => c.name === body.status).cards.push(card(body.itemId, 2, body.status))
      return reply(200, moved)
    }
    return reply(404, {})
  })
}

const renderPage = () => render(<BuildPage />, { wrapper: AllTheProviders({}, ['/groups/tech-support/build']) })

describe('BuildPage', () => {
  it('says it is loading, then shows the four columns with their cards', async () => {
    fakeServer()
    renderPage()
    expect(screen.getByText('Loading the board…')).toBeInTheDocument()
    expect(await screen.findByTestId('build-page', {}, WAIT)).toBeInTheDocument()
    for (const name of ['To do', 'Doing', 'In review', 'Live']) expect(screen.getByTestId(`build-column-${name}`)).toBeInTheDocument()
    const doing = within(screen.getByTestId('build-column-Doing'))
    expect(doing.getByText('#2 Card 2')).toBeInTheDocument()
    expect(doing.getByText('Draft pull request #30')).toBeInTheDocument()
    expect(within(screen.getByTestId('build-column-In review')).getByText('Merged, goes live at the next update')).toBeInTheDocument()
    expect(screen.getAllByText('Owner: Nana').length).toBeGreaterThan(0)
  })

  it('shows what went live, new Help desk requests and the footer', async () => {
    fakeServer()
    renderPage()
    expect(await screen.findByText('#9 Shipped thing', { exact: false }, WAIT)).toBeInTheDocument()
    const desk = within(screen.getByTestId('build-help-desk'))
    expect(desk.getByText('#4 fault', { exact: false })).toBeInTheDocument()
    expect(desk.queryByText('Open the Help desk')).toBeNull() // not a Help desk admin: no link
    const footer = within(screen.getByTestId('build-footer'))
    expect(footer.getByText('Updated 3 minutes ago')).toBeInTheDocument()
    expect(footer.getByText('Open the board on GitHub').getAttribute('href')).toEqual('https://github.com/users/Guyvk/projects/1')
  })

  it('links a Help desk request to the Help desk only for people who can open it', async () => {
    fakeServer({ board: boardData({ canOpenHelpDesk: true }) })
    renderPage()
    const link = await screen.findByText('Open the Help desk', {}, WAIT)
    expect(link.getAttribute('href')).toEqual('/admin/help-desk/4')
  })

  it('says the board is not connected, with the GitHub link', async () => {
    fakeServer({ board: { configured: false, boardUrl: 'https://github.com/users/Guyvk/projects/1', columns: [], wentLive: [], helpDesk: [] } })
    renderPage()
    expect(await screen.findByText('The board is not connected yet.', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('Open the board on GitHub')).toBeInTheDocument()
  })

  it('tells people who may not see it', async () => {
    fakeServer({ boardStatus: 403 })
    renderPage()
    expect(await screen.findByTestId('build-denied', {}, WAIT)).toBeInTheDocument()
  })

  it('opens a card in a side panel on the same page', async () => {
    fakeServer()
    renderPage()
    fireEvent.click(await screen.findByText('#3 Card 3', {}, WAIT))
    const panel = within(screen.getByTestId('build-side-panel'))
    expect(panel.getByText('Body of 3')).toBeInTheDocument()
    expect(panel.getByText('#31')).toBeInTheDocument()
  })

  it('moves a card with the Move to menu and shows the new board', async () => {
    fakeServer()
    renderPage()
    await screen.findByTestId('build-page', {}, WAIT)
    fireEvent.change(screen.getByLabelText('Move to #2'), { target: { value: 'Live' } })
    await waitFor(() => expect(within(screen.getByTestId('build-column-Live')).getByText('#2 Card 2')).toBeInTheDocument(), WAIT)
    const move = calls.find(c => c.url.endsWith('/move'))
    expect(JSON.parse(move.options.body)).toEqual({ itemId: 'I2', status: 'Live' })
    expect(move.options.headers['X-Agora']).toEqual('1')
  })

  it('asks the server for a forced refresh', async () => {
    fakeServer()
    renderPage()
    await screen.findByTestId('build-page', {}, WAIT)
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/board?refresh=1'))).toBe(true), WAIT)
  })
})

describe('BuildMenuLink', () => {
  beforeEach(() => resetAccess())

  it('links to the Build page inside the app for members of the Build circle', async () => {
    fakeServer()
    render(<BuildMenuLink groupSlug='tech-support' />)
    const link = await screen.findByTestId('agora-build-menu-link', {}, WAIT)
    expect(link.getAttribute('href')).toEqual('/groups/tech-support/build')
    expect(link.getAttribute('target')).toBeNull()
  })

  it('shows nothing in another circle, or when the server says no', async () => {
    fakeServer()
    const { unmount } = render(<BuildMenuLink groupSlug='care' />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled(), WAIT)
    expect(screen.queryByTestId('agora-build-menu-link')).toBeNull()
    unmount()
    resetAccess()
    fakeServer({ access: { allowed: false, circle: null } })
    render(<BuildMenuLink groupSlug='tech-support' />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled(), WAIT)
    expect(screen.queryByTestId('agora-build-menu-link')).toBeNull()
  })
})
