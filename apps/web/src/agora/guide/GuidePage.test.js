// Agora: the guide page.
import React from 'react'
import orm from 'store/models'
import { AllTheProviders, render, screen, within, fireEvent } from 'util/testing/reactTestingLibraryExtended'
import { OPEN_HELP_EVENT } from '../help/openHelp'
import GuidePage from './GuidePage'
import WelcomeSteps from './WelcomeSteps'

function providers ({ circle = true } = {}) {
  const session = orm.mutableSession(orm.getEmptyState())
  session.Me.create({ id: '1', name: 'Amara Okafor', settings: { toursSeen: [] } })
  if (circle) {
    session.Group.create({ id: '7', slug: 'governance', name: 'Governance' })
    session.Membership.create({ id: 'm1', group: '7', person: '1' })
  }
  return AllTheProviders({ orm: session.state }, ['/guide'])
}

describe('GuidePage', () => {
  it('explains every part of Agora in short sections', () => {
    render(<GuidePage />, { wrapper: providers() })
    const titles = screen.getAllByTestId('guide-section').map(s => within(s).getByRole('heading').textContent.trim())
    expect(titles).toEqual([
      'What Agora is',
      'Circles',
      'Posts, discussions and proposals',
      'Events and meetings',
      'Files',
      'Playbook',
      'Contacts',
      'Notifications and email',
      'Your profile',
      'Getting help',
      'Rules and privacy'
    ])
    // A list of the sections at the top, linking to each one
    const nav = screen.getByRole('navigation', { name: 'On this page' })
    expect(within(nav).getByRole('link', { name: 'Files' })).toHaveAttribute('href', '#files')
  })

  it('says honestly what is not ready yet', () => {
    render(<GuidePage />, { wrapper: providers() })
    const soon = screen.getAllByTestId('guide-coming-soon').map(n => n.textContent)
    expect(soon).toHaveLength(1)
    expect(soon[0]).toMatch(/Emails from Agora/)
  })

  it('links to the member\'s own circle and its playbook, and to pages that exist', () => {
    render(<GuidePage />, { wrapper: providers() })
    expect(screen.getByRole('link', { name: 'Open Governance' })).toHaveAttribute('href', '/groups/governance')
    expect(screen.getByRole('link', { name: 'Open the playbook of Governance' })).toHaveAttribute('href', '/groups/governance/playbook')
    expect(screen.getByRole('link', { name: 'Open Contacts' })).toHaveAttribute('href', '/contacts')
    expect(screen.getByRole('link', { name: 'Choose my notifications' })).toHaveAttribute('href', '/my/notifications')
    expect(screen.getByRole('link', { name: 'Fill in my profile' })).toHaveAttribute('href', '/my/edit-profile')
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    // Meeting notes are live, so they are explained, not promised
    expect(screen.getByText(/posts a short summary with decisions and actions/)).toBeInTheDocument()
  })

  it('opens the Help window from Getting help', () => {
    const opened = jest.fn()
    window.addEventListener(OPEN_HELP_EVENT, opened)
    try {
      render(<GuidePage />, { wrapper: providers() })
      expect(screen.getByText(/Open Help, with the button below/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Open Help' }))
      expect(opened).toHaveBeenCalledTimes(1)
      expect(opened.mock.calls[0][0].detail).toEqual({ view: 'new', part: null })
    } finally {
      window.removeEventListener(OPEN_HELP_EVENT, opened)
    }
  })

  it('points to the list of circles for someone without one', () => {
    render(<GuidePage />, { wrapper: providers({ circle: false }) })
    expect(screen.getByRole('link', { name: 'See my circles' })).toHaveAttribute('href', '/my/groups')
    expect(screen.queryByRole('link', { name: /Open the playbook/ })).not.toBeInTheDocument()
  })

  it('ticks off "Read the guide" in the welcome steps once opened', () => {
    render(<><WelcomeSteps /><GuidePage /></>, { wrapper: providers() })
    const guideStep = screen.getAllByTestId('welcome-step')[2]
    expect(guideStep).toHaveAttribute('data-done', 'true')
    expect(guideStep).toHaveTextContent('Read the Agora guide')
  })
})
