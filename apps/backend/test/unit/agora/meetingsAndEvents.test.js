/* eslint-env mocha */
/**
 * Agora: Meetings and Events, the calendar, the calendar feed and "for all of
 * 7BP". See lib/agora/eventKinds.js and lib/agora/calendar.js.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep. From apps/backend:
 *
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test node node_modules/mocha/bin/_mocha \
 *     -r dotenv/config -r ./test/setup/core.js -r @babel/register --exit test/setup/index.js \
 *     test/unit/agora/meetingsAndEvents.test.js
 */
import createPost from '../../../api/models/post/createPost'
import updatePost from '../../../api/models/post/updatePost'
import { createRequestHandler } from '../../../api/graphql'
import { postFilter, commentFilter, reactionFilter } from '../../../api/graphql/filters'
import { setProposalOptions } from '../../../api/graphql/mutations/post'
import { hideCalendarSecret } from '../../../lib/agora/hideSecrets'
import MeetingController from '../../../api/controllers/MeetingController'
import MeetingGuestController from '../../../api/controllers/MeetingGuestController'
import { createLink } from '../../../lib/agora/meetingGuests'
import AgoraCalendarController from '../../../api/controllers/AgoraCalendarController'
import { meetingRoomUrl, bringPostsIntoLine } from '../../../lib/agora/meetingLink'
import { kindOf, canMarkForAll, mainGroupSlug } from '../../../lib/agora/eventKinds'
import Calendar from '../../../lib/agora/calendar'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const { assignAdministrator } = require(rootPath('test/setup/roleHelpers'))

const DAY = 86400000

describe('Agora meetings and events', () => {
  const saved = {}
  let handler, originalClassMethod
  let queued = []
  // steward: steward of the main circle (7bp) and member of the governance circle
  // amara: member of 7bp and governance; kenji: member of 7bp and care only
  // outsider: an Agora member in no circle with these posts
  let steward, amara, kenji, outsider, main, governance, care, publicCircle

  const soon = (days = 1) => Date.now() + days * DAY
  const make = (user, attrs = {}) => createPost(user.id, {
    name: 'Circle meeting',
    type: Post.Type.EVENT,
    group_ids: [governance.id],
    startTime: soon(),
    endTime: soon() + 3600000,
    ...attrs
  })
  const change = (user, post, attrs = {}) => updatePost(user.id, post.id, {
    name: post.get('name'),
    type: Post.Type.EVENT,
    group_ids: attrs.group_ids || [governance.id],
    startTime: post.get('start_time'),
    endTime: post.get('end_time'),
    location: post.get('location'),
    ...attrs
  })
  const reload = id => Post.find(id)
  const failsWith = async (fn) => {
    try { await fn() } catch (e) { return e.message }
    return null
  }

  async function gql (document, variables, user) {
    const req = factories.mock.request()
    req.url = '/noo/graphql'
    req.method = 'POST'
    req.headers = { 'Content-Type': 'application/json' }
    req.session = user ? { userId: user.id, destroy: () => {} } : {}
    const { executionResult } = await handler.inject({ document, variables, serverContext: { req, res: factories.mock.response() } })
    return executionResult
  }

  function callCalendar (action, { user, params = {}, query = {}, headers = { 'x-agora': '1' } } = {}) {
    const req = factories.mock.request()
    req.params = { ...params, ...query }
    req.query = query
    req.headers = headers
    if (user) req.login(user.id)
    const res = factories.mock.response()
    res.headers = {}
    res.set = (key, value) => { res.headers[key] = value; return res }
    res.type = value => { res.contentType = value; return res }
    return AgoraCalendarController[action](req, res).then(() => res)
  }

  before(async () => {
    for (const name of ['AGORA_MEET_DOMAIN', 'PROTOCOL', 'DOMAIN', 'AGORA_MAIN_GROUP_SLUG']) saved[name] = process.env[name]
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    delete process.env.AGORA_MAIN_GROUP_SLUG
    // Jobs are only noted down, not run
    originalClassMethod = Queue.classMethod
    Queue.classMethod = (model, method, data) => { queued.push({ model, method, data }); return Promise.resolve() }

    await setup.clearDb()
    handler = createRequestHandler()
    steward = await new User({ name: 'Demo Steward', email: 'steward@agora.test', active: true }).save()
    amara = await new User({ name: 'Amara', email: 'amara@agora.test', active: true }).save()
    kenji = await new User({ name: 'Kenji', email: 'kenji@agora.test', active: true }).save()
    outsider = await new User({ name: 'Priya', email: 'priya@agora.test', active: true }).save()
    main = await new Group({ slug: '7bp', name: '7 Billion Presidents', active: true, visibility: Group.Visibility.PROTECTED }).save()
    governance = await new Group({ slug: '7bp-governance', name: 'Governance', active: true, visibility: Group.Visibility.PROTECTED }).save()
    care = await new Group({ slug: '7bp-care', name: 'Care', active: true, visibility: Group.Visibility.HIDDEN }).save()
    publicCircle = await new Group({ slug: 'open-circle', name: 'Open circle', active: true, allow_in_public: true }).save()
    // One more circle, for the outsider only, so they are an Agora member
    const elsewhere = await new Group({ slug: 'elsewhere', name: 'Elsewhere', active: true }).save()

    await assignAdministrator(steward, main)
    await steward.joinGroup(governance)
    await steward.joinGroup(publicCircle)
    await amara.joinGroup(main)
    await amara.joinGroup(governance)
    await amara.joinGroup(publicCircle)
    await kenji.joinGroup(main)
    await kenji.joinGroup(care)
    await outsider.joinGroup(elsewhere)
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

  describe('the two kinds', () => {
    it('makes an event post without a kind a Meeting, with its meeting room', async () => {
      const post = await make(amara)
      const saved = await reload(post.id)
      expect(saved.get('agora_kind')).to.equal('meeting')
      expect(kindOf(saved)).to.equal('meeting')
      expect(saved.get('meeting_link')).to.equal(meetingRoomUrl(post.id))
    })

    it('never makes a Meeting public, whatever is sent', async () => {
      const post = await make(amara, { group_ids: [publicCircle.id], isPublic: true, agoraKind: 'meeting' })
      expect((await reload(post.id)).get('is_public')).to.equal(false)
    })

    it('gives an Event no meeting room, even when a link is sent, and lets it be public', async () => {
      const post = await make(amara, { group_ids: [publicCircle.id], agoraKind: 'event', isPublic: true, location: 'Library, Main Street 1', meetingLink: 'https://agora.example.org/noo/meeting/1/room' })
      const saved = await reload(post.id)
      expect(saved.get('agora_kind')).to.equal('event')
      expect(saved.get('meeting_link')).to.equal(null)
      expect(saved.get('is_public')).to.equal(true)
      expect(saved.get('location')).to.equal('Library, Main Street 1')
    })

    it('refuses a kind it does not know', async () => {
      expect(await failsWith(() => make(amara, { agoraKind: 'party' }))).to.contain('"meeting" or "event"')
    })

    it('gives other posts no kind and no "for all of 7BP", even when sent', async () => {
      const post = await createPost(steward.id, { name: 'A note', type: Post.Type.DISCUSSION, group_ids: [main.id], agoraKind: 'meeting', agoraForAll: true })
      const saved = await reload(post.id)
      expect(saved.get('agora_kind')).to.equal(null)
      expect(saved.get('agora_for_all')).to.equal(false)
    })

    it('keeps the kind when a change does not send one', async () => {
      const post = await make(amara, { agoraKind: 'event', location: 'Town hall' })
      await change(amara, await reload(post.id), { name: 'Info evening' })
      const saved = await reload(post.id)
      expect(saved.get('agora_kind')).to.equal('event')
      expect(saved.get('meeting_link')).to.equal(null)
    })

    it('turns a Meeting into an Event: the meeting room goes', async () => {
      const post = await make(amara)
      await change(amara, await reload(post.id), { agoraKind: 'event', location: 'Town hall' })
      const saved = await reload(post.id)
      expect(saved.get('agora_kind')).to.equal('event')
      expect(saved.get('meeting_link')).to.equal(null)
    })

    it('turns an Event into a Meeting: the meeting room comes, it stops being public, and invitees hear of it', async () => {
      const post = await make(amara, { group_ids: [publicCircle.id], agoraKind: 'event', isPublic: true, location: 'Town hall' })
      queued = []
      await change(amara, await reload(post.id), { group_ids: [publicCircle.id], agoraKind: 'meeting', isPublic: true })
      const saved = await reload(post.id)
      expect(saved.get('agora_kind')).to.equal('meeting')
      expect(saved.get('meeting_link')).to.equal(meetingRoomUrl(post.id))
      expect(saved.get('is_public')).to.equal(false)
      const job = queued.find(j => j.method === 'processEventUpdated')
      expect(job.data.eventChanges.meeting_link).to.equal(meetingRoomUrl(post.id))
    })

    it('opens the meeting room for a Meeting only, never for an Event', async () => {
      const meeting = await make(amara)
      const gathering = await make(amara, { agoraKind: 'event', location: 'Town hall' })
      const call = async post => {
        const req = factories.mock.request()
        req.params = { postId: String(post.id) }
        req.login(amara.id)
        const res = factories.mock.response()
        res.set = () => {}
        res.type = () => res
        await MeetingController.room(req, res)
        return res
      }
      const ok = await call(meeting)
      expect(ok.statusCode).to.equal(undefined)
      expect(ok.body).to.contain('"eventId"')
      const refused = await call(gathering)
      expect(refused.statusCode).to.equal(404)
    })

    it('makes guest links for a Meeting only, and an old guest link stops when it becomes an Event', async () => {
      const res = () => {
        const r = factories.mock.response()
        r.headers = {}
        r.set = (key, value) => { r.headers[key] = value; return r }
        r.type = () => r
        return r
      }
      const memberCall = async (action, post) => {
        const req = factories.mock.request()
        req.params = { postId: String(post.id) }
        req.headers = { 'x-agora': '1' }
        req.login(amara.id)
        const r = res()
        await MeetingController[action](req, r)
        return r
      }
      const gathering = await make(amara, { agoraKind: 'event', location: 'Town hall' })
      expect((await memberCall('createGuestLink', gathering)).statusCode).to.equal(404)
      expect((await memberCall('guestLink', gathering)).statusCode).to.equal(404)

      const meeting = await make(amara)
      const made = await memberCall('createGuestLink', meeting)
      expect(made.statusCode).to.equal(undefined)
      expect(made.body.url).to.contain(`/noo/meeting/${meeting.id}/guest/`)

      const { secret } = await createLink({ post: await reload(meeting.id), userId: amara.id })
      const guestPage = async () => {
        const req = factories.mock.request()
        req.params = { postId: String(meeting.id), token: secret }
        req.headers = {}
        req.ip = '10.9.9.' + Math.floor(Math.random() * 200 + 1)
        const r = res()
        await MeetingGuestController.page(req, r)
        return r
      }
      expect((await guestPage()).statusCode).to.equal(undefined)
      await change(amara, await reload(meeting.id), { agoraKind: 'event', location: 'Town hall' })
      expect((await guestPage()).statusCode).to.equal(404)
    })

    it('lets the repair script take a link off an Event and give a Meeting its room', async () => {
      const meeting = await make(amara)
      const gathering = await make(amara, { agoraKind: 'event', location: 'Town hall' })
      await bookshelf.knex('posts').where('id', meeting.id).update({ meeting_link: null })
      await bookshelf.knex('posts').where('id', gathering.id).update({ meeting_link: 'https://zoom.us/j/1' })
      const { links } = await bringPostsIntoLine({ apply: true })
      expect(links.map(l => String(l.id))).to.include.members([String(meeting.id), String(gathering.id)])
      expect((await reload(meeting.id)).get('meeting_link')).to.equal(meetingRoomUrl(meeting.id))
      expect((await reload(gathering.id)).get('meeting_link')).to.equal(null)
      expect((await bringPostsIntoLine({ apply: false })).links).to.have.length(0)
    })
  })

  describe('through GraphQL, as the web page sends it', () => {
    const CREATE = 'mutation ($data: PostInput) { createPost(data: $data) { id type agoraKind agoraForAll meetingLink isPublic } }'
    const POST = 'query ($id: ID) { post(id: $id) { id title agoraKind agoraForAll } }'

    it('takes the kind and gives it back', async () => {
      const result = await gql(CREATE, { data: { title: 'Stand at the fair', type: 'event', agoraKind: 'event', groupIds: [governance.id], startTime: new Date(soon()), endTime: new Date(soon() + 3600000), location: 'Fairground' } }, amara)
      expect(result.errors).to.equal(undefined)
      expect(result.data.createPost.agoraKind).to.equal('event')
      expect(result.data.createPost.meetingLink).to.equal(null)
      expect(result.data.createPost.agoraForAll).to.equal(false)
    })

    it('refuses "for all of 7BP" from someone who is not a steward of the main circle', async () => {
      const result = await gql(CREATE, { data: { title: 'All hands', type: 'event', agoraForAll: true, groupIds: [governance.id], startTime: new Date(soon()), endTime: new Date(soon() + 3600000) } }, amara)
      expect(result.errors[0].message).to.contain('Only stewards of the main 7BP circle')
    })

    it('lets every logged-in member open a meeting for all of 7BP, but not others of a circle they are not in', async () => {
      const forAll = await make(steward, { name: 'All hands', agoraForAll: true })
      const closed = await make(steward, { name: 'Governance only' })
      const seen = await gql(POST, { id: forAll.id }, kenji)
      expect(seen.data.post.title).to.equal('All hands')
      expect(seen.data.post.agoraForAll).to.equal(true)
      const notSeen = await gql(POST, { id: closed.id }, kenji)
      expect(notSeen.data.post).to.equal(null)
      const loggedOut = await gql(POST, { id: forAll.id }, null)
      expect(loggedOut.data.post).to.equal(null)
    })
  })

  describe('for all of 7BP', () => {
    it('knows who the stewards of the main circle are', async () => {
      expect(mainGroupSlug()).to.equal('7bp')
      expect(await canMarkForAll(steward.id)).to.equal(true)
      expect(await canMarkForAll(amara.id)).to.equal(false)
      expect(await canMarkForAll(null)).to.equal(false)
      process.env.AGORA_MAIN_GROUP_SLUG = '7bp-governance'
      try {
        expect(await canMarkForAll(steward.id)).to.equal(false)
      } finally {
        delete process.env.AGORA_MAIN_GROUP_SLUG
      }
    })

    it('lets a steward mark it, and others still edit it without losing the mark', async () => {
      const post = await make(steward, { agoraForAll: true })
      expect((await reload(post.id)).get('agora_for_all')).to.equal(true)
      // A change that does not send the field keeps the mark
      await change(steward, await reload(post.id), { name: 'All hands, new title' })
      expect((await reload(post.id)).get('agora_for_all')).to.equal(true)
    })

    it('refuses to switch it off for someone who is not a steward', async () => {
      const post = await make(amara)
      await bookshelf.knex('posts').where('id', post.id).update({ agora_for_all: true })
      const message = await failsWith(() => change(amara, post, { agoraForAll: false }))
      expect(message).to.contain('Only stewards')
      expect((await reload(post.id)).get('agora_for_all')).to.equal(true)
      // Sending the same value needs no check
      await change(amara, await reload(post.id), { agoraForAll: true, name: 'Renamed' })
      expect((await reload(post.id)).get('name')).to.equal('Renamed')
    })

    it('counts as visible to every logged-in member', async () => {
      const post = await make(steward, { agoraForAll: true })
      expect(await Post.isVisibleToUser(post.id, kenji.id)).to.equal(true)
      expect(await Post.isVisibleToUser(post.id, null)).to.equal(false)
      const closed = await make(steward)
      expect(await Post.isVisibleToUser(closed.id, kenji.id)).to.equal(false)
      const visible = await postFilter(kenji.id, false)(Post.collection().query(q => q.whereIn('posts.id', [post.id, closed.id]))).fetch()
      expect(visible.map(p => String(p.id))).to.deep.equal([String(post.id)])
    })

    it('queues calendar invitations for everyone only when asked, and only for something for all of 7BP', async () => {
      await make(steward, { agoraForAll: true, agoraInviteEveryone: true })
      expect(queued.filter(j => j.model === 'AgoraCalendar' && j.method === 'inviteEveryone')).to.have.length(1)
      queued = []
      await make(steward, { agoraForAll: true })
      await make(steward, { agoraInviteEveryone: true })
      expect(queued.filter(j => j.model === 'AgoraCalendar')).to.have.length(0)
      // A change never sends them again
      const post = await make(steward, { agoraForAll: true })
      queued = []
      await change(steward, await reload(post.id), { agoraInviteEveryone: true })
      expect(queued.filter(j => j.model === 'AgoraCalendar')).to.have.length(0)
    })

    it('sends every active Agora member but the steward an invitation with the calendar file', async () => {
      const post = await make(steward, { name: 'Public launch', agoraForAll: true, agoraKind: 'event', location: 'Dam Square' })
      const asleep = await new User({ name: 'Gone', email: 'gone@agora.test', active: false }).save()
      await asleep.joinGroup(main)
      const sent = []
      const count = await Calendar.inviteEveryone({ postId: post.id, inviterId: steward.id, sendEmail: async (email, data, files) => sent.push({ email, data, files }) })
      expect(count).to.equal(3)
      expect(sent.map(s => s.email).sort()).to.deep.equal(['amara@agora.test', 'kenji@agora.test', 'priya@agora.test'])
      expect(sent[0].data.kind).to.equal('event')
      expect(sent[0].data.location).to.equal('Dam Square')
      expect(sent[0].data.room_url).to.equal(null)
      expect(sent[0].files[0].id).to.equal('invite.ics')
      const ics = Buffer.from(sent[0].files[0].data, 'base64').toString('utf8')
      expect(ics).to.contain('SUMMARY:Public launch')
      // The address every member can open, not the circle's own address
      expect(ics.replace(/\r?\n /g, '')).to.contain(`URL;VALUE=URI:https://agora.example.org/post/${post.id}`)
      expect(ics).not.to.contain('/groups/')
      expect(ics).to.contain(`UID:event-${post.id}-hylo.com`)
      // Nothing for something that is not for all of 7BP
      const closed = await make(steward)
      expect(await Calendar.inviteEveryone({ postId: closed.id, inviterId: steward.id, sendEmail: async () => { throw new Error('no') } })).to.equal(0)
    })
  })

  describe('who may change a post', () => {
    let govSteward, post
    before(async () => {
      govSteward = await new User({ name: 'Lars', email: 'lars@agora.test', active: true }).save()
      await assignAdministrator(govSteward, governance)
    })
    beforeEach(async () => {
      post = await make(steward, { name: 'All hands', agoraForAll: true })
    })

    it('lets the author change it', async () => {
      await change(steward, await reload(post.id), { name: 'All hands, renamed' })
      expect((await reload(post.id)).get('name')).to.equal('All hands, renamed')
    })

    it('lets a steward of one of its circles change it', async () => {
      await change(govSteward, await reload(post.id), { name: 'Moderated' })
      expect((await reload(post.id)).get('name')).to.equal('Moderated')
    })

    it('refuses another member of the circle, and someone outside it, also through GraphQL', async () => {
      expect(await failsWith(() => change(amara, post, { name: 'Taken over' }))).to.contain("don't have permission")
      expect(await failsWith(() => change(kenji, post, { name: 'Moved', group_ids: [care.id] }))).to.contain("don't have permission")
      const result = await gql('mutation ($id: ID, $data: PostInput) { updatePost(id: $id, data: $data) { id } }', { id: post.id, data: { title: 'Moved', type: 'event', groupIds: [care.id], startTime: new Date(soon()), endTime: new Date(soon() + 3600000) } }, kenji)
      expect(result.errors[0].message).to.contain("don't have permission")
      const saved = await reload(post.id)
      expect(saved.get('name')).to.equal('All hands')
      const groups = await bookshelf.knex('groups_posts').where('post_id', post.id).pluck('group_id')
      expect(groups.map(String)).to.deep.equal([String(governance.id)])
    })

    it('refuses changing proposal options to someone who may not change the post', async () => {
      const proposal = await createPost(amara.id, { name: 'A proposal', type: Post.Type.PROPOSAL, group_ids: [governance.id], proposalOptions: [{ text: 'Yes', emoji: '', color: '' }] })
      expect(await failsWith(() => setProposalOptions({ userId: steward.id, postId: proposal.id, options: [{ text: 'No', emoji: '', color: '' }] }))).to.contain("don't have permission")
    })
  })

  describe('comments and reactions on something for all of 7BP', () => {
    it('are visible to every logged-in member, not only to the circle', async () => {
      const forAll = await make(steward, { name: 'All hands with notes', agoraForAll: true })
      const closed = await make(steward, { name: 'Governance only, with notes' })
      for (const p of [forAll, closed]) {
        await bookshelf.knex('comments').insert({ user_id: amara.id, post_id: p.id, text: 'See you there', active: true, created_at: new Date() })
        await bookshelf.knex('reactions').insert({ user_id: amara.id, entity_id: p.id, entity_type: 'post', emoji_full: ':+1:', date_reacted: new Date() })
      }
      const comments = await commentFilter(kenji.id)(Comment.collection().query(q => q.whereIn('comments.post_id', [forAll.id, closed.id]))).fetch()
      expect(comments.map(c => String(c.get('post_id')))).to.deep.equal([String(forAll.id)])
      const reactions = await reactionFilter(kenji.id)(Reaction.collection().query(q => q.whereIn('reactions.entity_id', [forAll.id, closed.id]))).fetch()
      expect(reactions.map(r => String(r.get('entity_id')))).to.deep.equal([String(forAll.id)])
    })

    it('stop being for all of 7BP when the only circle is gone, and only event posts can be for all', async () => {
      const gone = await new Group({ slug: 'gone-circle', name: 'Gone', active: true }).save()
      await steward.joinGroup(gone)
      const post = await make(steward, { name: 'In a circle that goes away', agoraForAll: true, group_ids: [gone.id] })
      expect(await Post.isVisibleToUser(post.id, kenji.id)).to.equal(true)
      await bookshelf.knex('groups').where('id', gone.id).update({ active: false })
      expect(await Post.isVisibleToUser(post.id, kenji.id)).to.equal(false)
      const visible = await postFilter(kenji.id, false)(Post.collection().query(q => q.where('posts.id', post.id))).fetch()
      expect(visible.length).to.equal(0)
      const items = await Calendar.itemsFor(outsider.id, { from: new Date(Date.now() - DAY), to: new Date(Date.now() + 30 * DAY) })
      expect(items.map(i => i.title)).not.to.include('In a circle that goes away')

      const note = await createPost(steward.id, { name: 'A note', type: Post.Type.DISCUSSION, group_ids: [main.id] })
      expect(await failsWith(() => bookshelf.knex('posts').where('id', note.id).update({ agora_for_all: true }))).to.contain('posts_agora_for_all_check')
    })
  })

  describe('the calendar', () => {
    let govMeeting, careMeeting, forAllEvent, oldMeeting, farMeeting

    before(async () => {
      await bookshelf.knex('posts').where('type', 'event').update({ active: false })
      govMeeting = await make(amara, { name: 'Governance weekly', startTime: soon(2), endTime: soon(2) + 3600000 })
      careMeeting = await make(kenji, { name: 'Care circle', group_ids: [care.id], startTime: soon(3), endTime: soon(3) + 3600000 })
      forAllEvent = await make(steward, { name: 'Info evening', agoraKind: 'event', agoraForAll: true, group_ids: [care.id], location: 'Community Hall, Utrecht', startTime: soon(4), endTime: soon(4) + 7200000 })
      oldMeeting = await make(amara, { name: 'Long ago', startTime: soon(-200), endTime: soon(-200) + 3600000 })
      farMeeting = await make(amara, { name: 'Far ahead', startTime: soon(800), endTime: soon(800) + 3600000 })
    })

    const titles = items => items.map(i => i.title)
    const window = () => ({ from: new Date(Date.now() - 30 * DAY), to: new Date(Date.now() + 30 * DAY) })

    it('shows a person the meetings and events of their own circles and those for all of 7BP', async () => {
      expect(titles(await Calendar.itemsFor(amara.id, window()))).to.deep.equal(['Governance weekly', 'Info evening'])
      expect(titles(await Calendar.itemsFor(kenji.id, window()))).to.deep.equal(['Care circle', 'Info evening'])
      expect(titles(await Calendar.itemsFor(outsider.id, window()))).to.deep.equal(['Info evening'])
    })

    it('marks the kind, the meeting room and the place, and hides circles the person may not see', async () => {
      const [meeting, gathering] = await Calendar.itemsFor(amara.id, window())
      expect(meeting.kind).to.equal('meeting')
      expect(meeting.roomUrl).to.equal(meetingRoomUrl(govMeeting.id))
      expect(meeting.groups.map(g => g.name)).to.deep.equal(['Governance'])
      expect(gathering.kind).to.equal('event')
      expect(gathering.roomUrl).to.equal(null)
      expect(gathering.location).to.equal('Community Hall, Utrecht')
      expect(gathering.forAll).to.equal(true)
      // Care is a hidden circle: its name is only shown to its members
      expect(gathering.groups).to.deep.equal([])
      const [, forKenji] = await Calendar.itemsFor(kenji.id, window())
      expect(forKenji.groups.map(g => g.name)).to.deep.equal(['Care'])
    })

    it('leaves out people someone blocked', async () => {
      // The steward is in Governance, where Amara made "Governance weekly"
      expect(titles(await Calendar.itemsFor(steward.id, window()))).to.deep.equal(['Governance weekly', 'Info evening'])
      await bookshelf.knex('blocked_users').insert({ user_id: steward.id, blocked_user_id: amara.id, created_at: new Date() })
      try {
        expect(titles(await Calendar.itemsFor(steward.id, window()))).to.deep.equal(['Info evening'])
      } finally {
        await bookshelf.knex('blocked_users').del()
      }
    })

    it('answers the page with the items between two dates, and refuses bad dates', async () => {
      const res = await callCalendar('items', { user: amara, query: { from: new Date(Date.now() - DAY).toISOString(), to: new Date(Date.now() + 10 * DAY).toISOString() } })
      expect(titles(res.body.items)).to.deep.equal(['Governance weekly', 'Info evening'])
      expect(res.body.items[0]).not.to.have.property('description')
      const bad = await callCalendar('items', { user: amara, query: { from: 'nonsense', to: 'x' } })
      expect(bad.statusCode).to.equal(400)
      const tooLong = await callCalendar('items', { user: amara, query: { from: new Date(0).toISOString(), to: new Date().toISOString() } })
      expect(tooLong.statusCode).to.equal(400)
    })

    it('tells the page whether the person may mark things for all of 7BP', async () => {
      expect((await callCalendar('me', { user: steward })).body).to.deep.include({ canMarkForAll: true })
      const me = (await callCalendar('me', { user: amara })).body
      expect(me.canMarkForAll).to.equal(false)
      expect(me.mainGroup.slug).to.equal('7bp')
    })

    describe('the calendar feed', () => {
      const tokenOf = url => url.match(/\/noo\/agora\/calendar\/([A-Za-z0-9_-]+)\.ics$/)[1]
      const feed = token => callCalendar('feed', { params: { file: `${token}.ics` }, headers: {} })

      it('has no link until the person asks for one', async () => {
        expect((await callCalendar('myFeed', { user: kenji })).body.url).to.equal(null)
      })

      it('makes a long secret link that only works for its owner, with what their page shows', async () => {
        const res = await callCalendar('renewFeed', { user: amara })
        const url = res.body.url
        expect(url).to.match(/^https:\/\/agora\.example\.org\/noo\/agora\/calendar\/[A-Za-z0-9_-]{43}\.ics$/)
        expect((await callCalendar('myFeed', { user: amara })).body.url).to.equal(url)

        const answer = await feed(tokenOf(url))
        expect(answer.statusCode).to.equal(undefined)
        expect(answer.contentType).to.contain('text/calendar')
        expect(answer.headers['Cache-Control']).to.contain('no-store')
        const ics = answer.body
        expect(ics).to.contain('BEGIN:VCALENDAR')
        expect(ics).to.contain('SUMMARY:Meeting: Governance weekly')
        expect(ics).to.contain(`LOCATION:${meetingRoomUrl(govMeeting.id)}`)
        expect(ics).to.contain('SUMMARY:Info evening')
        expect(ics).to.contain('LOCATION:Community Hall\\, Utrecht')
        expect(ics).to.contain(`UID:event-${forAllEvent.id}-hylo.com`)
      })

      it('keeps out what the person may not see, and what is too old or too far ahead', async () => {
        const url = (await callCalendar('myFeed', { user: amara })).body.url
        const ics = (await feed(tokenOf(url))).body
        expect(ics).not.to.contain('Care circle')
        expect(ics).not.to.contain('Long ago')
        expect(ics).not.to.contain('Far ahead')
        expect(Boolean(oldMeeting.id && farMeeting.id && careMeeting.id)).to.equal(true)
      })

      it('stops the old link when a new one is made, and stops it when switched off', async () => {
        const first = tokenOf((await callCalendar('myFeed', { user: amara })).body.url)
        const second = tokenOf((await callCalendar('renewFeed', { user: amara })).body.url)
        expect(second).not.to.equal(first)
        expect((await feed(first)).statusCode).to.equal(404)
        expect((await feed(second)).statusCode).to.equal(undefined)
        await callCalendar('revokeFeed', { user: amara })
        expect((await feed(second)).statusCode).to.equal(404)
        expect((await callCalendar('myFeed', { user: amara })).body.url).to.equal(null)
      })

      it('refuses changes that do not come from the Agora page, and links that are wrong or belong to a deactivated account', async () => {
        expect((await callCalendar('renewFeed', { user: amara, headers: {} })).statusCode).to.equal(400)
        expect((await feed('not-a-token')).statusCode).to.equal(404)
        expect((await feed('A'.repeat(43))).statusCode).to.equal(404)
        const url = (await callCalendar('renewFeed', { user: outsider })).body.url
        await bookshelf.knex('users').where('id', outsider.id).update({ active: false })
        try {
          expect((await feed(tokenOf(url))).statusCode).to.equal(404)
        } finally {
          await bookshelf.knex('users').where('id', outsider.id).update({ active: true })
        }
      })

      it('answers only <secret>.ics, and keeps every secret under /noo/agora/calendar/ out of logs', async () => {
        const url = (await callCalendar('renewFeed', { user: amara })).body.url
        const token = tokenOf(url)
        expect((await callCalendar('feed', { params: { file: token }, headers: {} })).statusCode).to.equal(404)
        expect((await feed(token)).statusCode).to.equal(undefined)
        expect(hideCalendarSecret(`/noo/agora/calendar/${token}.ics`)).to.equal('/noo/agora/calendar/(hidden)')
        expect(hideCalendarSecret(`/noo/agora/calendar/${token}`)).to.equal('/noo/agora/calendar/(hidden)')
        expect(hideCalendarSecret(`https://x.test/noo/agora/calendar/${token}?a=1`)).to.equal('https://x.test/noo/agora/calendar/(hidden)?a=1')
        expect(hideCalendarSecret('/noo/agora/calendar/api/items?from=1')).to.equal('/noo/agora/calendar/api/items?from=1')
        expect(hideCalendarSecret('/noo/graphql')).to.equal('/noo/graphql')
        await callCalendar('revokeFeed', { user: amara })
      })

      it('needs a login for everything but the feed itself', async () => {
        expect((await callCalendar('myFeed', {})).statusCode).to.equal(401)
        expect((await callCalendar('items', {})).statusCode).to.equal(401)
      })
    })
  })
})
