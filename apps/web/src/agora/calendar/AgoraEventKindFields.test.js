// Agora: choosing Meeting or Event in the post editor, and "for all of 7BP".
import React, { useState } from 'react'
import { render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import AgoraEventKindFields from './AgoraEventKindFields'
import AgoraKindLabel from './AgoraKindLabel'
import { agoraKindOf, forgetCalendarMe } from './api'

function fakeServer (canMarkForAll) {
  forgetCalendarMe()
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ canMarkForAll, mainGroup: { id: '1', name: '7BP', slug: '7bp' } }) }))
}

let latest
function Editor ({ initial, editing }) {
  const [post, setPost] = useState(initial)
  latest = post
  return <AgoraEventKindFields post={post} setPost={setPost} editing={editing} />
}

describe('AgoraEventKindFields', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('knows the kind of a post', () => {
    expect(agoraKindOf({ type: 'event', agoraKind: 'event' })).toBe('event')
    expect(agoraKindOf({ type: 'event', agoraKind: null })).toBe('meeting')
    expect(agoraKindOf({ type: 'discussion' })).toBe(null)
  })

  it('switches between Meeting and Event, and a Meeting is never public', async () => {
    fakeServer(false)
    render(<Editor initial={{ type: 'event', agoraKind: 'event', isPublic: true }} />)
    expect(screen.getByTestId('agora-kind-event')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('agoraKind.eventHelp')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('agora-kind-meeting'))
    expect(latest.agoraKind).toBe('meeting')
    expect(latest.isPublic).toBe(false)
    expect(screen.getByText('agoraKind.meetingHelp')).toBeInTheDocument()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('agora-for-all')).toBeNull()
  })

  it('offers "for all of 7BP" and the invitations to stewards of the main circle only', async () => {
    fakeServer(true)
    render(<Editor initial={{ type: 'event', agoraKind: 'meeting' }} />)
    fireEvent.click(await screen.findByTestId('agora-for-all'))
    expect(latest.agoraForAll).toBe(true)
    fireEvent.click(screen.getByTestId('agora-invite-everyone'))
    expect(latest.agoraInviteEveryone).toBe(true)
    // Switching "for all" off also drops the invitations
    fireEvent.click(screen.getByTestId('agora-for-all'))
    expect(latest.agoraInviteEveryone).toBe(false)
    expect(screen.queryByTestId('agora-invite-everyone')).toBeNull()
  })

  it('does not offer the invitations again when a post is changed', async () => {
    fakeServer(true)
    render(<Editor initial={{ type: 'event', agoraKind: 'meeting', agoraForAll: true }} editing />)
    await screen.findByTestId('agora-for-all')
    expect(screen.queryByTestId('agora-invite-everyone')).toBeNull()
  })

  it('labels a post as Meeting or Event, with "All of 7BP"', () => {
    const { rerender } = render(<AgoraKindLabel post={{ type: 'event', agoraKind: null }} />)
    expect(screen.getByText('Meeting')).toBeInTheDocument()
    rerender(<AgoraKindLabel post={{ type: 'event', agoraKind: 'event', agoraForAll: true }} />)
    expect(screen.getByText('Event')).toBeInTheDocument()
    expect(screen.getByText('All of 7BP')).toBeInTheDocument()
  })
})
