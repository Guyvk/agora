// Agora: "This week in 7BP" on the main circle's welcome page, with a pretend server.
import React from 'react'
import { render, screen, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import ThisWeek from './ThisWeek'

jest.setTimeout(20000)
const WAIT = { timeout: 10000 }

function fakeServer (status, body) {
  global.fetch = jest.fn(async () => ({ ok: status === 200, status, json: async () => body }))
}

const EMPTY = { enabled: true, meetings: [], announcements: [], minutes: [], decisions: [] }

const FILLED = {
  enabled: true,
  meetings: [
    { id: '11', title: 'Governance call', circle: { name: 'Governance', slug: 'governance' }, startsAt: '2026-10-26T18:30:00.000Z', endsAt: '2026-10-26T19:30:00.000Z', roomPath: '/noo/meeting/11/room', inNextSevenDays: true },
    { id: '12', title: 'Open evening', circle: { name: '7BP', slug: '7bp' }, startsAt: '2026-11-02T18:30:00.000Z', endsAt: null, roomPath: null, inNextSevenDays: false }
  ],
  announcements: [{ id: '21', title: 'New website', circle: { name: 'Communications', slug: 'comms' }, at: '2026-10-23T09:00:00.000Z', summary: 'It is live.' }],
  minutes: [{ id: '31', title: 'Minutes: Governance call (2026-10-19)', circle: { name: 'Governance', slug: 'governance' }, at: '2026-10-19T20:00:00.000Z' }],
  decisions: [{ id: '41', title: 'Use kDrive for files', circle: { name: 'Governance', slug: 'governance' }, at: '2026-10-20T20:00:00.000Z', outcome: 'Yes, by 5 votes to 2' }]
}

describe('ThisWeek', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('asks the server for the circle and shows a calm text in every empty part', async () => {
    fakeServer(200, EMPTY)
    render(<ThisWeek groupSlug='7bp' />)
    expect(await screen.findByText('This week in 7BP', undefined, WAIT)).toBeInTheDocument()
    expect(global.fetch.mock.calls[0][0]).toBe('/noo/agora/this-week?group=7bp')
    expect(screen.getByText('No meetings this week')).toBeInTheDocument()
    expect(screen.getByText('No announcements yet')).toBeInTheDocument()
    expect(screen.getByText('No minutes yet')).toBeInTheDocument()
    expect(screen.getByText('No decisions in the last two weeks')).toBeInTheDocument()
  })

  it('shows meetings, announcements, minutes and decisions with circle names and links inside the app', async () => {
    fakeServer(200, FILLED)
    render(<ThisWeek groupSlug='7bp' />)
    const meetings = await screen.findByTestId('agora-this-week-meetings', undefined, WAIT)
    expect(within(meetings).getByText('Governance call').closest('a')).toHaveAttribute('href', '/groups/governance/post/11')
    expect(within(meetings).getByText('Governance')).toBeInTheDocument()
    const room = within(meetings).getByText('Meeting room')
    expect(room).toHaveAttribute('href', '/noo/meeting/11/room')
    expect(room).not.toHaveAttribute('target')
    expect(within(meetings).getAllByText('Meeting room')).toHaveLength(1) // the second meeting has no room
    expect(within(meetings).getByText('Open evening')).toBeInTheDocument()

    const announcements = screen.getByTestId('agora-this-week-announcements')
    expect(within(announcements).getByText('New website').closest('a')).toHaveAttribute('href', '/groups/comms/post/21')
    expect(within(announcements).getByText('Communications')).toBeInTheDocument()
    expect(within(announcements).getByText('It is live.')).toBeInTheDocument()

    const minutes = screen.getByTestId('agora-this-week-minutes')
    expect(within(minutes).getByText('Minutes: Governance call (2026-10-19)').closest('a')).toHaveAttribute('href', '/groups/governance/post/31')

    const decisions = screen.getByTestId('agora-this-week-decisions')
    expect(within(decisions).getByText('Use kDrive for files')).toBeInTheDocument()
    expect(within(decisions).getByText('Outcome: Yes, by 5 votes to 2')).toBeInTheDocument()

    expect(screen.queryByText('No meetings this week')).toBeNull()
    expect(document.querySelector('a[target="_blank"]')).toBeNull()
  })

  it('shows nothing on a circle that is not the main circle', async () => {
    fakeServer(200, { enabled: false })
    const { container } = render(<ThisWeek groupSlug='governance' />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled(), WAIT)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(container.querySelector('[data-testid="agora-this-week"]')).toBeNull()
    expect(screen.queryByText('This week in 7BP')).toBeNull()
  })

  it('shows nothing when the server cannot answer, and nothing stale after a circle change', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    fakeServer(200, FILLED)
    const { rerender } = render(<ThisWeek groupSlug='7bp' />)
    expect(await screen.findByTestId('agora-this-week', undefined, WAIT)).toBeInTheDocument()
    fakeServer(500, {})
    rerender(<ThisWeek groupSlug='other' />)
    expect(screen.queryByTestId('agora-this-week')).not.toBeInTheDocument()
    await waitFor(() => expect(warn).toHaveBeenCalled(), WAIT)
    expect(screen.queryByTestId('agora-this-week')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
    warn.mockRestore()
  })
})
