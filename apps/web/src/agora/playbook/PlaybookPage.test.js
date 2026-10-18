// Agora: the playbook page of a group, with a pretend server.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import PlaybookPage from './PlaybookPage'
import PlaybookMenuLink from './PlaybookMenuLink'

const chapters = [
  { id: '1', position: 1, title: 'Onboarding', status: 'agreed', summary: 'How someone joins 7BP.', link: 'https://docs.google.com/document/d/made-up', updatedAt: '2026-10-12T08:00:00Z', owner: { id: '2', name: 'Amara' }, updatedBy: { id: '1', name: 'Demo Steward' } },
  { id: '2', position: 2, title: 'Fundraising', status: 'not_started', summary: null, link: null, updatedAt: '2026-10-13T08:00:00Z', owner: null, updatedBy: { id: '1', name: 'Demo Steward' } }
]

function playbook ({ canEdit, list = chapters }) {
  return {
    groupId: '7',
    groupName: '7 Billion Presidents',
    canEdit,
    statuses: ['not_started', 'draft', 'in_review', 'agreed'],
    chapters: list,
    members: canEdit ? [{ id: '1', name: 'Demo Steward' }, { id: '2', name: 'Amara' }] : []
  }
}

let calls
function fakeServer ({ canEdit = false, list = chapters, error = null } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    const body = JSON.parse(options.body)
    calls.push({ url, options, body })
    let data
    if (error) return { ok: true, status: 200, json: async () => ({ errors: [{ message: error }] }) }
    if (body.query.includes('agoraPlaybook(')) data = { agoraPlaybook: playbook({ canEdit, list }) }
    else if (body.query.includes('createAgoraPlaybookChapter')) data = { createAgoraPlaybookChapter: { id: '9' } }
    else if (body.query.includes('updateAgoraPlaybookChapter')) data = { updateAgoraPlaybookChapter: { id: body.variables.id } }
    else if (body.query.includes('deleteAgoraPlaybookChapter')) data = { deleteAgoraPlaybookChapter: { success: true } }
    return { ok: true, status: 200, json: async () => ({ data }) }
  })
}

// The test setup replaces useParams with a stand-in (config/jest/beforeTestEnvSetup.js).
function renderPage () {
  useParams.mockReturnValue({ groupSlug: '7bp' })
  return render(<PlaybookPage />, { wrapper: AllTheProviders({}, ['/groups/7bp/playbook']) })
}

describe('PlaybookPage', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('shows every chapter in order with its owner, status, date, text and link', async () => {
    fakeServer()
    renderPage()
    const cards = await screen.findAllByTestId('playbook-chapter')
    expect(cards.map(c => within(c).getByRole('heading').textContent)).toEqual(['Onboarding', 'Fundraising'])
    expect(within(cards[0]).getByText('Agreed')).toBeInTheDocument()
    expect(within(cards[0]).getByText('Amara')).toBeInTheDocument()
    expect(within(cards[0]).getByText(/Demo Steward/)).toBeInTheDocument()
    expect(within(cards[0]).getByText('How someone joins 7BP.')).toBeInTheDocument()
    expect(within(cards[0]).getByRole('link', { name: /Open the chapter/ })).toHaveAttribute('href', 'https://docs.google.com/document/d/made-up')
    expect(within(cards[1]).getByText('Not started')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Nobody yet')).toBeInTheDocument()
    expect(calls[0].url).toBe('/noo/graphql')
    expect(calls[0].body.variables).toEqual({ groupSlug: '7bp' })
  })

  it('is read-only for a member', async () => {
    fakeServer({ canEdit: false })
    renderPage()
    await screen.findAllByTestId('playbook-chapter')
    expect(screen.queryByRole('button', { name: /Add a chapter/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('lets a steward add a chapter', async () => {
    fakeServer({ canEdit: true })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Add a chapter/ }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Events' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'draft' } })
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'docs.google.com/events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some(c => c.body.query.includes('createAgoraPlaybookChapter'))).toBe(true))
    const create = calls.find(c => c.body.query.includes('createAgoraPlaybookChapter'))
    expect(create.body.variables).toEqual({
      groupId: '7',
      data: { title: 'Events', status: 'draft', ownerId: '2', summary: '', link: 'docs.google.com/events' }
    })
    // The list is read again and the form closes
    await waitFor(() => expect(screen.queryByLabelText('Title')).not.toBeInTheDocument())
    expect(calls.filter(c => c.body.query.includes('agoraPlaybook(')).length).toBe(2)
  })

  it('lets a steward change a chapter, and remove it after asking', async () => {
    fakeServer({ canEdit: true })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Onboarding' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Onboarding')
    expect(screen.getByLabelText('Owner')).toHaveValue('2')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in_review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some(c => c.body.query.includes('updateAgoraPlaybookChapter'))).toBe(true))
    const update = calls.find(c => c.body.query.includes('updateAgoraPlaybookChapter'))
    expect(update.body.variables.id).toBe('1')
    expect(update.body.variables.data).toMatchObject({ title: 'Onboarding', status: 'in_review', ownerId: '2', position: 1 })

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Fundraising' }))
    fireEvent.click(screen.getByRole('button', { name: /Remove this chapter/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(calls.some(c => c.body.query.includes('deleteAgoraPlaybookChapter'))).toBe(true))
    expect(calls.find(c => c.body.query.includes('deleteAgoraPlaybookChapter')).body.variables).toEqual({ id: '2' })
  })

  it('shows what the server says when something cannot be done', async () => {
    fakeServer({ error: 'Only stewards of this group can change the playbook.' })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Only stewards of this group can change the playbook.')
  })

  it('tells someone outside the group that the playbook is for members', async () => {
    calls = []
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { agoraPlaybook: null } }) }))
    renderPage()
    expect(await screen.findByText('The playbook is for members of this group.')).toBeInTheDocument()
  })
})

describe('PlaybookMenuLink', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  function renderLink () {
    return render(<PlaybookMenuLink groupSlug='7bp' />, { wrapper: AllTheProviders({}, ['/groups/7bp']) })
  }

  it('links to the playbook when the group has chapters', async () => {
    fakeServer({ canEdit: false })
    renderLink()
    expect(await screen.findByRole('link', { name: /Playbook/ })).toHaveAttribute('href', '/groups/7bp/playbook')
  })

  it('stays hidden for a member when there are no chapters yet', async () => {
    fakeServer({ canEdit: false, list: [] })
    renderLink()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('link', { name: /Playbook/ })).not.toBeInTheDocument()
  })

  it('shows for a steward even before the first chapter', async () => {
    fakeServer({ canEdit: true, list: [] })
    renderLink()
    expect(await screen.findByRole('link', { name: /Playbook/ })).toBeInTheDocument()
  })
})
