// Agora: an invitation email belongs to the address it was sent to.
// - Logged in with another address: the invitation is not used, a page says so.
// - Not logged in: the sign-up page fills in the invited address and keeps it.
import React from 'react'
import { Route, Routes } from 'react-router-dom'
import { graphql, http, HttpResponse } from 'msw'
import orm from 'store/models'
import mockGraphqlServer from 'util/testing/mockGraphqlServer'
import extractModelsForTest from 'util/testing/extractModelsForTest'
import { AllTheProviders, render, screen, waitFor, fireEvent } from 'util/testing/reactTestingLibraryExtended'
import { AuthSessionStatus } from 'store/reducers/authSession'
import JoinGroup from 'routes/JoinGroup/JoinGroup'
import Signup from 'routes/NonAuthLayoutRouter/Signup/Signup'
import AgoraInvitationForOtherAccount from './AgoraInvitationForOtherAccount'
import { invitationLink, isInvitationForOtherAccount } from './signup'

jest.mock('components/ui/tooltip', () => ({ TooltipProvider: ({ children }) => children }))

afterEach(() => {
  jest.restoreAllMocks()
})

function loggedInAs ({ name, email }) {
  const ormSession = orm.mutableSession(orm.getEmptyState())
  const reduxState = {
    orm: ormSession.state,
    authSession: {
      status: AuthSessionStatus.Authenticated,
      userId: '1',
      emailValidated: true,
      hasRegistered: true,
      signupInProgress: false,
      checkedAt: Date.now()
    }
  }
  extractModelsForTest({
    me: {
      id: '1',
      name,
      email,
      hasRegistered: true,
      emailValidated: true,
      settings: { signupInProgress: false },
      memberships: [{ id: '2', person: { id: '1' }, group: { id: '3', slug: 'governance' } }]
    }
  }, 'Me', ormSession)
  return AllTheProviders(reduxState, ['/h/use-invitation?token=t-0k3n&email=guyvankool%40gmail.com'])
}

function invitationAnswer (checkInvitation) {
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => HttpResponse.json({ data: { checkInvitation } }))
  )
}

function renderJoinGroup (me) {
  // The invitation link from the email, as JoinGroup reads it
  jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({
    pathname: '/h/use-invitation',
    search: '?token=t-0k3n&email=guyvankool%40gmail.com'
  })
  return render(
    <Routes>
      <Route path='/h/use-invitation' element={<JoinGroup />} />
      <Route path='/groups/governance/about' element={<div>the Governance about page</div>} />
    </Routes>,
    { wrapper: loggedInAs(me) }
  )
}

const guy = { name: 'Guy van Koolwijk', email: 'info@guyvankoolwijk.nl' }

describe('isInvitationForOtherAccount', () => {
  it('is true only for an email invitation to another address', () => {
    expect(isInvitationForOtherAccount({ invitationToken: 't', invitationEmail: 'a@x.org', myEmail: 'b@x.org' })).toBe(true)
    expect(isInvitationForOtherAccount({ invitationToken: 't', invitationEmail: ' A@X.org', myEmail: 'a@x.org ' })).toBe(false)
    expect(isInvitationForOtherAccount({ invitationToken: null, invitationEmail: 'a@x.org', myEmail: 'b@x.org' })).toBe(false)
    expect(isInvitationForOtherAccount({ invitationToken: 't', invitationEmail: null, myEmail: 'b@x.org' })).toBe(false)
    expect(isInvitationForOtherAccount({ invitationToken: 't', invitationEmail: 'a@x.org', myEmail: null })).toBe(false)
  })
})

describe('opening an invitation email while logged in', () => {
  it('does not use an invitation for another address, and says whose it is', async () => {
    invitationAnswer({ valid: true, groupId: '3', groupSlug: 'governance', email: 'guyvankool@gmail.com' })
    renderJoinGroup(guy)

    expect(await screen.findByText('This invitation is for guyvankool@gmail.com.')).toBeInTheDocument()
    expect(screen.getByText('You are logged in as Guy van Koolwijk (info@guyvankoolwijk.nl).')).toBeInTheDocument()
    expect(screen.getByText('Log out to accept it as guyvankool@gmail.com.')).toBeInTheDocument()
    expect(screen.getByText('Log out and continue')).toBeInTheDocument()
    expect(screen.queryByText('the Governance about page')).not.toBeInTheDocument()
  })

  it('goes on as before when the invitation is for the address logged in', async () => {
    invitationAnswer({ valid: true, groupId: '3', groupSlug: 'governance', email: 'INFO@guyvankoolwijk.nl' })
    renderJoinGroup(guy)

    expect(await screen.findByText('the Governance about page')).toBeInTheDocument()
    expect(screen.queryByText('Log out and continue')).not.toBeInTheDocument()
  })
})

describe('the "Log out and continue" button', () => {
  it('logs out and opens the invitation link again', async () => {
    const goTo = jest.fn()
    const loggedOut = jest.fn()
    mockGraphqlServer.use(
      http.delete('*/noo/session', () => {
        loggedOut()
        return HttpResponse.json({})
      })
    )

    render(
      <AgoraInvitationForOtherAccount
        invitationToken='t-0k3n'
        invitationEmail='guyvankool@gmail.com'
        myName='Guy van Koolwijk'
        myEmail='info@guyvankoolwijk.nl'
        goTo={goTo}
      />,
      {},
      AllTheProviders({}, ['/h/use-invitation'])
    )
    fireEvent.click(screen.getByText('Log out and continue'))

    await waitFor(() => expect(goTo).toHaveBeenCalledWith('/h/use-invitation?token=t-0k3n&email=guyvankool%40gmail.com'))
    // The page only moves on after the server was asked to log out
    expect(loggedOut).toHaveBeenCalled()
  })

  it('builds the invitation link', () => {
    expect(invitationLink('a b', 'x+y@z.org')).toBe('/h/use-invitation?token=a%20b&email=x%2By%40z.org')
  })
})

describe('signing up from an invitation email', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  function fakeServer (checkInvitation) {
    global.fetch = jest.fn(async url => {
      if (url === '/noo/agora/signup') return { ok: true, json: async () => ({ inviteOnly: true }) }
      throw new Error(`unexpected request ${url}`)
    })
    invitationAnswer(checkInvitation)
  }

  function renderSignup (returnToPath) {
    return render(<Signup location={{ search: '' }} />, {}, AllTheProviders({ returnToPath }))
  }

  it('fills in the invited address and does not let it be changed', async () => {
    fakeServer({ valid: true, groupSlug: 'governance', email: 'guyvankool@gmail.com' })
    renderSignup('/groups/governance/about?token=t-0k3n')

    const box = await screen.findByDisplayValue('guyvankool@gmail.com')
    expect(box).toHaveAttribute('readonly')
    expect(screen.getByText('Your invitation was sent to this address.')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'someone@else.org' } })
    expect(screen.getByDisplayValue('guyvankool@gmail.com')).toBeInTheDocument()
    expect(screen.getByText('Create account')).not.toBeDisabled()
  })

  it('leaves the box empty for a join link, which has no address', async () => {
    fakeServer({ valid: true, groupSlug: 'governance', email: null })
    renderSignup('/groups/governance/about?accessCode=abc123')

    expect(await screen.findByText('Enter your email to get started:')).toBeInTheDocument()
    expect(screen.getByLabelText('email')).toHaveValue('')
    expect(screen.getByLabelText('email')).not.toHaveAttribute('readonly')
  })
})
