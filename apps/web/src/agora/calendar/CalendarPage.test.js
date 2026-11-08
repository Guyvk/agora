// Agora: my calendar page, with a pretend server.
import React from 'react'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import CalendarPage, { itemsToPosts } from './CalendarPage'
import { webcalUrl } from './CalendarLinkDialog'

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
    expect(within(rows[0]).getByRole('link', { name: /Video meeting in Agora/ })).toHaveAttribute('href', 'https://agora.test/noo/meeting/1/room')
    expect(within(rows[1]).getByTestId('calendar-kind-event')).toBeInTheDocument()
    expect(within(rows[1]).getByText('All of 7BP')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Community Hall')).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('link', { name: /Video meeting in Agora/ })).toBeNull()
  })

  const openPopup = async () => {
    fireEvent.click((await screen.findAllByTestId('calendar-add-button'))[0])
    return screen.findByTestId('calendar-dialog')
  }

  it('has an "Add to my calendar" button in the header, and no link on the page itself', async () => {
    fakeServer()
    renderPage()
    expect((await screen.findAllByTestId('calendar-add-button')).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('calendar-subscribe')).toBeNull()
    expect(screen.queryByTestId('calendar-dialog')).toBeNull()
    // The link is only asked for when the popup opens
    expect(calls.some(c => c.path === '/noo/agora/calendar/api/feed')).toBe(false)
  })

  it('opens a popup that makes a calendar link and explains how to add it', async () => {
    fakeServer()
    renderPage()
    const dialog = await openPopup()
    expect(within(dialog).getByText('agoraCalendar.subscribeIntro')).toBeInTheDocument()
    fireEvent.click(await within(dialog).findByTestId('calendar-make-link'))
    const link = await within(dialog).findByTestId('calendar-link')
    expect(link.value).toMatch(/\/noo\/agora\/calendar\/x{43}\.ics$/)
    const renew = calls.find(c => c.path === '/noo/agora/calendar/api/feed/renew')
    expect(renew.options.method).toBe('POST')
    expect(renew.options.headers['X-Agora']).toBe('1')
    expect(within(dialog).getByText('agoraCalendar.secret')).toBeInTheDocument()
    expect(within(dialog).getByText('agoraCalendar.howApple')).toBeInTheDocument()
    expect(within(dialog).getByText('agoraCalendar.howGoogle')).toBeInTheDocument()
    expect(within(dialog).getByText('agoraCalendar.howOutlook')).toBeInTheDocument()
    expect(within(dialog).getByText('agoraCalendar.refresh')).toBeInTheDocument()
  })

  it('offers the same link as webcal:// to open in Apple Calendar', async () => {
    fakeServer({ feedUrl: 'https://agora.test/noo/agora/calendar/' + 'y'.repeat(43) + '.ics' })
    renderPage()
    const dialog = await openPopup()
    const open = await within(dialog).findByTestId('calendar-open-apple')
    expect(open).toHaveAttribute('href', 'webcal://agora.test/noo/agora/calendar/' + 'y'.repeat(43) + '.ics')
    expect(open).not.toHaveAttribute('target')
    expect(webcalUrl('http://x.test/a.ics')).toBe('webcal://x.test/a.ics')
  })

  it('closes the popup with Escape and with the X', async () => {
    fakeServer()
    renderPage()
    await openPopup()
    fireEvent.keyDown(screen.getByTestId('calendar-dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('calendar-dialog')).toBeNull())
    await openPopup()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('calendar-dialog')).toBeNull())
  })

  it('switches the link off after asking', async () => {
    fakeServer({ feedUrl: 'https://agora.test/noo/agora/calendar/' + 'y'.repeat(43) + '.ics' })
    window.confirm = jest.fn(() => true)
    renderPage()
    const dialog = await openPopup()
    await within(dialog).findByTestId('calendar-link')
    fireEvent.click(within(dialog).getByTestId('calendar-revoke'))
    await waitFor(() => expect(within(dialog).getByTestId('calendar-make-link')).toBeInTheDocument())
    expect(window.confirm).toHaveBeenCalled()
    expect(calls.find(c => c.path === '/noo/agora/calendar/api/feed/revoke').options.headers['X-Agora']).toBe('1')
  })

  it('makes a new link after asking', async () => {
    fakeServer({ feedUrl: 'https://agora.test/noo/agora/calendar/' + 'y'.repeat(43) + '.ics' })
    window.confirm = jest.fn(() => true)
    renderPage()
    const dialog = await openPopup()
    await within(dialog).findByTestId('calendar-link')
    fireEvent.click(within(dialog).getByTestId('calendar-renew'))
    await waitFor(() => expect(within(dialog).getByTestId('calendar-link').value).toMatch(/x{43}\.ics$/))
    expect(window.confirm).toHaveBeenCalled()
  })
})
