import React from 'react'
import { graphql, HttpResponse } from 'msw'
import orm from 'store/models'
import mockGraphqlServer from 'util/testing/mockGraphqlServer'
import extractModelsForTest from 'util/testing/extractModelsForTest'
import { AllTheProviders, render, screen } from 'util/testing/reactTestingLibraryExtended'
import { AuthSessionStatus } from 'store/reducers/authSession'
import GroupDetail from './GroupDetail'

jest.mock('components/ui/tooltip', () => ({
  TooltipProvider: ({ children }) => children,
  Tooltip: ({ children }) => children,
  TooltipTrigger: ({ children }) => children,
  TooltipContent: () => null
}))
jest.mock('hooks/useRouteParams', () => () => ({ groupSlug: 'governance' }))

function loggedInNonMember () {
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
    me: { id: '1', name: 'Test User', hasRegistered: true, emailValidated: true, memberships: [] }
  }, 'Me', ormSession)
  return AllTheProviders(reduxState, ['/groups/governance'])
}

// Agora: the Join button is at the top of the page of a circle you are not a member of
it('shows the Join button above the description', async () => {
  mockGraphqlServer.use(
    graphql.operation(({ query }) => {
      if (!query.includes('GroupDetailsQuery')) return undefined
      return HttpResponse.json({
        data: {
          group: {
            id: '7',
            slug: 'governance',
            name: 'Governance',
            type: null,
            accessibility: 2,
            visibility: 2,
            purpose: 'Decide together',
            description: 'A long description of what this circle does',
            settings: { askJoinQuestions: false },
            agreements: { items: [] },
            joinQuestions: { items: [] }
          }
        }
      })
    })
  )

  render(<GroupDetail />, { wrapper: loggedInNonMember() })

  const button = await screen.findByRole('button', { name: /^Join/ })
  const description = await screen.findByText(/A long description of what this circle does/)
  // The description comes after the button in the page
  expect(button.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
