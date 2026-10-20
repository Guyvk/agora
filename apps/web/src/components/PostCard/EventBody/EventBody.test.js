import React from 'react'
import { DateTimeHelpers } from '@hylo/shared'
import { render, screen, waitFor } from 'util/testing/reactTestingLibraryExtended'
import EventBody from './EventBody'

describe('EventBody', () => {
  it('renders event details correctly', () => {
    const startTime = '2023-03-06T12:00:00.000Z'
    const endTime = '2023-03-06T15:00:00.000Z'
    const timezone = 'UTC'
    const event = {
      id: '1',
      location: 'Oakland',
      title: 'Test Event',
      startTime,
      endTime,
      timezone,
      groups: [{ id: '1', name: 'Group 1', slug: 'group1' }]
    }

    const props = {
      event,
      slug: 'sluggo',
      expanded: true,
      className: 'external-class',
      respondToEvent: jest.fn()
    }

    render(<EventBody {...props} />)

    expect(screen.getByText('Test Event')).toBeInTheDocument()
    const expectedTime = DateTimeHelpers.formatEventTimeDisplay({
      start: startTime,
      end: endTime,
      eventTimezone: timezone
    }).primary.replace(/\s/g, ' ')
    expect(screen.getByText((content) => content.replace(/\s/g, ' ') === expectedTime)).toBeInTheDocument()
    expect(screen.getByText(/Oakland/)).toBeInTheDocument()
  })

  // Agora: guest links are for Meetings only; an Event has no meeting room
  it('asks for a guest link on a Meeting, never on an Event', async () => {
    const originalFetch = global.fetch
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ canManage: false }) }))
    try {
      const base = { id: '7', title: 'T', startTime: '2023-03-06T12:00:00.000Z', endTime: '2023-03-06T15:00:00.000Z', timezone: 'UTC', groups: [] }
      const props = { slug: 's', expanded: true, respondToEvent: jest.fn(), currentUser: { id: '1' } }
      const { unmount } = render(<EventBody {...props} event={{ ...base, type: 'event', agoraKind: 'event' }} />)
      expect(global.fetch).not.toHaveBeenCalled()
      unmount()
      render(<EventBody {...props} event={{ ...base, type: 'event', agoraKind: 'meeting' }} />)
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/noo/meeting/7/guest-link', expect.anything()))
    } finally {
      global.fetch = originalFetch
    }
  })
})
