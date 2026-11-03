// Agora: the shared Contacts page, with a pretend server.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
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
  follow_up_owner_name: 'Amara',
  country: 'Netherlands',
  last_contact_at: '2026-10-12T08:00:00Z'
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
    else if (path.startsWith('/21/member-choices')) body = { suggested: [{ id: '2', name: 'Amara' }], members: [{ id: '1', name: 'Demo Steward' }, { id: '2', name: 'Amara' }] }
    else if (path === '/21/propose') body = { ok: true }
    else if (path === '/12/notes' || path === '/12/delete') body = { ok: true }
    else if (path === '/21/update') body = { id: '21' }
    else if (path.startsWith('/list')) body = { contacts: [mila, ilse, claimed] }
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

  it('lists the contacts as a table with a follow-up count', async () => {
    fakeServer()
    renderAt(null)
    expect(await screen.findByText('Mila Jansen')).toBeInTheDocument()
    expect(screen.getByText('De Dagkrant')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /My follow-ups/ })).toHaveTextContent('1')
    // team contacts show their claim state as status
    expect(screen.getAllByText('Unclaimed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Claimed').length).toBeGreaterThan(0)
  })

  it('sorts when a column header is clicked', async () => {
    fakeServer()
    renderAt(null)
    await screen.findByText('Mila Jansen')
    const names = () => screen.getAllByRole('row').slice(1).map(r => r.textContent)
    expect(names()[0]).toMatch(/Ilse/)
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(names()[0]).toMatch(/Mila/)
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('shows only unclaimed team contacts in the Unclaimed view', async () => {
    fakeServer()
    renderAt(null)
    await screen.findByText('Mila Jansen')
    fireEvent.click(screen.getByRole('button', { name: 'Unclaimed' }))
    await waitFor(() => expect(screen.queryByText('Mila Jansen')).not.toBeInTheDocument())
    expect(screen.getByText('Ilse Voorbeeld')).toBeInTheDocument()
    expect(screen.queryByText('Jet Claimed')).not.toBeInTheDocument()
    expect(calls.some(c => c.url.includes('/list?') && c.url.includes('kind=team'))).toBe(true)
  })

  it('opens a contact in the side panel in read mode, with a merged activity list', async () => {
    fakeServer()
    renderAt('12')
    expect(await screen.findByRole('heading', { name: 'Mila Jansen' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.getByText('Prefers email.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'mila@dagkrant.test' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Write a note…')).toBeInTheDocument()
    // the table stays next to the panel
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('shows the form on Edit and goes back to read mode on Cancel', async () => {
    fakeServer()
    renderAt('12')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByDisplayValue('mila@dagkrant.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('adds a note and deletes with the confirm step', async () => {
    fakeServer()
    renderAt('12')
    fireEvent.change(await screen.findByPlaceholderText('Write a note…'), { target: { value: 'Called her' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/12/notes'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('button', { name: /Delete this contact/ }))
    expect(screen.getByText(/removes the contact and all notes/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/12/delete'))).toBe(true))
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
  })

  it('shows a team member\'s profile and photo, and makes a claim link that is shown once with Copy', async () => {
    fakeServer()
    renderAt('21')
    expect(await screen.findByText('Made-up Land', { selector: 'span' })).toBeInTheDocument()
    expect(within(screen.getByTestId('skills')).getByText('Drawing')).toBeInTheDocument()
    expect(screen.getByAltText('Photo of Ilse Voorbeeld')).toHaveAttribute('src', ilse.photo_url)
    fireEvent.click(screen.getByRole('button', { name: 'Claim link' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make claim link' }))
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument()
    const post = calls.find(c => c.url.endsWith('/21/claim-link'))
    expect(post.options.method).toBe('POST')
    expect(post.options.headers['X-Agora']).toBe('1')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/21/claim-link/withdraw'))).toBe(true))
  })

  it('shows suggested members first in the Propose dropdown and proposes one', async () => {
    fakeServer()
    renderAt('21')
    fireEvent.click(await screen.findByRole('button', { name: 'Propose' }))
    const suggested = await screen.findByTestId('suggested')
    expect(within(suggested).getByRole('button', { name: 'Amara' })).toBeInTheDocument()
    const all = screen.getByTestId('all-members')
    // the suggested member is not repeated in the long list
    expect(within(all).queryByRole('button', { name: 'Amara' })).not.toBeInTheDocument()
    expect(within(all).getByRole('button', { name: 'Demo Steward' })).toBeInTheDocument()
    expect(suggested.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(within(suggested).getByRole('button', { name: 'Amara' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/21/propose'))).toBe(true))
    expect(JSON.parse(calls.find(c => c.url.endsWith('/21/propose')).options.body)).toEqual({ userId: '2' })
  })

  it('sends the profile fields along when saving', async () => {
    fakeServer()
    renderAt('21')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
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

  it('shows members who are not stewards no make-claim-link button', async () => {
    fakeServer({ canMakeClaimLinks: false })
    renderAt('21')
    fireEvent.click(await screen.findByRole('button', { name: 'Claim link' }))
    expect(await screen.findByText('Stewards can make a claim link.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make claim link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Propose' })).not.toBeInTheDocument()
  })
})
