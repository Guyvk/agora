// Agora: the shared Contacts page, with a pretend server.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import ContactsPage from './ContactsPage'

const meta = {
  kinds: ['partner', 'press', 'funder', 'interested', 'other'],
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

let calls
function fakeServer ({ created = '99' } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const path = url.replace('/noo/agora/contacts/api', '')
    let body
    if (path === '/meta') body = meta
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
})
