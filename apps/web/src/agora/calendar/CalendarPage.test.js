// Agora: my calendar page, with a pretend server.
import React from 'react'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import CalendarPage, { itemsToPosts } from './CalendarPage'

const soon = days => new Date(Date.now() + days * 86400000)
const items = [
  { id: '1', kind: 'meeting', title: 'Governance weekly', start: soon(1).toISOString(), end: new Date(soon(1).getTime() + 3600000).toISOString(), timezone: 'Europe/Amsterdam', location: null, roomUrl: 'https://agora.test/noo/meeting/1/room', forAll: false, groups: [{ id: '2', name: 'Governance', slug: 'gov' }], creator: { id: '5', name: 'Lars' }, url: 'https://agora.test/post/1', summary: '' },
  { id: '3', kind: 'event', title: 'Info evening', start: soon(2).toISOString(), end: new Date(soon(2).getTime() + 7200000).toISOString(), timezone: 'Europe/Amsterdam', location: 'Community Hall', roomUrl: null, forAll: true, groups: [], creator: { id: '1', name: 'Demo Steward' }, url: 'https://agora.test/post/3', summary: '' }
]

let calls
function fakeServer ({ feedUrl = null } = {}) {
  calls = []
  let url = feedUrl
  global.fetch = jest.fn(async (path, options = {}) => {
    calls.push({ path, options })
    if (path === '/noo/agora/calendar/api/feed/renew') url = 'https://agora.test/noo/agora/calendar/' + 'x'.repeat(43) + '.ics'
    if (path === '/noo/agora/calendar/api/feed/revoke') url = null
    const data = path.startsWith('/noo/agora/calendar/api/items')
      ? { items }
      : path.startsWith('/noo/agora/calendar/api/feed') ? { url } : { canMarkForAll: false, mainGroup: null }
    return { ok: true, status: 200, json: async () => data }
  })
}

function renderPage () {
  return render(<CalendarPage />, { wrapper: AllTheProviders({}, ['/calendar']) })
}

describe('CalendarPage', () => {
  const originalFetch = global.fetch
  const originalConfirm = window.confirm
  afterEach(() => {
    global.fetch = originalFetch
    window.confirm = originalConfirm
  })

  it('turns the server items into posts for Hylo\'s calendar, keeping the kind', () => {
    const posts = itemsToPosts(items)
    expect(posts[0]).toMatchObject({ id: '1', type: 'event', agoraKind: 'meeting', title: 'Governance weekly' })
    expect(posts[1]).toMatchObject({ id: '3', type: 'event', agoraKind: 'event', agoraForAll: true })
  })

  it('lists what is coming up, with the kind, the meeting room and the place', async () => {
    fakeServer()
    renderPage()
    const rows = await screen.findAllByTestId('calendar-item')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Governance weekly')).toBeInTheDocument()
    expect(within(rows[0]).getByTestId('calendar-kind-meeting')).toBeInTheDocument()
    expect(within(rows[0]).getByRole('link', { name: /Meet in Agora/ })).toHaveAttribute('href', 'https://agora.test/noo/meeting/1/room')
    expect(within(rows[1]).getByTestId('calendar-kind-event')).toBeInTheDocument()
    expect(within(rows[1]).getByText('All of 7BP')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Community Hall')).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('link', { name: /Meet in Agora/ })).toBeNull()
  })

  it('makes a calendar link on request and explains how to add it', async () => {
    fakeServer()
    renderPage()
    fireEvent.click(await screen.findByTestId('calendar-make-link'))
    const link = await screen.findByTestId('calendar-link')
    expect(link.value).toMatch(/\/noo\/agora\/calendar\/x{43}\.ics$/)
    const renew = calls.find(c => c.path === '/noo/agora/calendar/api/feed/renew')
    expect(renew.options.method).toBe('POST')
    expect(renew.options.headers['X-Agora']).toBe('1')
    expect(screen.getByText('agoraCalendar.howGoogle')).toBeInTheDocument()
    expect(screen.getByText('agoraCalendar.howApple')).toBeInTheDocument()
    expect(screen.getByText('agoraCalendar.howOutlook')).toBeInTheDocument()
    expect(screen.getByText('agoraCalendar.refresh')).toBeInTheDocument()
  })

  it('switches the link off after asking', async () => {
    fakeServer({ feedUrl: 'https://agora.test/noo/agora/calendar/' + 'y'.repeat(43) + '.ics' })
    window.confirm = jest.fn(() => true)
    renderPage()
    await screen.findByTestId('calendar-link')
    fireEvent.click(screen.getByTestId('calendar-revoke'))
    await waitFor(() => expect(screen.getByTestId('calendar-make-link')).toBeInTheDocument())
    expect(window.confirm).toHaveBeenCalled()
  })
})
