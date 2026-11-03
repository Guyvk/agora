// Agora: the "We found your profile" card, with a pretend server. The person is made up.
import React from 'react'
import { AllTheProviders, render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import ProposedProfileBanner from './ProposedProfileBanner'

const proposal = { contactId: '7', profile: { name: 'Ilse Voorbeeld', skills: [] } }
let calls

function fakeServer (answer = proposal) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => (url.endsWith('/proposal') ? { proposal: answer } : { ok: true }) }
  })
}

describe('ProposedProfileBanner', () => {
  const originalFetch = global.fetch
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => { global.fetch = originalFetch })

  const show = () => render(<ProposedProfileBanner />, { wrapper: AllTheProviders({}, ['/']) })

  it('shows the question and a link to the claim page inside the app', async () => {
    fakeServer()
    show()
    expect(await screen.findByText('We found your profile from the activist council. Is this you?')).toBeInTheDocument()
    expect(screen.getByText('Ilse Voorbeeld')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Have a look' })).toHaveAttribute('href', '/claim/proposal')
  })

  it('shows nothing when there is no proposal', async () => {
    fakeServer(null)
    show()
    await waitFor(() => expect(calls.length).toBe(1))
    expect(screen.queryByTestId('proposed-profile-banner')).toBeNull()
  })

  it('"Not now" hides it for this session only', async () => {
    fakeServer()
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByTestId('proposed-profile-banner')).toBeNull()
    expect(window.sessionStorage.getItem('agora-proposal-hidden')).toBe('1')
    expect(calls.filter(c => c.options.method === 'POST')).toHaveLength(0)
  })

  it('"This isn\'t me" tells the server and removes the card', async () => {
    fakeServer()
    show()
    fireEvent.click(await screen.findByRole('button', { name: "This isn't me" }))
    await waitFor(() => expect(screen.queryByTestId('proposed-profile-banner')).toBeNull())
    const post = calls.find(c => c.options.method === 'POST')
    expect(post.url).toBe('/noo/agora/claim/api/proposal/dismiss')
    expect(JSON.parse(post.options.body)).toEqual({ contactId: '7' })
    expect(post.options.headers['X-Agora']).toBe('1')
  })
})
