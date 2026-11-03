import React from 'react'
import { render, screen } from 'util/testing/reactTestingLibraryExtended'
import PostTitle from './index'

describe('PostTitle', () => {
  const defaultProps = {
    title: 'Hello there',
    location: 'New York, NY',
    locationObject: { city: 'New York', region: 'NY' },
    type: 'post',
    onClick: jest.fn(),
    highlightProps: { term: 'Hello' }
  }

  it('renders the title correctly', () => {
    render(<PostTitle {...defaultProps} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
  })

  it('renders the location for non-event posts', () => {
    render(<PostTitle {...defaultProps} />)
    expect(screen.getByText('New York, NY')).toBeInTheDocument()
    expect(screen.getByTestId('icon-Location')).toBeInTheDocument()
  })

  it('renders location for event posts', () => {
    render(<PostTitle {...defaultProps} type='event' />)
    expect(screen.getByText('New York, NY')).toBeInTheDocument()
    expect(screen.getByTestId('icon-Location')).toBeInTheDocument()
  })

  // Agora: calls only in the event's own meeting room, never another platform's link
  it('shows the meeting room, and not a link to another platform', () => {
    render(<PostTitle {...defaultProps} id='7' type='event' meetingLink='https://zoom.us/j/123' location='' />)
    expect(screen.queryByText('Join online')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Video meeting in Agora (with minutes)' })).toHaveAttribute('href', '/noo/meeting/7/room')
  })

  // Agora: the meeting room opens in this same tab, and the room sends people back to the post
  it('opens the meeting room in the same tab, with a video icon', () => {
    render(<PostTitle {...defaultProps} id='7' type='event' location='' />)
    const link = screen.getByRole('link', { name: 'Video meeting in Agora (with minutes)' })
    expect(link).not.toHaveAttribute('target')
    expect(screen.getByTestId('icon-AgoraMeeting')).toBeInTheDocument()
  })

  it('applies constrained class when constrained prop is true', () => {
    render(<PostTitle {...defaultProps} constrained />)
    expect(screen.getByText('Hello there')).toHaveClass('constrained')
  })

  it('calls onClick when title is clicked', () => {
    render(<PostTitle {...defaultProps} />)
    screen.getByText('Hello there').click()
    expect(defaultProps.onClick).toHaveBeenCalled()
  })

  it.skip('applies highlight to the title', () => {
    render(<PostTitle {...defaultProps} />)
    expect(screen.getByText('Hello')).toHaveClass('highlight')
  })
})
