// Agora: the welcome steps for new members.
import React from 'react'
import orm from 'store/models'
import { AllTheProviders, render, screen, fireEvent, within } from 'util/testing/reactTestingLibraryExtended'
import WelcomeSteps, { hideWelcomeStepsOn } from './WelcomeSteps'
import { pickMyCircle } from './useMyCircle'

function setup ({ me = {}, circles = [{ id: '7', slug: 'governance', name: 'Governance' }], path = '/groups/governance/chat' } = {}) {
  const session = orm.mutableSession(orm.getEmptyState())
  session.Me.create({ id: '1', name: 'Amara Okafor', settings: { toursSeen: [] }, ...me })
  circles.forEach((c, i) => {
    session.Group.create({ id: c.id, slug: c.slug, name: c.name, type: c.type })
    session.Membership.create({ id: `m${i}`, group: c.id, person: '1', lastViewedAt: c.lastViewedAt })
  })
  return render(<WelcomeSteps />, { wrapper: AllTheProviders({ orm: session.state }, [path]) })
}

const steps = () => screen.getAllByTestId('welcome-step')

describe('WelcomeSteps', () => {
  it('shows four steps with links for a new member', () => {
    setup()
    expect(screen.getByRole('heading', { name: /Welcome to Agora, Amara/ })).toBeInTheDocument()
    expect(screen.getByText('0 of 4 done')).toBeInTheDocument()
    expect(steps()).toHaveLength(4)
    expect(screen.getByRole('link', { name: 'Fill in your profile' })).toHaveAttribute('href', '/my/edit-profile')
    expect(screen.getByRole('link', { name: 'Open your circle, Governance' })).toHaveAttribute('href', '/groups/governance')
    expect(screen.getByRole('link', { name: 'Read the Agora guide' })).toHaveAttribute('href', '/guide')
    expect(screen.getByRole('link', { name: 'Say hi in your circle' })).toHaveAttribute('href', '/groups/governance/chat')
  })

  it('ticks off a filled in profile and an opened circle', () => {
    setup({ me: { tagline: 'Designer in Lisbon' }, circles: [{ id: '7', slug: 'governance', name: 'Governance', lastViewedAt: '2026-10-18T10:00:00Z' }] })
    expect(screen.getByText('2 of 4 done')).toBeInTheDocument()
    expect(steps()[0]).toHaveAttribute('data-done', 'true')
    expect(steps()[1]).toHaveAttribute('data-done', 'true')
    expect(within(steps()[0]).queryByRole('link')).not.toBeInTheDocument()
  })

  it('ticks off "say hi" once its link is used', () => {
    setup()
    fireEvent.click(screen.getByRole('link', { name: 'Say hi in your circle' }))
    expect(steps()[3]).toHaveAttribute('data-done', 'true')
    expect(screen.getByText('1 of 4 done')).toBeInTheDocument()
  })

  it('goes away when closed, and stays away', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close the welcome steps' }))
    expect(screen.queryByTestId('agora-welcome-steps')).not.toBeInTheDocument()
  })

  it('stays away for someone who closed it before', () => {
    setup({ me: { settings: { toursSeen: ['agora-welcome-dismissed'] } } })
    expect(screen.queryByTestId('agora-welcome-steps')).not.toBeInTheDocument()
  })

  it('is not shown while the sign-up wizard is still open', () => {
    setup({ me: { settings: { toursSeen: [], signupInProgress: true } } })
    expect(screen.queryByTestId('agora-welcome-steps')).not.toBeInTheDocument()
  })

  it('is not shown once every step is done', () => {
    setup({
      me: { bio: 'I like circles', settings: { toursSeen: ['agora-guide-read', 'agora-said-hi'] } },
      circles: [{ id: '7', slug: 'governance', name: 'Governance', lastViewedAt: '2026-10-18T10:00:00Z' }]
    })
    expect(screen.queryByTestId('agora-welcome-steps')).not.toBeInTheDocument()
  })

  it('asks someone without a circle to get an invitation', () => {
    setup({ circles: [], path: '/my/posts' })
    expect(screen.getByText('Join a circle: ask a steward for an invitation')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Say hi/ })).not.toBeInTheDocument()
  })

  it('keeps out of the way on maps, messages, settings and the welcome pages', () => {
    expect(hideWelcomeStepsOn('/welcome/explore')).toBe(true)
    expect(hideWelcomeStepsOn('/messages/12')).toBe(true)
    expect(hideWelcomeStepsOn('/groups/governance/map')).toBe(true)
    expect(hideWelcomeStepsOn('/groups/governance/settings/invite')).toBe(true)
    expect(hideWelcomeStepsOn('/groups/governance/welcome')).toBe(true)
    expect(hideWelcomeStepsOn('/groups/governance/chat')).toBe(false)
    expect(hideWelcomeStepsOn('/guide')).toBe(false)
  })
})

describe('pickMyCircle', () => {
  it('picks the circle opened last, and never a space', () => {
    const memberships = [
      { group: { slug: 'a', name: 'A' }, lastViewedAt: '2026-10-01T00:00:00Z' },
      { group: { slug: 'b', name: 'B' }, lastViewedAt: '2026-10-15T00:00:00Z' },
      { group: { slug: 'c', name: 'C', type: 'space' }, lastViewedAt: '2026-10-18T00:00:00Z' }
    ]
    expect(pickMyCircle(memberships)).toEqual({ slug: 'b', name: 'B', opened: true })
  })

  it('takes the first circle when none was opened, and null without circles', () => {
    expect(pickMyCircle([{ group: { slug: 'a', name: 'A' } }])).toEqual({ slug: 'a', name: 'A', opened: false })
    expect(pickMyCircle([])).toBeNull()
  })
})
