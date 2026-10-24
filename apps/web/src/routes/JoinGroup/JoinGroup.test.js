import React from 'react'
import { useSelector } from 'react-redux'
import { Route, Routes } from 'react-router-dom'
import { graphql, HttpResponse } from 'msw'
import orm from 'store/models'
import mockGraphqlServer from 'util/testing/mockGraphqlServer'
import getReturnToPath from 'store/selectors/getReturnToPath'
import extractModelsForTest from 'util/testing/extractModelsForTest'
import { AllTheProviders, render, screen, waitFor } from 'util/testing/reactTestingLibraryExtended'
import { AuthSessionStatus } from 'store/reducers/authSession'
import JoinGroup from './JoinGroup'

jest.mock('components/ui/tooltip', () => ({ TooltipProvider: ({ children }) => children }))

afterEach(() => {
  jest.restoreAllMocks()
})

function currentUserProvider (authStateComplete, email) {
  const ormSession = orm.mutableSession(orm.getEmptyState())
  // Authorization/signup state is now driven by the `authSession` slice, not the ORM `me`.
  const reduxState = {
    orm: ormSession.state,
    authSession: {
      status: AuthSessionStatus.Authenticated,
      userId: '1',
      emailValidated: true,
      hasRegistered: true,
      signupInProgress: !authStateComplete,
      checkedAt: Date.now()
    }
  }

  extractModelsForTest({
    me: {
      id: '1',
      name: 'Test User',
      ...(email ? { email } : {}),
      hasRegistered: true,
      emailValidated: true,
      settings: {
        signupInProgress: !authStateComplete
      },
      memberships: [
        {
          id: '2',
          person: {
            id: '1'
          },
          group: {
            id: '3',
            slug: 'test-group'
          }
        }
      ]
    }
  }, 'Me', ormSession)

  return AllTheProviders(reduxState, ['/join-group'])
}

// Agora: someone logged in who is already a member lands in the circle itself
it('sends a signed-up member of the circle straight into the circle', async () => {
  const joinSpy = jest.fn()
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupId: '3',
            groupSlug: 'test-group'
          }
        }
      })
    }),
    graphql.operation(({ query }) => {
      if (!query.includes('joinGroup')) return undefined
      joinSpy()
      return HttpResponse.json({ data: {} })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'test-access-code' })

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route path='/groups/test-group' element={<div>inside test-group</div>} />
      </Routes>
    </>,
    { wrapper: currentUserProvider(true) }
  )

  await waitFor(() => {
    expect(screen.getByText('inside test-group')).toBeInTheDocument()
  })
  expect(joinSpy).not.toHaveBeenCalled()
})

// Agora: someone logged in who opens a join link becomes a member right away
it('joins a signed-up user to the circle of a join link and opens the circle', async () => {
  let joinVariables
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupId: '7',
            groupSlug: 'governance'
          }
        }
      })
    }),
    graphql.operation(({ query, variables }) => {
      if (!query.includes('joinGroup')) return undefined
      joinVariables = variables
      return HttpResponse.json({
        data: {
          joinGroup: {
            id: '70',
            group: { id: '7', name: 'Circle', slug: 'governance' },
            person: { id: '1' },
            lastViewedAt: null,
            settings: { agreementsAcceptedAt: null, joinQuestionsAnsweredAt: null, showJoinForm: true }
          }
        }
      })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'join-governance' })

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route path='/groups/governance' element={<div>inside governance</div>} />
        <Route path='/groups/governance/about' element={<div>governance about page</div>} />
      </Routes>
    </>,
    { wrapper: currentUserProvider(true) }
  )

  await waitFor(() => {
    expect(screen.getByText('inside governance')).toBeInTheDocument()
  })
  expect(joinVariables).toMatchObject({ groupId: '7', accessCode: 'join-governance' })
})

// Agora: an email invitation for the address logged in joins too, with its token
it('joins a signed-up user with an email invitation for their own address', async () => {
  let joinVariables
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupId: '7',
            groupSlug: 'governance',
            email: 'TEST@agora.test'
          }
        }
      })
    }),
    graphql.operation(({ query, variables }) => {
      if (!query.includes('joinGroup')) return undefined
      joinVariables = variables
      return HttpResponse.json({
        data: {
          joinGroup: {
            id: '70',
            group: { id: '7', name: 'Circle', slug: 'governance' },
            person: { id: '1' },
            lastViewedAt: null,
            settings: { agreementsAcceptedAt: null, joinQuestionsAnsweredAt: null, showJoinForm: true }
          }
        }
      })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({})
  jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ pathname: '/join-group', search: '?token=the-token' })

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route path='/groups/governance' element={<div>inside governance</div>} />
      </Routes>
    </>,
    { wrapper: currentUserProvider(true, 'test@agora.test') }
  )

  await waitFor(() => {
    expect(screen.getByText('inside governance')).toBeInTheDocument()
  })
  expect(joinVariables).toMatchObject({ groupId: '7', invitationToken: 'the-token' })
})

// Agora: an email invitation for another address is not used, and nothing is joined
it('does not join with an email invitation sent to another address', async () => {
  const joinSpy = jest.fn()
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupId: '7',
            groupSlug: 'governance',
            email: 'someone-else@agora.test'
          }
        }
      })
    }),
    graphql.operation(({ query }) => {
      if (!query.includes('joinGroup')) return undefined
      joinSpy()
      return HttpResponse.json({ data: {} })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({})
  jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ pathname: '/join-group', search: '?token=the-token' })

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route path='/groups/governance' element={<div>inside governance</div>} />
      </Routes>
    </>,
    { wrapper: currentUserProvider(true, 'test@agora.test') }
  )

  await waitFor(() => {
    expect(screen.getAllByText(/someone-else@agora.test/).length).toBeGreaterThan(0)
  })
  expect(screen.queryByText('inside governance')).not.toBeInTheDocument()
  expect(joinSpy).not.toHaveBeenCalled()
})

// Agora: a circle with join questions shows that step first, nobody is joined behind their back
it('opens the about page instead of joining when the circle has join questions', async () => {
  const joinSpy = jest.fn()
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: { checkInvitation: { valid: true, groupId: '7', groupSlug: 'governance' } }
      })
    }),
    graphql.query('GroupDetailsQuery', () => {
      return HttpResponse.json({
        data: {
          group: {
            id: '7',
            slug: 'governance',
            name: 'Governance',
            settings: { askJoinQuestions: true },
            joinQuestions: { items: [{ id: '1', questionId: '1', text: 'Why do you want to join?' }] },
            agreements: { items: [] }
          }
        }
      })
    }),
    graphql.operation(({ query }) => {
      if (!query.includes('joinGroup')) return undefined
      joinSpy()
      return HttpResponse.json({ data: {} })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'join-governance' })

  render(
    <Routes>
      <Route path='/join-group' element={<JoinGroup />} />
      <Route path='/groups/governance' element={<div>inside governance</div>} />
      <Route path='/groups/governance/about' element={<div>governance about page</div>} />
    </Routes>,
    { wrapper: currentUserProvider(true) }
  )

  await waitFor(() => {
    expect(screen.getByText('governance about page')).toBeInTheDocument()
  })
  expect(joinSpy).not.toHaveBeenCalled()
})

// Agora: when joining does not work, the About page with its Join button, as before
it('falls back to the circle about page when joining does not work', async () => {
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupId: '7',
            groupSlug: 'governance'
          }
        }
      })
    }),
    graphql.operation(({ query }) => {
      if (!query.includes('joinGroup')) return undefined
      return HttpResponse.json({ errors: [{ message: 'You must be a member of group Other first' }], data: { joinGroup: null } })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'join-governance' })

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route path='/groups/governance' element={<div>inside governance</div>} />
        <Route
          path='/groups/governance/about'
          element={<div>/groups/governance/about?accessCode=join-governance</div>}
        />
      </Routes>
    </>,
    { wrapper: currentUserProvider(true) }
  )

  await waitFor(() => {
    expect(screen.getByText('/groups/governance/about?accessCode=join-governance')).toBeInTheDocument()
  })
})

it('shows alert and navigates home when invitation is invalid and user is not signed-up', async () => {
  const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
  const navigateMock = jest.fn()

  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: false
          }
        }
      })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'anything' })
  jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ pathname: '/join-group', search: '' })
  jest.spyOn(require('react-router-dom'), 'useNavigate').mockReturnValue(navigateMock)

  render(
    <Routes>
      <Route path='/join-group' element={<JoinGroup />} />
    </Routes>,
    { wrapper: currentUserProvider(false) }
  )

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith('/all')
  })

  alertSpy.mockRestore()
})

it('auto-joins a space and opens it when the user is already a parent member', async () => {
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupId: '99',
            groupSlug: 'test-group-the-space',
            isSpace: true,
            parentGroupSlug: 'test-group'
          }
        }
      })
    }),
    graphql.mutation('JoinSpace', () => {
      return HttpResponse.json({
        data: {
          joinSpace: {
            id: '55',
            group: {
              id: '99',
              slug: 'test-group-the-space',
              type: 'space',
              parentId: '3'
            },
            person: { id: '1' }
          }
        }
      })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'space-access-code' })

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route
          path='/groups/test-group/spaces/the-space'
          element={<div>/groups/test-group/spaces/the-space?accessCode=space-access-code</div>}
        />
      </Routes>
    </>,
    { wrapper: currentUserProvider(true) }
  )

  await waitFor(() => {
    expect(screen.getByText('/groups/test-group/spaces/the-space?accessCode=space-access-code')).toBeInTheDocument()
  })
})

// Agora: a space invitation for someone outside the parent circle joins the parent circle (the server adds the space) and opens the space
it('joins the parent circle for a space invitation when the user is not a parent member, and opens the space', async () => {
  let joinVariables
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupId: '99',
            groupSlug: 'parent-group-the-space',
            isSpace: true,
            parentGroupId: '50',
            parentGroupSlug: 'parent-group'
          }
        }
      })
    }),
    graphql.operation(({ query, variables }) => {
      if (!query.includes('joinGroup')) return undefined
      joinVariables = variables
      return HttpResponse.json({
        data: {
          joinGroup: {
            id: '70',
            group: { id: '50', name: 'Circle', slug: 'parent-group' },
            person: { id: '1' },
            lastViewedAt: null,
            settings: { agreementsAcceptedAt: null, joinQuestionsAnsweredAt: null, showJoinForm: true }
          }
        }
      })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'space-access-code' })

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route path='/groups/parent-group/spaces/the-space' element={<div>inside the space</div>} />
      </Routes>
    </>,
    { wrapper: currentUserProvider(true) }
  )

  await waitFor(() => {
    expect(screen.getByText('inside the space')).toBeInTheDocument()
  })
  expect(joinVariables).toMatchObject({ groupId: '50', accessCode: 'space-access-code' })
})

it('redirects space invites to the parent group about page when the user is not a parent member and joining is not possible', async () => {
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupSlug: 'the-space',
            isSpace: true,
            parentGroupSlug: 'parent-group'
          }
        }
      })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'space-access-code' })

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route
          path='/groups/parent-group/about'
          element={<div>/groups/parent-group/about?accessCode=space-access-code</div>}
        />
      </Routes>
    </>,
    { wrapper: currentUserProvider(true) }
  )

  await waitFor(() => {
    expect(screen.getByText('/groups/parent-group/about?accessCode=space-access-code')).toBeInTheDocument()
  })
})

it('sets returnToPath and forwards to signup page when invitation is valid and user is not logged-in', async () => {
  mockGraphqlServer.use(
    graphql.query('CheckInvitation', () => {
      return HttpResponse.json({
        data: {
          checkInvitation: {
            valid: true,
            groupSlug: 'test-group'
          }
        }
      })
    })
  )

  jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ accessCode: 'anything' })
  // XXX: I'm not sure this is quite the right way to test this, but couldn't find a better way yet
  jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ pathname: 'route/to/join-group', search: '' })

  const SignupMock = () => {
    const returnToPath = useSelector(getReturnToPath)
    return (
      <>
        <div>{returnToPath}</div>
      </>
    )
  }

  render(
    <>
      <Routes>
        <Route path='/join-group' element={<JoinGroup />} />
        <Route path='/signup' element={<SignupMock />} />
      </Routes>
    </>,
    { wrapper: currentUserProvider(false) }
  )

  await waitFor(() => {
    expect(screen.getByText('/groups/test-group/about?accessCode=anything')).toBeInTheDocument()
  })
})
