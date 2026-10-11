/* eslint-env mocha */
/**
 * Agora: events get their meeting room as their video call link.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/meetingLink.test.js
 */
import createPost from '../../../api/models/post/createPost'
import updatePost from '../../../api/models/post/updatePost'
import { meetingRoomUrl, isMeetingRoomUrl } from '../../../lib/agora/meetingLink'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const { spyify, unspyify } = require(rootPath('test/setup/helpers'))

describe('Agora meeting link', () => {
  const saved = {}
  let user, group

  const tomorrow = () => Date.now() + 86400000
  const event = (attrs = {}) => createPost(user.id, {
    name: 'Circle meeting',
    type: Post.Type.EVENT,
    group_ids: [group.id],
    startTime: tomorrow(),
    endTime: tomorrow() + 3600000,
    ...attrs
  })
  const change = (post, attrs) => updatePost(user.id, post.id, {
    name: post.get('name'),
    type: Post.Type.EVENT,
    group_ids: [group.id],
    startTime: post.get('start_time'),
    endTime: post.get('end_time'),
    ...attrs
  })

  before(() => {
    for (const name of ['AGORA_MEET_DOMAIN', 'PROTOCOL', 'DOMAIN']) saved[name] = process.env[name]
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    return setup.clearDb()
      .then(() => Promise.props({
        u: new User({ name: 'Steward', email: 'meeting-link@agora.test', active: true }).save(),
        g: new Group({ slug: 'meeting-link', name: 'Meeting link circle' }).save()
      }))
      .then(props => {
        user = props.u
        group = props.g
        return user.joinGroup(group)
      })
  })

  after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  beforeEach(() => {
    process.env.AGORA_MEET_DOMAIN = 'kmeet.infomaniak.com'
    spyify(Queue, 'classMethod')
  })

  afterEach(() => unspyify(Queue, 'classMethod'))

  it('knows the address of a meeting room', () => {
    expect(meetingRoomUrl(42)).to.equal('https://agora.example.org/noo/meeting/42/room')
    expect(isMeetingRoomUrl('https://agora.example.org/noo/meeting/42/room')).to.equal(true)
    expect(isMeetingRoomUrl('https://zoom.us/j/123')).to.equal(false)
    expect(isMeetingRoomUrl(null)).to.equal(false)
  })

  it('gives a new event without a video call link its meeting room', async () => {
    const post = await event()
    const fresh = await Post.find(post.id)
    expect(fresh.get('meeting_link')).to.equal(meetingRoomUrl(post.id))
  })

  it('leaves a link that someone typed alone', async () => {
    const post = await event({ meetingLink: 'https://zoom.us/j/123' })
    const fresh = await Post.find(post.id)
    expect(fresh.get('meeting_link')).to.equal('https://zoom.us/j/123')
  })

  it('puts the meeting room back when the link is cleared', async () => {
    const post = await event({ meetingLink: 'https://zoom.us/j/123' })
    await change(post, { meetingLink: '' })
    const fresh = await Post.find(post.id)
    expect(fresh.get('meeting_link')).to.equal(meetingRoomUrl(post.id))
  })

  it('keeps a typed link when an event is changed', async () => {
    const post = await event()
    await change(post, { meetingLink: 'https://zoom.us/j/456' })
    const fresh = await Post.find(post.id)
    expect(fresh.get('meeting_link')).to.equal('https://zoom.us/j/456')
  })

  it('does not touch other kinds of posts', async () => {
    const post = await createPost(user.id, { name: 'Just a note', type: Post.Type.DISCUSSION, group_ids: [group.id] })
    const fresh = await Post.find(post.id)
    expect(fresh.get('meeting_link')).to.equal(null)
  })

  it('does nothing when no call server is set', async () => {
    delete process.env.AGORA_MEET_DOMAIN
    const post = await event()
    const fresh = await Post.find(post.id)
    expect(fresh.get('meeting_link')).to.equal(null)
  })
})
