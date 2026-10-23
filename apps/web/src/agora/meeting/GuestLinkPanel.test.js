// Agora: the guest link box on an event, with a pretend server.
import React from 'react'
import { render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import GuestLinkPanel from './GuestLinkPanel'

const URL = 'https://agora.example/noo/meeting/5/guest/' + 'a'.repeat(43)
// A busy test computer can be slow to re-render, so waits are generous.
const WAIT = { timeout: 10000 }
const LINK = { expiresAt: '2026-11-01T22:00:00.000Z', expired: false, createdAt: '2026-11-01T10:00:00.000Z' }

let calls
function fakeServer (answers) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers })
    const key = `${options.method || 'GET'} ${url}`
    const answer = answers[key] || { status: 404, body: {} }
    return { ok: answer.status === 200, status: answer.status, json: async () => answer.body }
  })
}

describe('GuestLinkPanel', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('shows nothing to someone who may not invite guests', async () => {
    fakeServer({ 'GET /noo/meeting/5/guest-link': { status: 200, body: { canManage: false } } })
    const { container } = render(<GuestLinkPanel postId='5' />)
    await waitFor(() => expect(calls.length).toBe(1), WAIT)
    expect(container.querySelector('[data-testid="agora-guest-link"]')).toBeNull()
  })

  it('makes a link, shows it once with a copy button, and revokes it', async () => {
    fakeServer({
      'GET /noo/meeting/5/guest-link': { status: 200, body: { canManage: true, available: true, link: null } },
      'POST /noo/meeting/5/guest-link': { status: 200, body: { url: URL, link: LINK } },
      'POST /noo/meeting/5/guest-link/revoke': { status: 200, body: { link: null } }
    })
    const writeText = jest.fn(() => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })

    render(<GuestLinkPanel postId='5' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make a guest link' }, WAIT))

    const field = await screen.findByLabelText('Guest link', undefined, WAIT)
    expect(field).toHaveValue(URL)
    expect(calls[1].headers['X-Agora']).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL), WAIT)
    expect(await screen.findByRole('button', { name: 'Copied' }, WAIT)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(screen.queryByLabelText('Guest link')).toBeNull(), WAIT)
    expect(calls.map(c => `${c.method} ${c.url}`)).toContain('POST /noo/meeting/5/guest-link/revoke')
    expect(screen.getByRole('button', { name: 'Make a guest link' })).toBeInTheDocument()
  })

  it('says a link exists without showing it again', async () => {
    fakeServer({ 'GET /noo/meeting/5/guest-link': { status: 200, body: { canManage: true, available: true, link: LINK } } })
    render(<GuestLinkPanel postId='5' />)
    expect(await screen.findByText(/Agora cannot show it again/, undefined, WAIT)).toBeInTheDocument()
    expect(screen.queryByLabelText('Guest link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Make a new guest link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
  })

  it('lets a member of the circle see and copy the link, without revoking or replacing it', async () => {
    fakeServer({ 'GET /noo/meeting/5/guest-link': { status: 200, body: { canUse: true, canManage: false, available: true, link: LINK, url: URL } } })
    const writeText = jest.fn(() => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })
    render(<GuestLinkPanel postId='5' />)
    const field = await screen.findByLabelText('Guest link', undefined, WAIT)
    expect(field).toHaveValue(URL)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL), WAIT)
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Make a new guest link' })).toBeNull()
  })

  it('lets a member of the circle make a link when there is none', async () => {
    fakeServer({
      'GET /noo/meeting/5/guest-link': { status: 200, body: { canUse: true, canManage: false, available: true, link: null, url: null } },
      'POST /noo/meeting/5/guest-link': { status: 200, body: { url: URL, link: LINK } }
    })
    render(<GuestLinkPanel postId='5' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make a guest link' }, WAIT))
    expect(await screen.findByLabelText('Guest link', undefined, WAIT)).toHaveValue(URL)
  })

  it('tells a member to ask the meeting\'s maker or a steward after a revoke, without a make button', async () => {
    fakeServer({ 'GET /noo/meeting/5/guest-link': { status: 200, body: { canUse: true, canManage: false, available: true, link: { revoked: true }, url: null } } })
    render(<GuestLinkPanel postId='5' />)
    expect(await screen.findByText(/ask the person who made the meeting or a steward/, undefined, WAIT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make a guest link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('lets a steward make a new link after a revoke', async () => {
    fakeServer({ 'GET /noo/meeting/5/guest-link': { status: 200, body: { canUse: true, canManage: true, available: true, link: { revoked: true }, url: null } } })
    render(<GuestLinkPanel postId='5' />)
    expect(await screen.findByRole('button', { name: 'Make a guest link' }, WAIT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('shows the reason when the server refuses', async () => {
    fakeServer({
      'GET /noo/meeting/5/guest-link': { status: 200, body: { canManage: true, available: true, link: null } },
      'POST /noo/meeting/5/guest-link': { status: 409, body: { error: 'This event ended more than two hours ago.' } }
    })
    render(<GuestLinkPanel postId='5' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make a guest link' }, WAIT))
    expect(await screen.findByRole('alert', undefined, WAIT)).toHaveTextContent('This event ended more than two hours ago.')
  })
})
