/* eslint-env mocha */
/**
 * Agora: guests in a meeting (people without an Agora account).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/meetingGuests.test.js
 */
import createPost from '../../../api/models/post/createPost'
import MeetingController from '../../../api/controllers/MeetingController'
import MeetingGuestController from '../../../api/controllers/MeetingGuestController'
import {
  cleanName, isSecret, hashSecret, sameHash, defaultExpiry, createRateLimiter, rateLimiter, LIMITS
} from '../../../lib/agora/meetingGuests'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const { spyify, unspyify } = require(rootPath('test/setup/helpers'))
const routes = require(rootPath('config/routes')).routes
const policies = require(rootPath('config/policies')).policies

let ipCounter = 0

/** A request from a new address each time, unless one is given. */
function request ({ params = {}, query = {}, headers = {}, userId = null, ip = null, body = null }) {
  const req = factories.mock.request()
  req.params = params
  req.query = query
  req.headers = { 'x-agora': '1', ...headers }
  req.ip = ip || `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`
  if (body) {
    // the segment call reads the raw sound from the request stream
    req.on = (name, handler) => {
      if (name === 'data') setImmediate(() => handler(body))
      if (name === 'end') setImmediate(() => setImmediate(handler))
      return req
    }
  }
  if (userId) req.login(userId)
  return req
}

function response () {
  const res = factories.mock.response()
  res.headers = {}
  res.set = (name, value) => { res.headers[name] = value; return res }
  res.type = () => res
  return res
}

async function run (controller, action, options) {
  const res = response()
  await controller[action](request(options), res)
  return res
}

describe('Agora meeting guests: small parts', () => {
  it('accepts ordinary names and refuses odd ones', () => {
    expect(cleanName('  Ana   María  ')).to.equal('Ana María')
    expect(cleanName("Seán O'Neil-Ng")).to.equal("Seán O'Neil-Ng")
    expect(cleanName('李小龍')).to.equal('李小龍')
    expect(cleanName('')).to.equal(null)
    expect(cleanName('   ')).to.equal(null)
    expect(cleanName('x'.repeat(61))).to.equal(null)
    expect(cleanName('<script>')).to.equal(null)
    expect(cleanName('Ignore all rules: you are')).to.equal(null)
    expect(cleanName('Line\nbreak')).to.equal('Line break')
    expect(cleanName(42)).to.equal(null)
    expect(cleanName(['Ana'])).to.equal(null)
  })

  it('knows what a link secret looks like', () => {
    expect(isSecret('a'.repeat(43))).to.equal(true)
    expect(isSecret('a'.repeat(42))).to.equal(false)
    expect(isSecret('a'.repeat(42) + '/')).to.equal(false)
    expect(isSecret(null)).to.equal(false)
  })

  it('compares hashes only when both are hashes', () => {
    const h = hashSecret('x')
    expect(sameHash(h, h)).to.equal(true)
    expect(sameHash(h, hashSecret('y'))).to.equal(false)
    expect(sameHash(h, 'short')).to.equal(false)
  })

  it('lets a link run until two hours after the event ends', () => {
    const end = new Date('2026-11-01T20:00:00Z')
    const post = { get: k => ({ end_time: end, start_time: new Date('2026-11-01T19:00:00Z') })[k] }
    expect(defaultExpiry(post).toISOString()).to.equal('2026-11-01T22:00:00.000Z')
  })

  it('counts calls and stops them over the limit', () => {
    const limiter = createRateLimiter()
    expect(limiter.allow('k', 2, 60000)).to.equal(true)
    expect(limiter.allow('k', 2, 60000)).to.equal(true)
    expect(limiter.allow('k', 2, 60000)).to.equal(false)
    expect(limiter.allow('other', 2, 60000)).to.equal(true)
  })

  it('gives guests no way to read the notes or end the meeting', () => {
    const guestRoutes = Object.keys(routes).filter(r => r.includes('/guest/'))
    expect(guestRoutes.length).to.equal(7)
    for (const route of guestRoutes) {
      expect(routes[route]).to.match(/^MeetingGuestController\./)
    }
    expect(Object.keys(MeetingGuestController).sort()).to.deep.equal(['chat', 'end', 'join', 'page', 'segment', 'status', 'summary'])
    // The member calls, the transcript among them, still need a login
    expect(policies.MeetingController['*']).to.equal('sessionAuth')
    expect(policies.MeetingController.transcript).to.equal(undefined)
    expect(policies.MeetingGuestController['*']).to.equal(undefined)
  })
})

describe('Agora meeting guests', () => {
  let saved, creator, steward, member, outsider, group, event, otherEvent

  const link = {}

  function guestCall (action, { token = link.secret, guest = null, query = {}, params = {}, headers = {}, body, ip } = {}) {
    const extra = guest ? { 'x-agora-guest-id': guest.guestId, 'x-agora-guest-key': guest.guestKey } : {}
    return run(MeetingGuestController, action, {
      params: { postId: String(event.id), token, ...params },
      query,
      headers: { 'content-type': 'audio/webm', ...extra, ...headers },
      body,
      ip
    })
  }

  function memberCall (action, userId, { params = {}, query = {}, postId = event.id } = {}) {
    return run(MeetingController, action, { params: { postId: String(postId), ...params }, query, userId })
  }

  async function newLink () {
    const res = await memberCall('createGuestLink', creator.id)
    expect(res.statusCode).to.equal(undefined)
    link.url = res.body.url
    link.secret = res.body.url.split('/guest/')[1]
    return res
  }

  before(async () => {
    saved = {
      url: process.env.AGORA_TRANSCRIPTION_URL,
      key: process.env.AGORA_TRANSCRIPTION_KEY,
      meet: process.env.AGORA_MEET_DOMAIN
    }
    process.env.AGORA_TRANSCRIPTION_URL = 'http://localhost:9/v1/audio/transcriptions'
    delete process.env.AGORA_TRANSCRIPTION_KEY
    process.env.AGORA_MEET_DOMAIN = 'kmeet.infomaniak.com'
    spyify(Queue, 'classMethod')
    await setup.clearDb()
    rateLimiter.reset()

    creator = await new User({ name: 'Amara', email: 'guests-creator@agora.test', active: true }).save()
    steward = await new User({ name: 'Lars', email: 'guests-steward@agora.test', active: true }).save()
    member = await new User({ name: 'Mei', email: 'guests-member@agora.test', active: true }).save()
    outsider = await new User({ name: 'Otto', email: 'guests-outsider@agora.test', active: true }).save()
    group = await new Group({ slug: 'guest-circle', name: 'Guest circle' }).save()
    await creator.joinGroup(group)
    await steward.joinGroup(group)
    await member.joinGroup(group)

    // Make Lars a steward: a role with Manage Content in this circle
    const responsibility = await Responsibility.where({ title: 'Manage Content', type: 'system' }).fetch()
    const role = await new GroupRole({ group_id: group.id, name: 'Moderator', active: true }).save()
    await bookshelf.knex('group_roles_responsibilities').insert({ group_role_id: role.id, responsibility_id: responsibility.id })
    await new MemberGroupRole({ group_id: group.id, user_id: steward.id, group_role_id: role.id, active: true }).save()

    event = await createPost(creator.id, {
      name: 'Circle meeting with guests',
      type: Post.Type.EVENT,
      group_ids: [group.id],
      startTime: Date.now(),
      endTime: Date.now() + 3600000
    })
    otherEvent = await createPost(creator.id, {
      name: 'Another meeting',
      type: Post.Type.EVENT,
      group_ids: [group.id],
      startTime: Date.now(),
      endTime: Date.now() + 3600000
    })
  })

  after(() => {
    unspyify(Queue, 'classMethod')
    rateLimiter.reset()
    if (saved.url === undefined) delete process.env.AGORA_TRANSCRIPTION_URL
    else process.env.AGORA_TRANSCRIPTION_URL = saved.url
    if (saved.key !== undefined) process.env.AGORA_TRANSCRIPTION_KEY = saved.key
    if (saved.meet === undefined) delete process.env.AGORA_MEET_DOMAIN
    else process.env.AGORA_MEET_DOMAIN = saved.meet
  })

  describe('making the link', () => {
    it('lets the person who made the event make a link', async () => {
      const res = await newLink()
      expect(res.body.url).to.match(/\/noo\/meeting\/\d+\/guest\/[A-Za-z0-9_-]{43}$/)
      const expires = new Date(res.body.link.expiresAt).getTime()
      expect(expires).to.be.closeTo(new Date(event.get('end_time')).getTime() + 2 * 3600000, 1000)
    })

    it('stores only a hash of the link, never the link itself', async () => {
      const row = await bookshelf.knex('meeting_guest_links').where({ post_id: event.id }).first()
      expect(row.token_hash).to.equal(hashSecret(link.secret))
      expect(row.token_hash).not.to.contain(link.secret)
      const everything = JSON.stringify(await bookshelf.knex('meeting_guest_links').select())
      expect(everything).not.to.contain(link.secret)
    })

    it('lets a steward of the circle make one', async () => {
      const res = await memberCall('guestLink', steward.id)
      expect(res.body.canManage).to.equal(true)
      expect(res.body.link.expired).to.equal(false)
      expect(JSON.stringify(res.body)).not.to.contain(link.secret)
    })

    it('does not let other members make, see or revoke one', async () => {
      const seen = await memberCall('guestLink', member.id)
      expect(seen.body).to.deep.equal({ canManage: false })
      const made = await memberCall('createGuestLink', member.id)
      expect(made.statusCode).to.equal(403)
      const revoked = await memberCall('revokeGuestLink', member.id)
      expect(revoked.statusCode).to.equal(403)
      const row = await bookshelf.knex('meeting_guest_links').where({ post_id: event.id }).first()
      expect(row.revoked_at).to.equal(null)
      expect(row.token_hash).to.equal(hashSecret(link.secret))
    })

    it('does not let people outside the circle near it', async () => {
      const made = await memberCall('createGuestLink', outsider.id)
      expect(made.statusCode).to.equal(403)
    })
  })

  describe('the guest page', () => {
    it('opens for a valid link, in guest mode, without the event page or the notes', async () => {
      const res = await guestCall('page')
      expect(res.statusCode).to.equal(undefined)
      expect(res.body).to.contain('"guest":true')
      expect(res.body).to.contain('"eventUrl":null')
      expect(res.body).to.contain('"me":null')
      // the secret is in the address, so it must not leak to the call's site or be kept
      expect(res.headers['Referrer-Policy']).to.equal('no-referrer')
      expect(res.headers['Cache-Control']).to.equal('no-store')
      expect(res.body).not.to.contain(`/groups/${group.get('slug')}`)
    })

    it('refuses a wrong link', async () => {
      const wrong = link.secret.slice(0, -1) + (link.secret.endsWith('A') ? 'B' : 'A')
      const res = await guestCall('page', { token: wrong })
      expect(res.statusCode).to.equal(404)
      expect(res.body).not.to.contain('"guest":true')
    })

    it('refuses a link of the wrong shape', async () => {
      for (const token of ['', 'short', link.secret + 'x', '../../etc/passwd', link.secret.slice(0, 42) + '%']) {
        const res = await guestCall('page', { token })
        expect(res.statusCode).to.equal(404)
      }
    })

    it('refuses the link on another event', async () => {
      const res = await run(MeetingGuestController, 'page', { params: { postId: String(otherEvent.id), token: link.secret } })
      expect(res.statusCode).to.equal(404)
    })
  })

  describe('joining', () => {
    it('makes the guest wait until a member has opened the meeting', async () => {
      const res = await guestCall('join', { params: { name: 'Zoe', notes: true } })
      expect(res.statusCode).to.equal(409)
      expect(res.body.status).to.equal('waiting')
    })

    it('asks for a name', async () => {
      await memberCall('join', creator.id, { params: { notes: true } })
      for (const name of [undefined, '', '   ', 'x'.repeat(61), '<b>Zoe</b>']) {
        const res = await guestCall('join', { params: { name, notes: true } })
        expect(res.statusCode).to.equal(400)
      }
    })

    it('lets a guest join with the notes, and records the choice', async () => {
      const res = await guestCall('join', { params: { name: 'Zoe', notes: true } })
      expect(res.statusCode).to.equal(undefined)
      expect(res.body.notes).to.equal(true)
      expect(res.body.displayName).to.equal('Zoe (guest)')
      expect(res.body.roomName).to.match(/^agora-/)
      expect(res.body).not.to.have.property('people')
      expect(res.body).not.to.have.property('lines')
      link.zoe = res.body
      const row = await bookshelf.knex('meeting_guests').where({ id: res.body.guestId }).first()
      expect(row.notes_consent).to.equal(true)
      expect(row.key_hash).to.equal(hashSecret(res.body.guestKey))
    })

    it('keeps a guest out of the notes unless they say yes', async () => {
      const res = await guestCall('join', { params: { name: 'Yusuf' } })
      expect(res.body.notes).to.equal(false)
      link.yusuf = res.body
      const row = await bookshelf.knex('meeting_guests').where({ id: res.body.guestId }).first()
      expect(row.notes_consent).to.equal(false)
    })

    it('shows guests to the members in the room, marked as guests', async () => {
      const res = await memberCall('transcript', member.id)
      const names = res.body.people.map(p => p.name)
      expect(names).to.include('Zoe (guest)')
      expect(names).to.include('Yusuf (guest)')
    })
  })

  describe('speaking', () => {
    it('takes speech from a guest who agreed, under their guest name', async () => {
      const res = await guestCall('segment', {
        guest: link.zoe,
        query: { sessionId: link.zoe.sessionId, spokenAt: String(Date.now()), durationMs: '3000' },
        body: Buffer.alloc(1000, 1)
      })
      expect(res.body.transcribing).to.equal(true)
      const row = await bookshelf.knex('meeting_segments').where({ id: res.body.id }).first()
      expect(row.user_id).to.equal(null)
      expect(String(row.guest_id)).to.equal(link.zoe.guestId)
    })

    it('takes no speech from a guest who said no', async () => {
      const res = await guestCall('segment', {
        guest: link.yusuf,
        query: { sessionId: link.yusuf.sessionId, spokenAt: String(Date.now()), durationMs: '3000' },
        body: Buffer.alloc(1000, 1)
      })
      expect(res.statusCode).to.equal(403)
    })

    it('takes no speech without the guest\'s own secret, or with another guest\'s', async () => {
      const query = { sessionId: link.zoe.sessionId, spokenAt: String(Date.now()), durationMs: '3000' }
      const none = await guestCall('segment', { query, body: Buffer.alloc(1000, 1) })
      expect(none.statusCode).to.equal(403)
      const mixed = await guestCall('segment', {
        guest: { guestId: link.zoe.guestId, guestKey: link.yusuf.guestKey },
        query,
        body: Buffer.alloc(1000, 1)
      })
      expect(mixed.statusCode).to.equal(403)
    })

    it('lists the guest as a guest in the notes and the minutes', async () => {
      const session = await MeetingSession.findOpenForPost(event.id)
      await bookshelf.knex('meeting_segments').where({ session_id: session.id }).update({ status: 'done', text: 'Hello from outside', audio: null })
      const lines = await MeetingSession.lines(session.id)
      expect(lines[0].name).to.equal('Zoe (guest)')
      expect(lines[0].userId).to.equal(null)

      const html = MeetingMinutes.renderHtml({ minutes: null, attendees: ['Amara'], guests: ['Zoe (guest)'], lines, startedAt: session.get('started_at') })
      expect(html).to.contain('<strong>Zoe (guest)</strong>')
      expect(html).to.match(/Guests.*Zoe \(guest\)/)
    })
  })

  describe('what a guest can never do', () => {
    it('cannot read the transcript, with or without the guest secrets', async () => {
      const headers = { 'x-agora-guest-id': link.zoe.guestId, 'x-agora-guest-key': link.zoe.guestKey }
      const res = await run(MeetingController, 'transcript', {
        params: { postId: String(event.id), token: link.secret },
        headers
      })
      expect(res.statusCode).to.equal(403)
      expect(res.body).not.to.have.property('lines')
    })

    it('only learns whether the meeting goes on, and the chat', async () => {
      const res = await guestCall('status', { guest: link.zoe })
      expect(res.body).to.deep.equal({ status: 'open', chat: [] })
      expect(JSON.stringify(res.body)).not.to.contain('Hello from outside')
    })

    it('cannot end the meeting for everyone, only leave', async () => {
      const res = await guestCall('end', { guest: link.yusuf })
      expect(res.body.status).to.equal('left')
      const session = await MeetingSession.findOpenForPost(event.id)
      expect(session).not.to.equal(null)
      expect(session.get('status')).to.equal('open')
      const asMember = await run(MeetingController, 'end', { params: { postId: String(event.id), token: link.secret } })
      expect(asMember.statusCode).to.equal(403)
      expect((await MeetingSession.findOpenForPost(event.id)).get('status')).to.equal('open')
    })
  })

  describe('closing and expiry', () => {
    it('refuses a revoked link, and sends guests out', async () => {
      const revoked = await memberCall('revokeGuestLink', steward.id)
      expect(revoked.body.link).to.equal(null)
      const page = await guestCall('page')
      expect(page.statusCode).to.equal(410)
      const join = await guestCall('join', { params: { name: 'Zoe', notes: true } })
      expect(join.statusCode).to.equal(410)
      const status = await guestCall('status', { guest: link.zoe })
      expect(status.statusCode).to.equal(410)
      const segment = await guestCall('segment', {
        guest: link.zoe,
        query: { sessionId: link.zoe.sessionId, spokenAt: String(Date.now()), durationMs: '3000' },
        body: Buffer.alloc(1000, 1)
      })
      expect(segment.statusCode).to.equal(410)
    })

    it('replaces the old link when a new one is made', async () => {
      const old = link.secret
      await newLink()
      expect(link.secret).not.to.equal(old)
      const oldPage = await guestCall('page', { token: old })
      expect(oldPage.statusCode).to.equal(404)
      const newPage = await guestCall('page')
      expect(newPage.statusCode).to.equal(undefined)
      // Guests who joined through the old link must join again
      const status = await guestCall('status', { guest: link.zoe })
      expect(status.statusCode).to.equal(403)
    })

    it('refuses an expired link', async () => {
      await bookshelf.knex('meeting_guest_links').where({ post_id: event.id }).update({ expires_at: new Date(Date.now() - 1000) })
      const page = await guestCall('page')
      expect(page.statusCode).to.equal(410)
      const join = await guestCall('join', { params: { name: 'Zoe', notes: true } })
      expect(join.statusCode).to.equal(410)
    })

    it('makes no link for an event that ended long ago', async () => {
      await bookshelf.knex('posts').where({ id: otherEvent.id }).update({
        start_time: new Date(Date.now() - 6 * 3600000),
        end_time: new Date(Date.now() - 5 * 3600000)
      })
      const res = await memberCall('createGuestLink', creator.id, { postId: otherEvent.id })
      expect(res.statusCode).to.equal(409)
      const row = await bookshelf.knex('meeting_guest_links').where({ post_id: otherEvent.id }).first()
      expect(row).to.equal(undefined)
    })
  })

  describe('the minutes', () => {
    it('lists guests as guests, apart from the members', async () => {
      const session = await MeetingSession.findOpenForPost(event.id)
      const ended = await memberCall('end', creator.id)
      expect(ended.body.status).to.equal('closing')
      const minutes = await MeetingSession.finalize({ sessionId: session.id })
      const html = minutes.get('description')
      expect(html).to.match(/Who was there<\/h3><p>Amara<\/p>/)
      expect(html).to.contain('Guests')
      expect(html).to.contain('Zoe (guest)')
      expect(html).to.contain('Yusuf (guest)')
      expect(html).to.contain('<strong>Zoe (guest)</strong>')
    })
  })

  describe('rate limits', () => {
    beforeEach(() => rateLimiter.reset())
    after(() => rateLimiter.reset())

    it('slows down one address opening the page again and again', async () => {
      await newLink()
      const ip = '192.0.2.10'
      let last
      for (let i = 0; i <= LIMITS.page; i++) last = await guestCall('page', { ip })
      expect(last.statusCode).to.equal(429)
      const other = await guestCall('page', { ip: '192.0.2.11' })
      expect(other.statusCode).to.equal(undefined)
    })

    it('shuts out an address that keeps trying wrong links', async () => {
      const ip = '192.0.2.20'
      for (let i = 0; i < 21; i++) {
        await guestCall('page', { ip, token: 'b'.repeat(43) })
      }
      const right = await guestCall('page', { ip })
      expect(right.statusCode).to.equal(429)
    })

    it('limits joining per address', async () => {
      const ip = '192.0.2.30'
      let last
      for (let i = 0; i <= LIMITS.join; i++) last = await guestCall('join', { ip, params: { name: 'Repeat', notes: false } })
      expect(last.statusCode).to.equal(429)
    })
  })
})
