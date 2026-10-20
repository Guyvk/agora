// Agora: the shared Contacts page, with a pretend server.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import ContactsPage from './ContactsPage'

const meta = {
  kinds: ['team', 'partner', 'press', 'funder', 'interested', 'other'],
  statuses: ['new', 'in_touch', 'active', 'paused'],
  circles: [{ id: '3', name: 'Communications' }],
  members: [{ id: '1', name: 'Demo Steward' }, { id: '2', name: 'Amara' }],
  dueCount: 1
}
const mila = {
  id: '12',
  name: 'Mila Jansen',
  organisation: 'De Dagkrant',
  kind: 'press',
  status: 'in_touch',
  circle_id: '3',
  circle_name: 'Communications',
  email: 'mila@dagkrant.test',
  consent: true,
  follow_up_on: '2000-01-01',
  follow_up_what: 'Send the press kit',
  follow_up_owner_id: '2',
  follow_up_owner_name: 'Amara'
}

// A made-up team member from a sheet, with a profile that can be claimed
const ilse = {
  id: '21',
  name: 'Ilse Voorbeeld',
  kind: 'team',
  status: 'new',
  source: 'activist-council-2026',
  consent: false,
  country: 'Made-up Land',
  offers: 'Draws maps',
  why_here: 'To meet people',
  skills: 'Drawing, Cooking',
  photo_url: '/noo/uploads/evo-uploads/user/system/agoraContactPhoto/21/photo_abc.jpg',
  has_claim_link: false,
  claimed_user_id: null
}
const claimed = { ...ilse, id: '22', name: 'Jet Claimed', claimed_user_id: '42', claimed_user_name: 'Jet', claimed_at: '2026-10-20T10:00:00Z' }
const LINK = 'https://agora.example.org/claim/' + 'a'.repeat(43)

let calls
function fakeServer ({ created = '99', canMakeClaimLinks = true } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const path = url.replace('/noo/agora/contacts/api', '')
    let body
    if (path === '/meta') body = { ...meta, canMakeClaimLinks }
    else if (path === '/21') body = { contact: { ...ilse, has_claim_link: calls.some(c => c.url.endsWith('/21/claim-link')), notes: [], changes: [] } }
    else if (path === '/22') body = { contact: { ...claimed, notes: [], changes: [{ action: 'claimed', user_name: 'Jet', created_at: '2026-10-20T10:00:00Z' }] } }
    else if (path === '/21/claim-link') body = { link: LINK }
    else if (path === '/21/claim-link/withdraw') body = { ok: true }
    else if (path === '/21/update') body = { id: '21' }
    else if (path.startsWith('/list')) body = { contacts: [mila] }
    else if (path === '/due') body = { count: 1 }
    else if (path === '/create') body = { id: created }
    else if (path === '/12') body = { contact: { ...mila, notes: [{ id: '1', body: 'Prefers email.', author_name: 'Amara', created_at: '2026-10-12T08:00:00Z' }], changes: [] } }
    else if (path === '/' + created) body = { contact: { ...mila, id: created, name: 'Tom', notes: [], changes: [] } }
    else return { ok: false, status: 404, json: async () => ({ error: 'This contact does not exist.' }) }
    return { ok: true, status: 200, json: async () => body }
  })
}

// The test setup replaces useParams with a stand-in (config/jest/beforeTestEnvSetup.js),
// so the contact in the address is set through that.
function renderAt (contactId) {
  useParams.mockReturnValue(contactId ? { contactId } : {})
  return render(<ContactsPage />, { wrapper: AllTheProviders({}, ['/contacts']) })
}

describe('ContactsPage', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('lists the contacts and how many follow-ups are due', async () => {
    fakeServer()
    renderAt(null)
    expect(await screen.findByText('Mila Jansen')).toBeInTheDocument()
    expect(screen.getByText('De Dagkrant')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /My follow-ups/ })).toHaveTextContent('1')
  })

  it('opens a contact with its notes', async () => {
    fakeServer()
    renderAt('12')
    expect(await screen.findByDisplayValue('mila@dagkrant.test')).toBeInTheDocument()
    expect(screen.getByText('Prefers email.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Delete this contact/ })).toBeInTheDocument()
  })

  it('saves a new contact through the page, with the X-Agora header', async () => {
    fakeServer()
    renderAt('new')
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Tom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/create'))).toBe(true))
    const create = calls.find(c => c.url.endsWith('/create'))
    expect(create.options.method).toBe('POST')
    expect(create.options.headers['X-Agora']).toBe('1')
    expect(JSON.parse(create.options.body)).toMatchObject({ name: 'Tom', kind: 'partner', status: 'new', consent: false })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('shows a team member\'s profile and photo, and makes a claim link that is shown once with Copy', async () => {
    fakeServer()
    renderAt('21')
    expect(await screen.findByDisplayValue('Made-up Land')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Drawing, Cooking')).toBeInTheDocument()
    expect(screen.getByAltText('Photo of Ilse Voorbeeld')).toHaveAttribute('src', ilse.photo_url)
    fireEvent.click(screen.getByRole('button', { name: 'Make claim link' }))
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument()
    const post = calls.find(c => c.url.endsWith('/21/claim-link'))
    expect(post.options.method).toBe('POST')
    expect(post.options.headers['X-Agora']).toBe('1')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/21/claim-link/withdraw'))).toBe(true))
  })

  it('sends the profile fields along when saving', async () => {
    fakeServer()
    renderAt('21')
    const country = await screen.findByLabelText('Country')
    fireEvent.change(country, { target: { value: 'Another Land' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/21/update'))).toBe(true))
    const update = calls.find(c => c.url.endsWith('/21/update'))
    expect(JSON.parse(update.options.body)).toMatchObject({ kind: 'team', country: 'Another Land', offers: 'Draws maps', why_here: 'To meet people', skills: 'Drawing, Cooking' })
  })

  it('shows who claimed a profile, with a link to their profile, and no claim button', async () => {
    fakeServer()
    renderAt('22')
    expect(await screen.findByTestId('claim-status')).toHaveTextContent('Claimed by Jet')
    expect(screen.getByRole('link', { name: 'Jet' })).toHaveAttribute('href', '/members/42')
    expect(screen.queryByRole('button', { name: 'Make claim link' })).not.toBeInTheDocument()
    expect(screen.getByText(/Jet claimed this profile/)).toBeInTheDocument()
  })

  it('shows members who are not stewards no claim button', async () => {
    fakeServer({ canMakeClaimLinks: false })
    renderAt('21')
    expect(await screen.findByText('Stewards can make a claim link.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make claim link' })).not.toBeInTheDocument()
  })
})
