import React from 'react'
import { AllTheProviders, fireEvent, render, screen } from 'util/testing/reactTestingLibraryExtended'
import orm from 'store/models'
import extractModelsForTest from 'util/testing/extractModelsForTest'
import PostHeader, { TopicsLine } from './PostHeader'

jest.mock('luxon', () => ({
  __esModule: true,
  default: () => ({
    fromNow: () => 'a few seconds ago',
    format: () => '2024-07-23 16:30'
  })
}))

const routeParams = { groupSlug: 'fooc' }

const buildPost = (overrides = {}) => ({
  id: 1,
  announcement: false,
  creator: {
    name: 'JJ',
    avatarUrl: 'foo.png',
    id: 123,
    tagline: '',
    moderatedGroupMemberships: []
  },
  createdTimestamp: 'a few seconds ago',
  exactCreatedTimestamp: '2024-07-23 16:30',
  type: 'discussion',
  proposalOutcome: null,
  proposalStatus: null,
  endTime: null,
  startTime: null,
  fulfilledAt: null,
  savedAt: null,
  ...overrides
})

const defaultProps = {
  routeParams,
  post: buildPost(),
  group: { id: 1, name: 'FooC', slug: 'fooc' }
}

describe('PostHeader', () => {
  it('renders basic post header', () => {
    render(
      <PostHeader
        {...defaultProps}
      />
    )

    expect(screen.getByText('JJ')).toBeInTheDocument()
    expect(screen.getByText('a few seconds ago')).toBeInTheDocument()
  })

  it('renders post header with type', () => {
    render(
      <PostHeader
        {...defaultProps}
        post={buildPost({ type: 'request' })}
      />
    )

    expect(screen.getByText('JJ')).toBeInTheDocument()
    expect(screen.getByTestId('post-type-Request')).toBeInTheDocument()
  })

  it('renders post header with action buttons', () => {
    render(
      <PostHeader
        {...defaultProps}
        deletePost={() => {}}
        editPost={() => {}}
        duplicatePost={() => {}}
      />
    )

    expect(screen.getByTestId('post-header-more-icon')).toBeInTheDocument()
  })
})

describe('PostHeader with announcement', () => {
  it('renders announcement icon', () => {
    render(
      <PostHeader
        {...defaultProps}
        post={buildPost({ announcement: true })}
      />
    )

    expect(screen.getByTestId('post-header-announcement-icon')).toBeInTheDocument()
  })
})

describe('PostHeader with date range', () => {
  it('renders human readable dates', () => {
    render(
      <PostHeader
        {...defaultProps}
        post={buildPost({
          type: 'request',
          startTime: new Date('2028-11-29'),
          endTime: new Date('2034-11-29')
        })}
      />
    )

    expect(screen.getByText(/Starts:/)).toBeInTheDocument()
    expect(screen.getByText(/Ends:/)).toBeInTheDocument()
  })
})

describe('TopicsLine', () => {
  it('renders topics', () => {
    render(
      <TopicsLine
        topics={[{ name: 'one' }, { name: 'two' }]}
        slug='hay'
        newLine
      />
    )

    expect(screen.getByText('#one')).toHaveAttribute('href', '/search?t=%23one&groupSlug=hay')
    expect(screen.getByText('#two')).toHaveAttribute('href', '/search?t=%23two&groupSlug=hay')
  })
})

// Agora: "Leave Project" is in the ... menu, for a member of a project only
describe('PostHeader leave project (Agora)', () => {
  const loggedIn = () => {
    const ormSession = orm.session(orm.getEmptyState())
    extractModelsForTest({ me: { id: '5', name: 'Me' } }, 'Me', ormSession)
    return AllTheProviders({ orm: ormSession.state, pending: {} })
  }

  const openMenu = async (props) => {
    render(<PostHeader {...defaultProps} {...props} />, { wrapper: loggedIn() })
    fireEvent.click(screen.getByTestId('post-header-more-icon'))
  }

  it('shows it on a project when the viewer is a member, and runs it on click', async () => {
    const onLeaveProject = jest.fn()
    await openMenu({ post: buildPost({ type: 'project' }), onLeaveProject })
    fireEvent.click(await screen.findByText('Leave Project'))
    expect(onLeaveProject).toHaveBeenCalled()
  })

  it('hides it when the viewer is not a member', async () => {
    await openMenu({ post: buildPost({ type: 'project' }) })
    expect(await screen.findByText('Copy Link')).toBeInTheDocument()
    expect(screen.queryByText('Leave Project')).not.toBeInTheDocument()
  })

  it('hides it on other kinds of post', async () => {
    await openMenu({ post: buildPost({ type: 'discussion' }), onLeaveProject: () => {} })
    expect(await screen.findByText('Copy Link')).toBeInTheDocument()
    expect(screen.queryByText('Leave Project')).not.toBeInTheDocument()
  })
})
