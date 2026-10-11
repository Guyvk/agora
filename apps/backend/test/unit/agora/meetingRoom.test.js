/* eslint-env mocha */
/**
 * Agora: the meeting room when speech to text is not connected.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/meetingRoom.test.js
 */
import createPost from '../../../api/models/post/createPost'
import MeetingController from '../../../api/controllers/MeetingController'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const { spyify, unspyify } = require(rootPath('test/setup/helpers'))

describe('Agora meeting room without speech to text', () => {
  let saved, user, event

  function call (action, params = {}, query = {}) {
    const req = factories.mock.request()
    req.params = { postId: String(event.id), ...params }
    req.query = query
    req.headers = { 'x-agora': '1' }
    req.login(user.id)
    const res = factories.mock.response()
    res.set = () => {}
    res.type = () => res
    return MeetingController[action](req, res).then(() => res)
  }

  before(async () => {
    saved = process.env.AGORA_TRANSCRIPTION_URL
    delete process.env.AGORA_TRANSCRIPTION_URL
    spyify(Queue, 'classMethod')
    await setup.clearDb()
    user = await new User({ name: 'Amara', email: 'room@agora.test', active: true }).save()
    const group = await new Group({ slug: 'room-circle', name: 'Room circle' }).save()
    await user.joinGroup(group)
    event = await createPost(user.id, {
      name: 'Circle meeting',
      type: Post.Type.EVENT,
      group_ids: [group.id],
      startTime: Date.now(),
      endTime: Date.now() + 3600000
    })
  })

  after(() => {
    unspyify(Queue, 'classMethod')
    if (saved === undefined) delete process.env.AGORA_TRANSCRIPTION_URL
    else process.env.AGORA_TRANSCRIPTION_URL = saved
  })

  it('tells the page that notes are off', async () => {
    const res = await call('room')
    expect(res.body).to.contain('"transcriptionReady":false')
  })

  it('refuses speech, and keeps none of it', async () => {
    const joined = await call('join', { notes: true })
    const res = await call('segment', {}, {
      sessionId: joined.body.sessionId,
      spokenAt: String(Date.now()),
      durationMs: '3000'
    })
    expect(res.statusCode).to.equal(503)
    const stored = await bookshelf.knex('meeting_segments').count('id as count').first()
    expect(Number(stored.count)).to.equal(0)
  })
})
