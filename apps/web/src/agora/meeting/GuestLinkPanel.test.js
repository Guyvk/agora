// Agora: the guest link box on an event, with a pretend server.
import React from 'react'
import { render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import GuestLinkPanel from './GuestLinkPanel'

const URL = 'https://agora.example/noo/meeting/5/guest/' + 'a'.repeat(43)
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
    await waitFor(() => expect(calls.length).toBe(1))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Make a guest link' }))

    const field = await screen.findByLabelText('Guest link')
    expect(field).toHaveValue(URL)
    expect(calls[1].headers['X-Agora']).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(screen.queryByLabelText('Guest link')).toBeNull())
    expect(calls.map(c => `${c.method} ${c.url}`)).toContain('POST /noo/meeting/5/guest-link/revoke')
    expect(screen.getByRole('button', { name: 'Make a guest link' })).toBeInTheDocument()
  })

  it('says a link exists without showing it again', async () => {
    fakeServer({ 'GET /noo/meeting/5/guest-link': { status: 200, body: { canManage: true, available: true, link: LINK } } })
    render(<GuestLinkPanel postId='5' />)
    expect(await screen.findByText(/Agora cannot show it again/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Guest link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Make a new guest link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
  })

  it('shows the reason when the server refuses', async () => {
    fakeServer({
      'GET /noo/meeting/5/guest-link': { status: 200, body: { canManage: true, available: true, link: null } },
      'POST /noo/meeting/5/guest-link': { status: 409, body: { error: 'This event ended more than two hours ago.' } }
    })
    render(<GuestLinkPanel postId='5' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Make a guest link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This event ended more than two hours ago.')
  })
})
