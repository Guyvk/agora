// Agora: the 7BP Home look: left bar order, header badges and the circle cards.
import React from 'react'
import { AllTheProviders, render, screen, waitFor } from 'util/testing/reactTestingLibraryExtended'
import useMainCircle, { arrangeNavGroups, resetMainCircleCache } from './mainCircle'
import HomeBadge, { HomeHeaderAccent } from './HomeBadges'
import MainCircleCards from './MainCircleCards'

const main = {
  id: '1',
  slug: '7bp',
  name: '7BP',
  avatarUrl: null,
  circles: [
    { id: '2', slug: 'governance', name: 'Governance', avatarUrl: null, memberCount: 5 },
    { id: '3', slug: 'tech', name: 'Tech Support', avatarUrl: 'https://example.org/t.png', memberCount: 1 }
  ]
}

function fakeServer (data) {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { agoraMainCircle: data } }) }))
}

const g = (slug, extra = {}) => ({ id: slug, slug, name: slug, ...extra })

describe('arrangeNavGroups', () => {
  const groups = [g('test'), g('tech'), g('7bp'), g('governance'), g('other')]

  it('puts the main circle first, its active children next, the rest after', () => {
    const r = arrangeNavGroups(groups, main)
    expect(r.main.slug).toBe('7bp')
    expect(r.children.map(c => c.slug)).toEqual(['tech', 'governance'])
    expect(r.others.map(c => c.slug)).toEqual(['test', 'other'])
  })

  it('treats a circle switched off as a child (not in the list) like any other circle', () => {
    const r = arrangeNavGroups(groups, { ...main, circles: [main.circles[0]] })
    expect(r.children.map(c => c.slug)).toEqual(['governance'])
    expect(r.others.map(c => c.slug)).toEqual(['test', 'tech', 'other'])
  })

  it('changes nothing without a main circle', () => {
    const r = arrangeNavGroups(groups, null)
    expect(r.main).toBe(null)
    expect(r.children).toEqual([])
    expect(r.others).toBe(groups)
  })

  it('has no main when the person is not in it, but still groups children', () => {
    const r = arrangeNavGroups([g('governance'), g('x')], main)
    expect(r.main).toBe(null)
    expect(r.children.map(c => c.slug)).toEqual(['governance'])
  })
})

describe('7BP Home header and cards', () => {
  const originalFetch = global.fetch
  beforeEach(() => resetMainCircleCache())
  afterEach(() => { global.fetch = originalFetch })
  const wrapper = AllTheProviders({}, ['/groups/7bp'])

  it('shows the 7BP Home band and accent in the main circle', async () => {
    fakeServer(main)
    render(<><HomeBadge group={g('7bp')} /><HomeHeaderAccent group={g('7bp')} /></>, { wrapper })
    expect(await screen.findByTestId('agora-home-band')).toHaveTextContent('7BP Home')
    expect(screen.getByTestId('agora-home-accent')).toBeInTheDocument()
    expect(screen.queryByTestId('agora-part-of')).not.toBeInTheDocument()
  })

  it('shows Part of 7BP, linking to the main circle, in an active child', async () => {
    fakeServer(main)
    render(<HomeBadge group={g('governance')} />, { wrapper })
    const link = await screen.findByTestId('agora-part-of')
    expect(link).toHaveTextContent('Part of 7BP')
    expect(link.getAttribute('href')).toBe('/groups/7bp')
    expect(link.getAttribute('target')).toBe(null)
  })

  it('shows nothing in a circle that is not an active child, or when compact', async () => {
    fakeServer(main)
    const { container } = render(<><HomeBadge group={g('test')} /><HomeBadge group={g('governance')} compact /></>, { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(container.querySelector('[data-testid]')).toBe(null)
  })

  it('lists a card per active child circle on the main circle welcome page only', async () => {
    fakeServer(main)
    render(<MainCircleCards group={g('7bp')} />, { wrapper })
    expect(await screen.findByText('Every circle in 7BP')).toBeInTheDocument()
    expect(screen.getByText('Governance').closest('a').getAttribute('href')).toBe('/groups/governance')
    expect(screen.getByText('Tech Support').closest('a').getAttribute('href')).toBe('/groups/tech')
    expect(screen.getByText('5 Members')).toBeInTheDocument()
  })

  it('does not show the cards in another circle', async () => {
    fakeServer(main)
    render(<MainCircleCards group={g('governance')} />, { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByTestId('agora-circle-cards')).not.toBeInTheDocument()
  })

  it('shows nothing when the server answers null', async () => {
    fakeServer(null)
    function Probe () { return <span>{useMainCircle() ? 'yes' : 'no'}</span> }
    render(<Probe />, { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.getByText('no')).toBeInTheDocument()
  })
})
