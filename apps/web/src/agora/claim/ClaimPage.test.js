// Agora: the claim page, with a pretend server. The person is made up.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import ClaimPage from './ClaimPage'

const SECRET = 'Zz_made-up-secret'.padEnd(43, 'q')
const profile = {
  name: 'Ilse Voorbeeld',
  country: 'Made-up Land',
  offers: 'Draws maps; can cook for forty people',
  whyHere: 'To meet people who care',
  skills: ['Drawing', 'Cooking'],
  photoUrl: '/noo/uploads/evo-uploads/user/system/agoraContactPhoto/7/photo_abc.jpg'
}

let calls
function fakeServer ({ gone = false } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    if (gone) return { ok: false, status: 404, json: async () => ({ error: 'This claim link does not work.' }) }
    if (url === `/noo/agora/claim/api/${SECRET}`) return { ok: true, status: 200, json: async () => ({ profile }) }
    if (url === `/noo/agora/claim/api/${SECRET}/claim`) {
      return { ok: true, status: 200, json: async () => ({ contactId: '7', userId: '42', filled: ['bio'], joinedGroup: { slug: '7bp', name: '7 Billion Presidents' } }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

function renderPage (props = {}) {
  useParams.mockReturnValue({ token: SECRET })
  return render(<ClaimPage {...props} />, { wrapper: AllTheProviders({}, [`/claim/${SECRET}`]) })
}

describe('ClaimPage', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('shows the profile from the sheet, and lets someone without an account sign up or log in', async () => {
    fakeServer()
    renderPage()
    expect(await screen.findByText('Ilse Voorbeeld')).toBeInTheDocument()
    expect(screen.getByText(/made from your sheet at the activist council/)).toBeInTheDocument()
    expect(screen.getByText('Made-up Land')).toBeInTheDocument()
    expect(screen.getByText('Drawing, Cooking')).toBeInTheDocument()
    expect(screen.getByAltText('The photo of your sheet')).toHaveAttribute('src', profile.photoUrl)
    const back = encodeURIComponent(`/claim/${SECRET}`)
    expect(screen.getByRole('link', { name: 'Make my account' })).toHaveAttribute('href', `/signup?returnToUrl=${back}`)
    expect(screen.getByRole('link', { name: 'I have an account: log in' })).toHaveAttribute('href', `/login?returnToUrl=${back}`)
    expect(screen.queryByRole('button', { name: /Yes, this is me/ })).not.toBeInTheDocument()
  })

  it('lets someone who is logged in claim it, through the page itself', async () => {
    fakeServer()
    renderPage({ loggedIn: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, this is me: add it to my profile' }))
    expect(await screen.findByText('Done. The profile from your sheet is now part of your profile in Agora.')).toBeInTheDocument()
    const post = calls.find(c => c.url.endsWith('/claim'))
    expect(post.options.method).toBe('POST')
    expect(post.options.headers['X-Agora']).toBe('1')
    expect(screen.getByRole('link', { name: 'See my profile' })).toHaveAttribute('href', '/members/42')
    expect(screen.getByText('You are now a member of 7 Billion Presidents.')).toBeInTheDocument()
  })

  it('says so when the link does not work any more', async () => {
    fakeServer({ gone: true })
    renderPage()
    expect(await screen.findByText('This claim link does not work.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Make my account' })).not.toBeInTheDocument())
  })
})
