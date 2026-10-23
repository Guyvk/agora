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

  it('gives a member the address of the meeting post, so the room can send them back in the same tab', async () => {
    const res = await call('room')
    expect(res.body).to.contain('"eventUrl":"')
    expect(res.body).to.match(new RegExp(`"eventUrl":"[^"]*/groups/room-circle/[^"]*/post/${event.id}"`))
    // the page sends a member back to the post when the meeting ends, and has a button for it
    expect(res.body).to.contain('Back to the meeting post')
    expect(res.body).to.contain('location.href = BOOT.eventUrl')
    // a guest never goes into Agora
    expect(res.body).to.contain('if (BOOT.guest || !state.joined || !BOOT.eventUrl) return')
  })

  it('never hands the page another platform\'s link', async () => {
    await bookshelf.knex('posts').where('id', event.id).update({ meeting_link: 'https://zoom.us/j/123' })
    const res = await call('room')
    expect(res.body).not.to.contain('zoom.us')
    expect(res.body).not.to.contain('"meetingLink"')
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

describe('Agora meeting room with speech to text', () => {
  let saved, user, event

  function call (action, params = {}, query = {}, body = null) {
    const req = factories.mock.request()
    req.params = { postId: String(event.id), ...params }
    req.query = query
    req.headers = { 'x-agora': '1', 'content-type': 'audio/webm;codecs=opus' }
    if (body) {
      // the segment call reads the raw sound from the request stream
      req.on = (name, handler) => {
        if (name === 'data') setImmediate(() => handler(body))
        if (name === 'end') setImmediate(() => setImmediate(handler))
        return req
      }
    }
    req.login(user.id)
    const res = factories.mock.response()
    res.set = () => {}
    res.type = () => res
    return MeetingController[action](req, res).then(() => res)
  }

  before(async () => {
    saved = { url: process.env.AGORA_TRANSCRIPTION_URL, key: process.env.AGORA_TRANSCRIPTION_KEY }
    process.env.AGORA_TRANSCRIPTION_URL = 'http://localhost:9/v1/audio/transcriptions'
    delete process.env.AGORA_TRANSCRIPTION_KEY
    spyify(Queue, 'classMethod')
    await setup.clearDb()
    user = await new User({ name: 'Lars', email: 'room2@agora.test', active: true }).save()
    const group = await new Group({ slug: 'room-circle-2', name: 'Room circle 2' }).save()
    await user.joinGroup(group)
    event = await createPost(user.id, {
      name: 'Circle meeting 2',
      type: Post.Type.EVENT,
      group_ids: [group.id],
      startTime: Date.now(),
      endTime: Date.now() + 3600000
    })
  })

  after(() => {
    unspyify(Queue, 'classMethod')
    if (saved.url === undefined) delete process.env.AGORA_TRANSCRIPTION_URL
    else process.env.AGORA_TRANSCRIPTION_URL = saved.url
    if (saved.key !== undefined) process.env.AGORA_TRANSCRIPTION_KEY = saved.key
  })

  it('keeps speech from a computer whose clock is wrong, timed by when it arrived', async () => {
    const joined = await call('join', { notes: true })
    const before = Date.now()
    const res = await call('segment', {}, {
      sessionId: joined.body.sessionId,
      spokenAt: String(Date.now() - 3 * 3600000), // three hours behind
      durationMs: '3000'
    }, Buffer.alloc(1000, 1))
    expect(res.body.transcribing).to.equal(true)
    const row = await bookshelf.knex('meeting_segments').orderBy('id', 'desc').first()
    expect(new Date(row.spoken_at).getTime()).to.be.at.least(before - 3000 - 1000)
  })

  it('tells the room when speech could not be turned into text', async () => {
    await bookshelf.knex('meeting_segments').update({ error: 'Transcription service answered 401' })
    const res = await call('transcript')
    expect(res.body.failing).to.equal(1)
  })
})
