/* eslint-env mocha */
/**
 * Agora: an event's video call link is always its meeting room.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/meetingLink.test.js
 */
import createPost from '../../../api/models/post/createPost'
import updatePost from '../../../api/models/post/updatePost'
import { meetingRoomUrl, isMeetingRoomUrl, hasOutsideCallLink, bringPostsIntoLine } from '../../../lib/agora/meetingLink'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))

describe('Agora meeting link', () => {
  const saved = {}
  let user, group, originalClassMethod
  let queued = []

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
  const linkOf = async id => (await Post.find(id)).get('meeting_link')

  before(() => {
    for (const name of ['AGORA_MEET_DOMAIN', 'PROTOCOL', 'DOMAIN']) saved[name] = process.env[name]
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    // Jobs are only noted down, not run
    originalClassMethod = Queue.classMethod
    Queue.classMethod = (model, method, data) => { queued.push({ model, method, data }); return Promise.resolve() }
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
    Queue.classMethod = originalClassMethod
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  beforeEach(() => {
    process.env.AGORA_MEET_DOMAIN = 'kmeet.infomaniak.com'
    queued = []
  })

  it('knows the address of a meeting room', () => {
    expect(meetingRoomUrl(42)).to.equal('https://agora.example.org/noo/meeting/42/room')
    expect(isMeetingRoomUrl('https://agora.example.org/noo/meeting/42/room')).to.equal(true)
    expect(isMeetingRoomUrl('https://zoom.us/j/123')).to.equal(false)
    expect(isMeetingRoomUrl(null)).to.equal(false)
  })

  it('knows the links of other video call platforms', () => {
    expect(hasOutsideCallLink('https://us02web.zoom.us/j/86175972332')).to.equal(true)
    expect(hasOutsideCallLink('meet.google.com/abc-defg-hij')).to.equal(true)
    expect(hasOutsideCallLink('Join on https://teams.microsoft.com/l/meetup')).to.equal(true)
    expect(hasOutsideCallLink('https://kmeet.infomaniak.com/some-room')).to.equal(true)
    expect(hasOutsideCallLink('Community Hall, 12 Main St.')).to.equal(false)
    expect(hasOutsideCallLink('https://agora.example.org/noo/meeting/42/room')).to.equal(false)
    expect(hasOutsideCallLink(null)).to.equal(false)
  })

  it('gives a new event its meeting room', async () => {
    const post = await event()
    expect(await linkOf(post.id)).to.equal(meetingRoomUrl(post.id))
  })

  it('replaces a link that someone sent with the meeting room', async () => {
    const post = await event({ meetingLink: 'https://zoom.us/j/123' })
    expect(await linkOf(post.id)).to.equal(meetingRoomUrl(post.id))
  })

  it('puts the meeting room back when the link is cleared', async () => {
    const post = await event()
    await change(post, { meetingLink: '' })
    expect(await linkOf(post.id)).to.equal(meetingRoomUrl(post.id))
  })

  it('keeps the meeting room when a change sends another link', async () => {
    const post = await event()
    await change(post, { meetingLink: 'https://zoom.us/j/456' })
    expect(await linkOf(post.id)).to.equal(meetingRoomUrl(post.id))
  })

  it('does not tell invitees about a link that was sent but ignored', async () => {
    const post = await event()
    queued = []
    await change(post, { meetingLink: 'https://zoom.us/j/456' })
    const job = queued.find(j => j.model === 'Post' && j.method === 'processEventUpdated')
    expect(job.data.eventChanges.meeting_link).to.equal(false)
  })

  it('refuses another platform\'s link as the location', async () => {
    let error = null
    try { await event({ location: 'https://meet.google.com/abc-defg-hij' }) } catch (e) { error = e }
    expect(error && error.message).to.contain('meeting room')

    const post = await event({ location: 'Community Hall' })
    error = null
    try { await change(post, { location: 'Hall, or zoom.us/j/1' }) } catch (e) { error = e }
    expect(error && error.message).to.contain('meeting room')
    expect((await Post.find(post.id)).get('location')).to.equal('Community Hall')
  })

  it('never gives other kinds of posts a link, even when one is sent', async () => {
    const post = await createPost(user.id, { name: 'A note', type: Post.Type.DISCUSSION, group_ids: [group.id], meetingLink: 'https://zoom.us/j/1' })
    expect(await linkOf(post.id)).to.equal(null)
  })

  it('gives no video call link at all when no call server is set', async () => {
    delete process.env.AGORA_MEET_DOMAIN
    const post = await event({ meetingLink: 'https://zoom.us/j/123' })
    expect(await linkOf(post.id)).to.equal(null)
    await change(post, { meetingLink: 'https://zoom.us/j/456' })
    expect(await linkOf(post.id)).to.equal(null)
  })

  describe('the script for older events', () => {
    let zoomEvent, emptyEvent, roomEvent, note, onlyLink, linkAndMore

    before(async () => {
      process.env.AGORA_MEET_DOMAIN = 'kmeet.infomaniak.com'
      queued = []
      const knex = bookshelf.knex
      await knex('posts').where('type', 'event').orWhereNotNull('meeting_link').update({ active: false })
      roomEvent = await event()
      zoomEvent = await event()
      emptyEvent = await event()
      onlyLink = await event()
      linkAndMore = await event()
      note = await createPost(user.id, { name: 'A note', type: Post.Type.DISCUSSION, group_ids: [group.id] })
      // As they could have been saved before Agora locked the link
      await knex('posts').where('id', zoomEvent.id).update({ meeting_link: 'https://zoom.us/j/123' })
      await knex('posts').where('id', emptyEvent.id).update({ meeting_link: null })
      await knex('posts').where('id', note.id).update({ meeting_link: 'https://meet.google.com/x' })
      await knex('posts').where('id', onlyLink.id).update({ location: 'https://zoom.us/j/999' })
      await knex('posts').where('id', linkAndMore.id).update({ location: 'Community Hall or https://zoom.us/j/999' })
    })

    it('only shows what would change, without --apply', async () => {
      const result = await bringPostsIntoLine()
      expect(result.links.map(l => String(l.id)).sort()).to.deep.equal([zoomEvent.id, emptyEvent.id, note.id].map(String).sort())
      expect(result.locations.map(l => [String(l.id), l.cleared])).to.deep.equal([[String(onlyLink.id), true], [String(linkAndMore.id), false]])
      expect(await linkOf(zoomEvent.id)).to.equal('https://zoom.us/j/123')
      expect((await Post.find(onlyLink.id)).get('location')).to.equal('https://zoom.us/j/999')
    })

    it('puts things right with --apply, and finds nothing the second time', async () => {
      await bringPostsIntoLine({ apply: true })
      expect(await linkOf(zoomEvent.id)).to.equal(meetingRoomUrl(zoomEvent.id))
      expect(await linkOf(emptyEvent.id)).to.equal(meetingRoomUrl(emptyEvent.id))
      expect(await linkOf(roomEvent.id)).to.equal(meetingRoomUrl(roomEvent.id))
      expect(await linkOf(note.id)).to.equal(null)
      expect((await Post.find(onlyLink.id)).get('location')).to.equal(null)
      expect((await Post.find(linkAndMore.id)).get('location')).to.equal('Community Hall or https://zoom.us/j/999')

      const again = await bringPostsIntoLine({ apply: true })
      expect(again.links).to.deep.equal([])
      expect(again.locations.map(l => String(l.id))).to.deep.equal([String(linkAndMore.id)])
    })

    it('makes the calendar files of changed events again, without emails', async () => {
      await bookshelf.knex('posts').where('id', zoomEvent.id).update({ meeting_link: 'https://zoom.us/j/123' })
      queued = []
      await bringPostsIntoLine({ apply: true })
      const jobs = queued.map(j => `${j.model}.${j.method}`)
      expect(jobs).to.include('Group.createEventCalendarSubscription')
      expect(jobs.some(j => /Rsvp\b|sendUserRsvp|processEventUpdated/.test(j) && !/createRsvpCalendarSubscription/.test(j))).to.equal(false)
    })

    it('takes every video call link away when no call server is set', async () => {
      delete process.env.AGORA_MEET_DOMAIN
      await bringPostsIntoLine({ apply: true })
      expect(await linkOf(zoomEvent.id)).to.equal(null)
      expect(await linkOf(roomEvent.id)).to.equal(null)
    })
  })
})
