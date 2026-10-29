import React from 'react'
import { DateTimeHelpers } from '@hylo/shared'
import { render, screen } from 'util/testing/reactTestingLibraryExtended'
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
    const expectedTime = DateTimeHelpers.formatEventTimeDisplay({
      start: startTime,
      end: endTime,
      eventTimezone: timezone
    }).primary.replace(/\s/g, ' ')
    expect(screen.getByText((content) => content.replace(/\s/g, ' ') === expectedTime)).toBeInTheDocument()
    expect(screen.getByText(/Oakland/)).toBeInTheDocument()
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
})
