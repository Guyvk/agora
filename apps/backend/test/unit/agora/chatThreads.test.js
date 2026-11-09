/* eslint-env mocha */
/**
 * Agora: chat threads (lib/agora/chatThreads.js), searching one room, and the saved list.
 *
 * These checks need a database, and empty it first. Never point them at a database
 * you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_chatthreads_test yarn test test/unit/agora/chatThreads.test.js
 */
import { createRequestHandler } from '../../../api/graphql'
import * as Websockets from '../../../api/services/Websockets'
import { lastCommentAt, pushThreadSummary } from '../../../lib/agora/chatThreads'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const { spyify, unspyify } = require(rootPath('test/setup/helpers'))

describe('Agora chat threads, room search and saved messages', () => {
  const knex = () => bookshelf.knex
  let handler, ann, bob, cat, alpha, beta, alphaMsg, alphaOther, betaMsg

  async function gql (user, document, variables = {}) {
    const req = factories.mock.request()
    req.url = '/noo/graphql'
    req.method = 'POST'
    req.headers = { 'Content-Type': 'application/json' }
    req.session = user ? { userId: user.id, destroy: () => {} } : {}
    const { executionResult } = await handler.inject({ document, variables, serverContext: { req, res: factories.mock.response() } })
    return executionResult
  }

  const chat = async (user, group, text) => {
    const post = await factories.post({ type: 'chat', user_id: user.id, description: text, created_at: new Date() }).save()
    await post.groups().attach(group.id)
    return post
  }

  before(async () => {
    await setup.clearDb()
    handler = createRequestHandler()
    const mk = name => new User({ name, email: `${name.toLowerCase()}@agora.test`, active: true, email_validated: true }).save()
    ann = await mk('Ann')
    bob = await mk('Bob')
    cat = await mk('Cat')
    alpha = await Group.create(ann.id, { name: 'Alpha', slug: 'alpha', visibility: Group.Visibility.PROTECTED })
    beta = await Group.create(bob.id, { name: 'Beta', slug: 'beta', visibility: Group.Visibility.HIDDEN })
    await alpha.addMembers([bob.id, cat.id])
    alphaMsg = await chat(bob, alpha, '<p>The harbour plan is ready</p>')
    alphaOther = await chat(bob, alpha, '<p>Lunch on Friday</p>')
    betaMsg = await chat(bob, beta, '<p>The harbour plan is secret</p>')
  })

  describe('threads', () => {
    it('tells when the newest reply was written, and nothing for a message without replies', async () => {
      expect(await lastCommentAt(alphaMsg.id)).to.equal(null)
      await factories.comment({ post_id: alphaMsg.id, user_id: cat.id, created_at: new Date('2026-11-01T10:00:00Z') }).save()
      await factories.comment({ post_id: alphaMsg.id, user_id: ann.id, created_at: new Date('2026-11-02T10:00:00Z') }).save()
      expect(new Date(await lastCommentAt(alphaMsg.id)).toISOString()).to.equal('2026-11-02T10:00:00.000Z')
    })

    it('sends the new reply count to the circle that holds the message, and to nobody else', async () => {
      await Post.updateFromNewComment({ postId: alphaMsg.id })
      const payload = await pushThreadSummary(alphaMsg.id)
      expect(payload.postId).to.equal(String(alphaMsg.id))
      expect(payload.commentsTotal).to.equal(2)
      expect(payload.commentersTotal).to.equal(2)
      expect(payload.commenters.map(c => c.name).sort()).to.deep.equal(['Ann', 'Cat'])
      expect(payload.lastCommentAt).to.equal('2026-11-02T10:00:00.000Z')
    })

    describe('which rooms hear about a reply', () => {
      let parent, member, outsider
      before(async () => {
        parent = await factories.group().save()
        member = await factories.user().save()
        outsider = await factories.user().save()
      })

      const roomsFor = async (group) => {
        const p = await factories.post({ type: 'chat', user_id: member.id, description: 'hi' }).save()
        await p.groups().attach(group.id)
        spyify(Websockets, 'pushToSockets')
        try {
          await pushThreadSummary(p.id)
          return Websockets.pushToSockets.__spy.calls.map(c => c[0])
        } finally {
          unspyify(Websockets, 'pushToSockets')
        }
      }

      it('a circle (not a space) is told through its own room', async () => {
        const circle = await factories.group().save()
        expect(await roomsFor(circle)).to.deep.equal([Websockets.groupRoom(circle.id)])
      })

      it('an open space is told through its own room and its parent circle\'s room', async () => {
        const space = await factories.group({ type: 'space', parent_id: parent.id, visibility: 1, accessibility: 2 }).save()
        const rooms = await roomsFor(space)
        expect(rooms).to.have.members([Websockets.groupRoom(space.id), Websockets.groupRoom(parent.id)])
      })

      it('a private space reaches only its members\' own rooms, never the space or parent room', async () => {
        const space = await factories.group({ type: 'space', parent_id: parent.id, visibility: 0, accessibility: 0 }).save()
        await member.joinGroup(space)
        const rooms = await roomsFor(space)
        expect(rooms).to.deep.equal([Websockets.userRoom(member.id)])
        expect(rooms).to.not.include(Websockets.groupRoom(space.id))
        expect(rooms).to.not.include(Websockets.groupRoom(parent.id))
        expect(rooms).to.not.include(Websockets.userRoom(outsider.id))
      })
    })

    it('does nothing for a post that is not a chat message', async () => {
      const discussion = await factories.post({ type: 'discussion', user_id: ann.id }).save()
      expect(await pushThreadSummary(discussion.id)).to.equal(null)
    })

    it('shows the reply count and last reply time over GraphQL, for members only', async () => {
      const q = 'query ($slug: String) { group(slug: $slug) { posts(filter: "chat", first: 10, sortBy: "id", order: "desc") { items { id commentsTotal lastCommentAt } } } }'
      const r = await gql(cat, q, { slug: 'alpha' })
      expect(r.errors).to.equal(undefined)
      const item = r.data.group.posts.items.find(p => p.id === String(alphaMsg.id))
      expect(item.commentsTotal).to.equal(2)
      expect(new Date(item.lastCommentAt).toISOString()).to.equal('2026-11-02T10:00:00.000Z')
      const out = await gql(null, q, { slug: 'alpha' })
      expect(out.data && out.data.group && out.data.group.posts && out.data.group.posts.items.length > 0).to.not.equal(true)
    })
  })

  describe('search in one room', () => {
    const search = (user, slug, term) => gql(user, 'query ($slug: String, $term: String) { group(slug: $slug) { posts(filter: "chat", search: $term, first: 30, sortBy: "id", order: "desc") { items { id details } } } }', { slug, term })

    it('finds a message in this room and not the same words in another room', async () => {
      const r = await search(bob, 'alpha', 'harbour')
      expect(r.errors).to.equal(undefined)
      expect(r.data.group.posts.items.map(p => p.id)).to.deep.equal([String(alphaMsg.id)])
    })

    it('does not search messages of a room the person cannot see', async () => {
      const r = await search(cat, 'beta', 'harbour')
      const items = r.data && r.data.group && r.data.group.posts ? r.data.group.posts.items : []
      expect(items).to.deep.equal([])
    })

    it('refuses anyone who is not logged in', async () => {
      const r = await search(null, 'alpha', 'harbour')
      const items = r.data && r.data.group && r.data.group.posts ? r.data.group.posts.items : []
      expect(items).to.deep.equal([])
    })
  })

  describe('saved messages', () => {
    const saved = (user, ids) => gql(user, 'query ($ids: [ID]) { posts(context: "my", filter: "chat", savedBy: $ids, sortBy: "saved", first: 30) { items { id } } }', { ids })

    it('keeps each person\'s saved list their own', async () => {
      const row = await knex()('posts_users').where({ post_id: alphaMsg.id, user_id: bob.id }).first()
      if (!row) {
        await new PostUser({ post_id: alphaMsg.id, user_id: bob.id, active: true, following: true, saved_at: new Date() }).save()
      } else {
        await knex()('posts_users').where({ post_id: alphaMsg.id, user_id: bob.id }).update({ saved_at: new Date() })
      }
      const mine = await saved(bob, [bob.id])
      expect(mine.data.posts.items.map(p => p.id)).to.deep.equal([String(alphaMsg.id)])
      // Cat asks for Bob's list by naming him: she gets her own (empty) list
      const peek = await saved(cat, [bob.id])
      expect(peek.data.posts.items).to.deep.equal([])
    })

    it('does not show a person\'s saved list through that person\'s own posts either', async () => {
      const q = 'query ($id: ID, $ids: [ID]) { person(id: $id) { posts(savedBy: $ids, first: 30) { items { id } } } }'
      // (Hylo's own query for this relation may fail on the owner's side too; what matters is that nothing leaks)
      const peek = await gql(cat, q, { id: bob.id, ids: [bob.id] })
      const items = peek.data && peek.data.person && peek.data.person.posts ? peek.data.person.posts.items : []
      expect(items.map(p => p.id)).to.not.include(String(alphaMsg.id))
      expect(items).to.deep.equal([])
      expect(alphaOther.id).to.not.equal(undefined)
      expect(betaMsg.id).to.not.equal(undefined)
    })
  })
})
