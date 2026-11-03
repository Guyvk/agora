import React from 'react'
import { DateTimeHelpers } from '@hylo/shared'
import { render, screen, waitFor } from 'util/testing/reactTestingLibraryExtended'
import userEvent from '@testing-library/user-event'
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
    const display = DateTimeHelpers.formatEventTimeDisplay({
      start: startTime,
      end: endTime,
      eventTimezone: timezone
    })
    const normalize = content => content.replace(/\s/g, ' ')
    const viewerTime = normalize(display.secondary || display.primary)
    const topLine = display.secondary ? `Your time: ${viewerTime}` : viewerTime
    expect(screen.getByText((content, element) => (
      element.tagName === 'SPAN' && normalize(content) === topLine
    ))).toBeInTheDocument()
    if (display.secondary) {
      expect(screen.getByText((content, element) => (
        element.tagName === 'SPAN' && normalize(content) === `Local time: ${normalize(display.primary)}`
      ))).toBeInTheDocument()
    }
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

  describe('past events', () => {
    const base = { id: '1', title: 'Weekly meeting', timezone: 'UTC', groups: [{ id: '1', name: 'Group 1', slug: 'group1' }] }
    const hours = n => new Date(Date.now() + n * 3600 * 1000).toISOString()

    it('shows the passed label and a Set a new date button for people who may edit', async () => {
      const onEditEvent = jest.fn()
      const event = { ...base, startTime: hours(-50), endTime: hours(-48) }
      render(<EventBody event={event} slug='sluggo' canEditEvent onEditEvent={onEditEvent} respondToEvent={jest.fn()} />)

      expect(screen.getByText('This event has passed')).toBeInTheDocument()
      await userEvent.click(screen.getByText('Set a new date'))
      expect(onEditEvent).toHaveBeenCalledTimes(1)
    })

    it('says meeting for a Meeting', () => {
      const event = { ...base, agoraKind: 'meeting', startTime: hours(-50), endTime: hours(-48) }
      render(<EventBody event={event} slug='sluggo' respondToEvent={jest.fn()} />)

      expect(screen.getByText('This meeting has passed')).toBeInTheDocument()
    })

    it('shows the label but no button for other people', () => {
      const event = { ...base, startTime: hours(-50), endTime: hours(-48) }
      render(<EventBody event={event} slug='sluggo' canEditEvent={false} onEditEvent={jest.fn()} respondToEvent={jest.fn()} />)

      expect(screen.getByText('This event has passed')).toBeInTheDocument()
      expect(screen.queryByText('Set a new date')).not.toBeInTheDocument()
    })

    it('uses the start time when there is no end time', () => {
      const event = { ...base, startTime: hours(-5) }
      render(<EventBody event={event} slug='sluggo' respondToEvent={jest.fn()} />)

      expect(screen.getByText('This event has passed')).toBeInTheDocument()
    })

    it('shows nothing for an event that has not happened yet', () => {
      const event = { ...base, startTime: hours(48), endTime: hours(50) }
      render(<EventBody event={event} slug='sluggo' canEditEvent onEditEvent={jest.fn()} respondToEvent={jest.fn()} />)

      expect(screen.queryByText('This event has passed')).not.toBeInTheDocument()
      expect(screen.queryByText('Set a new date')).not.toBeInTheDocument()
    })
  })

  it('omits the Your time label when the event timezone matches the viewer', () => {
    const startTime = '2023-03-06T12:00:00.000Z'
    const endTime = '2023-03-06T15:00:00.000Z'
    const timezone = DateTimeHelpers.getCurrentTimezone()
    const event = {
      id: '1',
      location: 'Oakland',
      title: 'Same Zone Event',
      startTime,
      endTime,
      timezone,
      groups: [{ id: '1', name: 'Group 1', slug: 'group1' }]
    }

    render(<EventBody event={event} slug='sluggo' expanded respondToEvent={jest.fn()} />)

    const display = DateTimeHelpers.formatEventTimeDisplay({
      start: startTime,
      end: endTime,
      eventTimezone: timezone
    })
    const normalize = content => content.replace(/\s/g, ' ')
    expect(display.secondary).toBeNull()
    expect(screen.getByText((content, element) => (
      element.tagName === 'SPAN' && normalize(content) === normalize(display.primary)
    ))).toBeInTheDocument()
    expect(screen.queryByText(/Your time:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Local time:/)).not.toBeInTheDocument()
  })

  it('shows only the viewer time on the card', () => {
    const startTime = '2023-03-06T12:00:00.000Z'
    const endTime = '2023-03-06T15:00:00.000Z'
    const timezone = 'America/Los_Angeles'
    const event = {
      id: '1',
      location: 'Oakland',
      title: 'Test Event',
      startTime,
      endTime,
      timezone,
      groups: [{ id: '1', name: 'Group 1', slug: 'group1' }]
    }

    render(<EventBody event={event} slug='sluggo' expanded={false} respondToEvent={jest.fn()} />)

    const display = DateTimeHelpers.formatEventTimeDisplay({
      start: startTime,
      end: endTime,
      eventTimezone: timezone
    })
    const normalize = content => content.replace(/\s/g, ' ')
    const viewerTime = normalize(display.secondary || display.primary)
    expect(screen.getByText((content, element) => (
      element.tagName === 'SPAN' && normalize(content) === viewerTime
    ))).toBeInTheDocument()
    expect(screen.queryByText(/Your time:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Local time:/)).not.toBeInTheDocument()
  })
})
