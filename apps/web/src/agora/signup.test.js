// Agora: the sign-up page on an invitation-only Agora, with a pretend server.
import React from 'react'
import { AllTheProviders, render, screen } from 'util/testing/reactTestingLibraryExtended'
import Signup from 'routes/NonAuthLayoutRouter/Signup/Signup'
import { sendEmailVerification } from 'routes/NonAuthLayoutRouter/Signup/Signup.store'
import { invitationFromPath } from './signup'

function fakeServer (answer) {
  global.fetch = jest.fn(async url => {
    if (url !== '/noo/agora/signup') throw new Error(`unexpected request ${url}`)
    if (answer === 'down') return { ok: false, status: 502, json: async () => ({}) }
    return { ok: true, json: async () => ({ inviteOnly: answer }) }
  })
}

// The test setup puts its own pretend fetch in place, which must come back afterwards
const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
})

function renderSignup (returnToPath) {
  return render(<Signup location={{ search: '' }} />, {}, AllTheProviders(returnToPath ? { returnToPath } : {}))
}

describe('invitationFromPath', () => {
  it('finds the join link or invitation the person came with', () => {
    expect(invitationFromPath('/groups/governance/about?accessCode=abc123')).toEqual({ accessCode: 'abc123' })
    expect(invitationFromPath('/groups/governance/about?token=t-0k3n')).toEqual({ invitationToken: 't-0k3n' })
  })

  it('finds a claim link for a profile', () => {
    const secret = 'abc_DEF-123'.padEnd(43, 'x')
    expect(invitationFromPath(`/claim/${secret}`)).toEqual({ claimToken: secret })
    expect(invitationFromPath('/claim/too-short')).toBe(null)
    expect(invitationFromPath(`/somewhere/claim/${secret}`)).toBe(null)
  })

  it('finds nothing without one', () => {
    expect(invitationFromPath(null)).toBe(null)
    expect(invitationFromPath('/groups/governance/about')).toBe(null)
    expect(invitationFromPath('/groups/governance/about?other=1')).toBe(null)
  })
})

describe('the sign-up page', () => {
  it('says Agora is by invitation, and has no email box, for someone without an invitation', async () => {
    fakeServer(true)
    renderSignup()
    expect(await screen.findByText('Agora is by invitation')).toBeInTheDocument()
    expect(screen.getByText('To make an account you need an invitation to a circle. Ask a 7BP steward for one.')).toBeInTheDocument()
    expect(screen.queryByText('Enter your email to get started:')).not.toBeInTheDocument()
  })

  it('shows the email box to someone who came with a join link', async () => {
    fakeServer(true)
    renderSignup('/groups/governance/about?accessCode=abc123')
    expect(await screen.findByText('Enter your email to get started:')).toBeInTheDocument()
    expect(screen.queryByText('Agora is by invitation')).not.toBeInTheDocument()
  })

  it('shows the email box to someone who came with an invitation email', async () => {
    fakeServer(true)
    renderSignup('/groups/governance/about?token=t-0k3n')
    expect(await screen.findByText('Enter your email to get started:')).toBeInTheDocument()
  })

  it('shows the email box to someone who came with a claim link', async () => {
    fakeServer(true)
    renderSignup('/claim/' + 'k'.repeat(43))
    expect(await screen.findByText('Enter your email to get started:')).toBeInTheDocument()
    expect(screen.queryByText('Agora is by invitation')).not.toBeInTheDocument()
  })

  it('shows the email box to everyone when sign-up is open, as in Hylo', async () => {
    fakeServer(false)
    renderSignup()
    expect(await screen.findByText('Enter your email to get started:')).toBeInTheDocument()
  })

  it('shows the email box when the server cannot be asked (the server still checks)', async () => {
    fakeServer('down')
    renderSignup()
    expect(await screen.findByText('Enter your email to get started:')).toBeInTheDocument()
  })

  it('has no Google button', async () => {
    fakeServer(false)
    renderSignup()
    await screen.findByText('Enter your email to get started:')
    expect(screen.queryByText(/Google/)).not.toBeInTheDocument()
  })
})

describe('sending the sign-up email', () => {
  it('sends the invitation along', () => {
    const action = sendEmailVerification('new@agora.test', { accessCode: 'abc123' })
    expect(action.graphql.variables).toEqual({ email: 'new@agora.test', invitationToken: undefined, accessCode: 'abc123' })
    expect(action.graphql.query).toContain('sendEmailVerification(email: $email, invitationToken: $invitationToken, accessCode: $accessCode, claimToken: $claimToken)')
  })

  it('sends a claim link along', () => {
    const claimToken = 'A'.repeat(43)
    expect(sendEmailVerification('new@agora.test', { claimToken }).graphql.variables).toEqual({ email: 'new@agora.test', claimToken })
  })

  it('works without one, as before', () => {
    expect(sendEmailVerification('new@agora.test').graphql.variables.email).toBe('new@agora.test')
  })
})
