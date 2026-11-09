/* eslint-env jest */
// Agora: thread panel, room search, live reply counter and the "Jump to first unread" check.
import React from 'react'
import { fireEvent, render, screen, waitFor, AllTheProviders } from 'util/testing/reactTestingLibraryExtended'
import orm from 'store/models'
import ormReducer from 'store/reducers/ormReducer'
import { unreadOffScreenDirection } from 'routes/ChatRoom/chatRoomUtils'
import relativeTime from './relativeTime'
import ThreadPanel from './ThreadPanel'
import RoomSearchPanel, { roomSearchParams } from './RoomSearchPanel'
import { receiveChatThreadUpdate } from './chatThreads.store'

jest.mock('components/SocketSubscriber', () => ({ type, id }) => <div data-testid='socket-subscriber'>{type}:{id}</div>)
// useDispatch is a non-configurable ESM export, so it cannot be spied on; mock it here and fall back to the real one.
jest.mock('react-redux', () => {
  const actual = jest.requireActual('react-redux')
  return { ...actual, useDispatch: jest.fn((...args) => actual.useDispatch(...args)) }
})
jest.mock('routes/PostDetail/Comments', () => ({ post }) => <div data-testid='comments'>comments of {post.id}</div>)

const group = { id: '5', name: 'Alpha', slug: 'alpha' }

function providers (build) {
  const session = orm.mutableSession(orm.getEmptyState())
  session.Me.create({ id: '1', name: 'Me' })
  if (build) build(session)
  return AllTheProviders({ orm: session.state, pending: {} })
}

describe('reply counter texts', () => {
  it('has English singular and plural texts for the counter', () => {
    const en = require('../../../public/locales/en.json')
    expect(en['agoraChat.threadSummary_one']).toBe('{{count}} reply, last {{ago}}')
    expect(en['agoraChat.threadSummary_other']).toBe('{{count}} replies, last {{ago}}')
    expect(en['agoraChat.threadSummaryNoTime_one']).toBe('{{count}} reply')
    expect(en['agoraChat.threadSummaryNoTime_other']).toBe('{{count}} replies')
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-11-09T12:00:00Z').getTime()
  it('says how long ago in plain words', () => {
    expect(relativeTime('2026-11-09T11:50:00Z', 'en', now)).toBe('10 minutes ago')
    expect(relativeTime('2026-11-09T09:00:00Z', 'en', now)).toBe('3 hours ago')
    expect(relativeTime('2026-11-08T12:00:00Z', 'en', now)).toBe('yesterday')
    expect(relativeTime(null, 'en', now)).toBe('')
  })
})

describe('ThreadPanel', () => {
  it('shows the original message, its replies and the reply box area, and closes', () => {
    const onClose = jest.fn()
    const wrapper = providers(session => {
      session.Person.create({ id: '2', name: 'Ann' })
      session.Post.create({ id: '9', type: 'chat', details: '<p>Who brings the boat?</p>', createdAt: '2026-11-09T10:00:00Z', creator: '2', commentsTotal: 2 })
    })
    render(<ThreadPanel postId='9' group={group} onClose={onClose} />, { wrapper })
    expect(screen.getByTestId('thread-panel')).toBeInTheDocument()
    expect(screen.getByTestId('thread-original')).toHaveTextContent('Who brings the boat?')
    expect(screen.getByTestId('thread-original')).toHaveTextContent('Ann')
    expect(screen.getByTestId('comments')).toHaveTextContent('comments of 9')
    // joins the post's live room, so new replies appear while the panel is open
    expect(screen.getByTestId('socket-subscriber')).toHaveTextContent('post:9')
    fireEvent.click(screen.getByTestId('thread-close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('RoomSearchPanel', () => {
  afterEach(() => {
    const actual = jest.requireActual('react-redux')
    require('react-redux').useDispatch.mockReset().mockImplementation((...args) => actual.useDispatch(...args))
  })

  it('asks only for this room, chat messages only', () => {
    expect(roomSearchParams('alpha', 'boat')).toMatchObject({ context: 'groups', slug: 'alpha', filter: 'chat', search: 'boat' })
  })

  it('searches the room after a pause in typing, lists results, and jumps on click', async () => {
    const onPick = jest.fn()
    const result = { id: '12', details: '<p>The boat leaves at nine</p>', createdAt: '2026-11-09T10:00:00Z', creator: { id: '2', name: 'Ann' } }
    const seen = []
    const wrapper = ({ children }) => {
      const Inner = providers()
      return <Inner>{children}</Inner>
    }
    const { default: fetchPosts } = require('store/actions/fetchPosts')
    expect(typeof fetchPosts).toBe('function')
    // The store is real; intercept the posts request with a middleware-free check on the action we dispatch
    require('react-redux').useDispatch.mockReturnValue(action => {
      seen.push(action)
      return Promise.resolve({ payload: { data: { group: { posts: { items: [result] } } } } })
    })
    render(<RoomSearchPanel group={group} onClose={jest.fn()} onPick={onPick} />, { wrapper })
    fireEvent.change(screen.getByTestId('room-search-input'), { target: { value: 'boat' } })
    await waitFor(() => expect(screen.getByTestId('room-search-result')).toBeInTheDocument())
    expect(seen).toHaveLength(1)
    expect(seen[0].graphql.variables).toMatchObject({ slug: 'alpha', filter: 'chat', search: 'boat', context: 'groups' })
    expect(screen.getByTestId('room-search-result')).toHaveTextContent('The boat leaves at nine')
    fireEvent.click(screen.getByTestId('room-search-result'))
    expect(onPick).toHaveBeenCalledWith(result)
  })

  it('says so when nothing is found', async () => {
    require('react-redux').useDispatch.mockReturnValue(() => Promise.resolve({ payload: { data: { group: { posts: { items: [] } } } } }))
    render(<RoomSearchPanel group={group} onClose={jest.fn()} onPick={jest.fn()} />, { wrapper: providers() })
    fireEvent.change(screen.getByTestId('room-search-input'), { target: { value: 'zzz' } })
    await waitFor(() => expect(screen.getByTestId('room-search-empty')).toBeInTheDocument())
  })
})

describe('live reply counter', () => {
  it('updates the message\'s count, repliers and last reply time from the server event', () => {
    const session = orm.mutableSession(orm.getEmptyState())
    session.Me.create({ id: '1' })
    session.Post.create({ id: '9', type: 'chat', commentsTotal: 1, commentersTotal: 1 })
    const next = ormReducer(session.state, receiveChatThreadUpdate({
      postId: '9',
      commentsTotal: 4,
      commentersTotal: 3,
      lastCommentAt: '2026-11-09T11:59:00.000Z',
      commenters: [{ id: '2', name: 'Ann', avatarUrl: 'a.png' }]
    }))
    const post = orm.session(next).Post.withId('9').ref
    expect(post.commentsTotal).toBe(4)
    expect(post.commentersTotal).toBe(3)
    expect(post.lastCommentAt).toBe('2026-11-09T11:59:00.000Z')
    expect(post.chatThreadRepliers).toEqual([{ id: '2', name: 'Ann', avatarUrl: 'a.png' }])
  })

  it('ignores a message that is not loaded here', () => {
    const session = orm.mutableSession(orm.getEmptyState())
    expect(() => ormReducer(session.state, receiveChatThreadUpdate({ postId: '404', commentsTotal: 1 }))).not.toThrow()
  })
})

describe('unreadOffScreenDirection', () => {
  it('points up or down when the first unread message is out of sight, and stays quiet when it is visible', () => {
    expect(unreadOffScreenDirection('5', { first: '10', last: '20' })).toBe('above')
    expect(unreadOffScreenDirection('25', { first: '10', last: '20' })).toBe('below')
    expect(unreadOffScreenDirection('15', { first: '10', last: '20' })).toBe(null)
    expect(unreadOffScreenDirection(null, { first: '10', last: '20' })).toBe(null)
    expect(unreadOffScreenDirection('5', { first: null, last: null })).toBe(null)
  })
})
