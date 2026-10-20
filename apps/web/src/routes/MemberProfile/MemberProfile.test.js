import React from 'react'
import { graphql, HttpResponse } from 'msw'
import mockGraphqlServer from 'util/testing/mockGraphqlServer'
import { AllTheProviders, fireEvent, render, screen, waitFor } from 'util/testing/reactTestingLibraryExtended'
import { RESP_REMOVE_MEMBERS } from 'store/constants'
import denormalized from './MemberProfile.test.json'
import MemberProfile from './MemberProfile.js'
import orm from 'store/models'

function testWrapper (providedState) {
  const ormSession = orm.mutableSession(orm.getEmptyState())
  ormSession.Me.create(denormalized.data.person)
  ormSession.Person.create(denormalized.data.person)
  ormSession.Reaction.create(denormalized.data.person.reactions)
  const reduxState = { orm: ormSession.state, ...providedState }
  return AllTheProviders(reduxState)
}

// Viewing another member's profile (distinct current-user id) within a group, so the
// "Remove member from group" action's visibility can be exercised by responsibility.
function testWrapperViewingOtherMember (hasRemoveResponsibility) {
  const ormSession = orm.mutableSession(orm.getEmptyState())
  ormSession.Person.create(denormalized.data.person)
  ormSession.Reaction.create(denormalized.data.person.reactions)
  ormSession.Group.create({ id: '1', slug: 'test-group', name: 'Test Group' })
  ormSession.Me.create({
    id: '999',
    groupRoles: {
      items: hasRemoveResponsibility
        ? [{
            id: 1,
            groupId: '1',
            name: 'Administrator',
            responsibilities: { items: [{ id: 1, title: RESP_REMOVE_MEMBERS }] }
          }]
        : []
    }
  })
  return AllTheProviders({ orm: ormSession.state })
}

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: jest.fn().mockReturnValue({ personId: '46816' }),
  useLocation: jest.fn().mockReturnValue({ pathname: '/members/46816', search: '' })
}))

describe('MemberProfile', () => {
  beforeEach(() => {
    mockGraphqlServer.use(
      graphql.query('MemberSkills', () => {
        return HttpResponse.json({
          data: {
            person: {
              id: '1',
              skills: {
                items: []
              }
            }
          }
        })
      }),
      graphql.query('MemberSkillsToLearn', () => {
        return HttpResponse.json({
          data: {
            person: {
              id: '1',
              skills: {
                items: [{ id: 1, name: 'skill' }]
              }
            }
          }
        })
      }),
      graphql.query('RecentActivity', () => {
        return HttpResponse.json({
          data: {
            person: {
              id: '1',
              comments: {
                items: [{
                  id: 1,
                  text: 'hello',
                  creator: { id: 1 },
                  post: { id: 1, title: 'title', createdAt: '2021-04-12T15:00:00.000Z' },
                  attachments: [],
                  createdAt: '2021-04-12T15:00:00.000Z'
                }],
                posts: []
              }
            }
          }
        })
      }),
      graphql.query('PersonDetails', () => {
        return HttpResponse.json({
          data: {
            person: denormalized.data.person
          }
        })
      }),
      graphql.query('MemberReactions', () => {
        return HttpResponse.json({
          data: {
            person: {
              id: '1',
              reactions: {
                items: []
              }
            }
          }
        })
      }),
      graphql.query('MemberPosts', () => {
        return HttpResponse.json({
          data: {
            person: {
              id: '1',
              posts: {
                items: []
              }
            }
          }
        })
      }),
      graphql.query('MemberComments', () => {
        return HttpResponse.json({
          data: {
            person: {
              id: '1',
              comments: {
                items: []
              }
            }
          }
        })
      })
    )
  })

  it('renders the member name', async () => {
    render(<MemberProfile />, { wrapper: testWrapper() })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: denormalized.data.person.name })).toBeInTheDocument()
      expect(screen.getByText(denormalized.data.person.bio)).toBeInTheDocument()
    })
  })

  it('renders RecentActivity on Overview', async () => {
    const props = {
      currentTab: 'Overview'
    }
    render(<MemberProfile {...props} />, { wrapper: testWrapper() })
    await waitFor(() => {
      expect(screen.getByText("Rich Churcher's recent activity")).toBeInTheDocument()
    })
  })

  it('renders MemberPosts on Posts', async () => {
    const props = {
      currentTab: 'Posts'
    }
    render(<MemberProfile {...props} />, { wrapper: testWrapper() })
    await waitFor(() => {
      expect(screen.getByText("Rich Churcher's posts")).toBeInTheDocument()
    })
  })

  it('renders MemberComments on Comments', async () => {
    const props = {
      currentTab: 'Comments'
    }
    render(<MemberProfile {...props} />, { wrapper: testWrapper() })
    await waitFor(() => {
      expect(screen.getByText("Rich Churcher's comments")).toBeInTheDocument()
    })
  })

  it('renders MemberReactions on reactions', async () => {
    const props = {
      currentTab: 'Reactions',
      roles: [{ id: 1, common: true, responsibilities: { items: [{ id: 1, title: 'Manage Content' }] } }]
    }
    render(<MemberProfile {...props} />, { wrapper: testWrapper() })
    await waitFor(() => {
      expect(screen.getByText('Rich Churcher\'s reactions')).toBeInTheDocument()
    })
  })

  it('displays an error if can\'t find person', async () => {
    jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ personId: '112' })
    render(<MemberProfile />, { wrapper: testWrapper() })
    await waitFor(() => {
      expect(screen.getByText('Oops, there\'s nothing to see here.')).toBeInTheDocument()
    })
  })

  // Agora: readable profile links (/members/46816-rich-churcher)
  describe('readable profile links', () => {
    afterEach(() => {
      jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ personId: '46816' })
      jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ pathname: '/members/46816', search: '' })
      jest.spyOn(require('react-router-dom'), 'useNavigate').mockRestore()
    })

    it('opens the person from a link with a name after the id, and leaves a correct link alone', async () => {
      const navigate = jest.fn()
      jest.spyOn(require('react-router-dom'), 'useNavigate').mockReturnValue(navigate)
      jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ personId: '46816-rich-churcher' })
      jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ pathname: '/members/46816-rich-churcher', search: '' })
      render(<MemberProfile />, { wrapper: testWrapper() })
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: denormalized.data.person.name })).toBeInTheDocument()
      })
      expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/members/'), expect.anything())
    })

    it('corrects an old name in the link to the current one', async () => {
      const navigate = jest.fn()
      jest.spyOn(require('react-router-dom'), 'useNavigate').mockReturnValue(navigate)
      jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ personId: '46816-old-name' })
      jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ pathname: '/groups/wombats/members/46816-old-name', search: '?tab=1', hash: '' })
      render(<MemberProfile />, { wrapper: testWrapper() })
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: denormalized.data.person.name })).toBeInTheDocument()
      })
      expect(navigate).toHaveBeenCalledWith('/groups/wombats/members/46816-rich-churcher?tab=1', expect.objectContaining({ replace: true }))
    })
  })

  describe('remove member action', () => {
    beforeEach(() => {
      jest.spyOn(require('react-router-dom'), 'useParams').mockReturnValue({ personId: '46816' })
      jest.spyOn(require('react-router-dom'), 'useLocation').mockReturnValue({ pathname: '/groups/test-group/members/46816', search: '' })
    })

    it('shows "Remove member from group" when the current user has the Remove Members responsibility', async () => {
      render(<MemberProfile />, { wrapper: testWrapperViewingOtherMember(true) })
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: denormalized.data.person.name })).toBeInTheDocument()
      })
      fireEvent.click(screen.getAllByTestId('dropdown-toggle')[0])
      expect(screen.getByText('Remove member from group')).toBeInTheDocument()
    })

    it('hides "Remove member from group" when the current user lacks the Remove Members responsibility', async () => {
      render(<MemberProfile />, { wrapper: testWrapperViewingOtherMember(false) })
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: denormalized.data.person.name })).toBeInTheDocument()
      })
      fireEvent.click(screen.getAllByTestId('dropdown-toggle')[0])
      expect(screen.queryByText('Remove member from group')).not.toBeInTheDocument()
    })
  })
})
