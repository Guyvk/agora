/* eslint-env mocha */
/**
 * Agora: tasks suggested by meeting minutes (lib/agora/taskSuggestions.js, the
 * "suggestions" addresses of AgoraTasksController.js, lib/agora/tasksFromMinutes.js).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/taskSuggestions.test.js
 */
import AgoraTasksController from '../../../api/controllers/AgoraTasksController'
import Suggestions from '../../../lib/agora/taskSuggestions'
import TaskNotify from '../../../lib/agora/taskNotify'
import { backfill } from '../../../lib/agora/tasksFromMinutes'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

describe('Agora task suggestions', () => {
  let amara, hana, mariam, zenab, bea, dan, circle, other, minutesPost, session, project, deadProject
  const knex = () => bookshelf.knex
  const sent = []

  function call (action, { params = {}, query = {}, body, userId, fromPage = true } = {}) {
    const req = factories.mock.request()
    req.params = params
    req.query = query
    req.body = body
    req.headers = fromPage ? { 'x-agora': '1' } : {}
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.set = () => {}
    return AgoraTasksController[action](req, res).then(() => res)
  }

  const listFor = (postId, userId = hana.id) => call('suggestions', { query: { minutesPostId: postId }, userId })
  const mine = userId => call('suggestionsMine', { userId })
  const accept = (id, body, userId) => call('acceptSuggestion', { params: { id }, body: body || {}, userId })
  const dismiss = (id, userId) => call('dismissSuggestion', { params: { id }, userId })
  const notMine = (id, userId) => call('notMine', { params: { id }, userId })
  const acceptAll = (minutesPostId, userId) => call('acceptAll', { body: { minutesPostId }, userId })

  async function makeMinutes ({ name, host = hana, group = circle, participants, guests = [] }) {
    const ev = await factories.post({ name, type: 'event', user_id: amara.id }).save()
    await knex()('groups_posts').insert({ post_id: ev.id, group_id: group.id })
    const mp = await factories.post({ name: `Minutes: ${name}`, type: 'discussion', user_id: amara.id }).save()
    await knex()('groups_posts').insert({ post_id: mp.id, group_id: group.id })
    const [s] = await knex()('meeting_sessions').insert({
      post_id: ev.id, room_name: 'room-' + ev.id, status: 'closed', started_by_id: host.id, minutes_post_id: mp.id, started_at: new Date('2026-11-02T18:00:00Z')
    }).returning('id')
    const sessionId = s.id || s
    for (const u of participants) await knex()('meeting_participants').insert({ session_id: sessionId, user_id: u.id, joined_at: new Date() })
    for (const g of guests) await knex()('meeting_guests').insert({ session_id: sessionId, name: g, key_hash: 'h' + g, joined_at: new Date() })
    return { event: ev, minutesPost: mp, sessionId }
  }

  before(async () => {
    await setup.clearDb()
    TaskNotify.setSender(async options => { sent.push(options); return true })
    const user = (name, email) => new User({ name, email, active: true }).save()
    amara = await user('Amara', 'amara@sugg.test')
    hana = await user('Hana', 'hana@sugg.test')
    mariam = await user('Mariam:)', 'mariam@sugg.test')
    zenab = await user('zenab suleiman', 'zenab@sugg.test')
    bea = await user('Bea', 'bea@sugg.test')
    dan = await user('Dan', 'dan@sugg.test')
    circle = await new Group({ slug: 'communications', name: 'Communications' }).save()
    other = await new Group({ slug: 'care', name: 'Care' }).save()
    for (const u of [amara, hana, mariam, zenab, bea]) await u.joinGroup(circle)
    await dan.joinGroup(other)

    // Amara is a steward of the circle (Manage Content)
    const responsibility = await Responsibility.where({ title: 'Manage Content', type: 'system' }).fetch()
    const role = await new GroupRole({ group_id: circle.id, name: 'Moderator', active: true }).save()
    await knex()('group_roles_responsibilities').insert({ group_role_id: role.id, responsibility_id: responsibility.id })
    await new MemberGroupRole({ group_id: circle.id, user_id: amara.id, group_role_id: role.id, active: true }).save()

    const proj = async (name, attrs = {}) => {
      const p = await factories.post({ name, type: 'project', user_id: amara.id, ...attrs }).save()
      await knex()('groups_posts').insert({ post_id: p.id, group_id: circle.id })
      return p
    }
    project = await proj('Website')
    deadProject = await proj('Old', { active: false })

    // Bea was not in the meeting; Hana hosted; a guest called Gina was there
    ;({ minutesPost, sessionId: session } = await makeMinutes({ name: 'Weekly', participants: [hana, mariam, zenab], guests: ['Gina'] }))
  })

  after(() => TaskNotify.setSender(null))

  describe('making suggestions from minutes', () => {
    it('matches names to people in the meeting, never guests, and handles "Everyone"', async () => {
      const { created } = await Suggestions.createFromMinutes({
        sessionId: session,
        minutesPostId: minutesPost.id,
        title: 'Weekly',
        date: '2026-11-02',
        actions: [
          { who: ['Mariam'], what: 'Ring the venue', due: '2026-12-01', project: String(project.id) },
          { who: ['Zenab', 'Mariam'], what: 'Write the flyer', due: '' },
          { who: 'Gina', what: 'Guest task', due: '' },
          { who: ['Bea'], what: 'Bea was not there', due: '' },
          { who: ['Everyone'], what: 'Read the plan', due: 'Friday', project: String(deadProject.id) },
          { who: 'Unknown person', what: '', due: '' }
        ]
      })
      // 4 single action points + "Everyone" once for each of the 3 members present; the empty one is skipped
      expect(created).to.have.length(7)
      const res = await listFor(minutesPost.id)
      expect(res.body.isMinutes).to.equal(true)
      const byWhat = what => res.body.suggestions.filter(x => x.what === what)
      expect(byWhat('Ring the venue')[0]).to.include({ dueDate: '2026-12-01', projectId: Number(project.id), projectName: 'Website', status: 'open', whoText: 'Mariam' })
      expect(byWhat('Ring the venue')[0].people.map(p => p.name)).to.deep.equal(['Mariam:)'])
      expect(byWhat('Write the flyer')[0].people.map(p => p.name).sort()).to.deep.equal(['Mariam:)', 'zenab suleiman'])
      expect(byWhat('Write the flyer')[0].whoText).to.equal('Zenab and Mariam')
      expect(byWhat('Guest task')[0].people).to.deep.equal([])
      expect(byWhat('Bea was not there')[0].people).to.deep.equal([])
      expect(byWhat('Read the plan')).to.have.length(3)
      expect(byWhat('Read the plan').map(x => x.people.length)).to.deep.equal([1, 1, 1])
      expect(byWhat('Read the plan')[0].dueDate).to.equal(null) // "Friday" is not a date
      expect(byWhat('Read the plan')[0].projectId).to.equal(null) // a closed project is not used
      expect(new Set(byWhat('Read the plan').map(x => x.people[0].name))).to.deep.equal(new Set(['Hana', 'Mariam:)', 'zenab suleiman']))
    })

    it('does not make them twice for the same minutes', async () => {
      const again = await Suggestions.createFromMinutes({ sessionId: session, minutesPostId: minutesPost.id, actions: [{ who: ['Hana'], what: 'More', due: '' }] })
      expect(again.created).to.have.length(0)
    })

    it('sends one email per named person, and none to people who switched email off', async () => {
      // the emails go out in the background: wait for them
      await new Promise(resolve => setTimeout(resolve, 300))
      const to = sent.filter(m => m.email_id === 'agora_task_suggested').map(m => m.recipient.address).sort()
      expect(to).to.deep.equal(['hana@sugg.test', 'mariam@sugg.test', 'zenab@sugg.test'])
      const mariamMail = sent.find(m => m.email_id === 'agora_task_suggested' && m.recipient.address === 'mariam@sugg.test')
      expect(mariamMail.email_data.items).to.have.members(['Ring the venue', 'Write the flyer', 'Read the plan'])

      const before = sent.length
      await knex()('group_memberships').where({ user_id: hana.id, group_id: circle.id }).update({ settings: JSON.stringify({ sendEmail: false }) })
      const { sessionId: s2, minutesPost: mp2 } = await makeMinutes({ name: 'Quiet', participants: [hana, bea] })
      await Suggestions.createFromMinutes({ sessionId: s2, minutesPostId: mp2.id, actions: [{ who: ['Hana', 'Bea'], what: 'Quiet task' }] })
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(sent.slice(before).map(m => m.recipient.address)).to.deep.equal(['bea@sugg.test'])
      await knex()('group_memberships').where({ user_id: hana.id, group_id: circle.id }).update({ settings: JSON.stringify({}) })
    })

    it('never throws, whatever it is given', async () => {
      const bad = await Suggestions.createFromMinutes({ sessionId: session, minutesPostId: '99999999', actions: 'nonsense' })
      expect(bad.created).to.have.length(0)
    })
  })

  describe('who gets in', () => {
    it('needs a login and, for changes, the Agora header', async () => {
      expect((await call('suggestions', { query: { minutesPostId: minutesPost.id } })).statusCode).to.equal(403)
      expect((await call('suggestionsMine', {})).statusCode).to.equal(403)
      expect((await call('acceptSuggestion', { params: { id: '1' }, userId: hana.id, fromPage: false })).statusCode).to.equal(400)
      expect((await call('acceptAll', { body: { minutesPostId: minutesPost.id }, userId: hana.id, fromPage: false })).statusCode).to.equal(400)
    })

    it('says "not found" to someone outside the circle, and "not a minutes post" for other posts', async () => {
      expect((await listFor(minutesPost.id, dan.id)).statusCode).to.equal(404)
      const some = (await listFor(minutesPost.id)).body.suggestions[0]
      expect((await accept(some.id, {}, dan.id)).statusCode).to.equal(404)
      expect((await dismiss(some.id, dan.id)).statusCode).to.equal(404)
      expect((await notMine(some.id, dan.id)).statusCode).to.equal(404)
      expect((await acceptAll(minutesPost.id, dan.id)).statusCode).to.equal(404)
      const res = await listFor(project.id)
      expect(res.body).to.deep.equal({ isMinutes: false, suggestions: [], canAcceptAll: false })
      expect((await listFor('abc')).statusCode).to.equal(404)
    })

    it('tells each person whether they can decide: named person, host, steward', async () => {
      const flyer = async userId => (await listFor(minutesPost.id, userId)).body.suggestions.find(x => x.what === 'Write the flyer')
      expect((await flyer(zenab.id)).canDecide).to.equal(true) // named
      expect((await flyer(hana.id)).canDecide).to.equal(true) // host
      expect((await flyer(amara.id)).canDecide).to.equal(true) // steward
      expect((await flyer(bea.id)).canDecide).to.equal(false) // member, not named
      expect((await listFor(minutesPost.id, hana.id)).body.canAcceptAll).to.equal(true)
      expect((await listFor(minutesPost.id, amara.id)).body.canAcceptAll).to.equal(true)
      expect((await listFor(minutesPost.id, zenab.id)).body.canAcceptAll).to.equal(false)
    })

    it('refuses a member who is not named, not the host and not a steward', async () => {
      const guestTask = (await listFor(minutesPost.id)).body.suggestions.find(x => x.what === 'Guest task')
      expect((await accept(guestTask.id, {}, bea.id)).statusCode).to.equal(403)
      expect((await dismiss(guestTask.id, bea.id)).statusCode).to.equal(403)
      expect((await acceptAll(minutesPost.id, bea.id)).statusCode).to.equal(403)
      expect(Number((await knex()('agora_tasks').count('id as n').first()).n)).to.equal(0)
    })
  })

  describe('deciding', () => {
    const find = async (what, userId = hana.id) => (await listFor(minutesPost.id, userId)).body.suggestions.find(x => x.what === what)

    it('lists the open suggestions of the named person in "mine"', async () => {
      const res = await mine(zenab.id)
      expect(res.body.suggestions.map(x => x.what).sort()).to.deep.equal(['Read the plan', 'Write the flyer'])
      expect(res.body.suggestions[0].meeting).to.deep.equal({ title: 'Weekly', date: '2026-11-02' })
      expect((await mine(bea.id)).body.suggestions.map(x => x.what)).to.deep.equal(['Quiet task'])
      expect((await mine(dan.id)).body.suggestions).to.deep.equal([])
    })

    it('lets the named person add it to their own list, with a source', async () => {
      const s = await find('Ring the venue', mariam.id)
      const res = await accept(s.id, { assigneeIds: [mariam.id] }, mariam.id)
      expect(res.statusCode).to.equal(undefined)
      expect(res.body.task).to.include({ title: 'Ring the venue', dueDate: '2026-12-01', projectId: Number(project.id), status: 'todo' })
      expect(res.body.task.assignees.map(a => a.name)).to.deep.equal(['Mariam:)'])
      expect(res.body.task.source).to.deep.equal({ kind: 'minutes', minutesPostId: Number(minutesPost.id), meetingSessionId: Number(session) })
      expect(res.body.suggestion).to.include({ status: 'accepted', taskId: res.body.task.id, taskStatus: 'todo', canDecide: false })
      expect(res.body.suggestion.people[0].status).to.equal('accepted')
      const now = (await mine(mariam.id)).body.suggestions.map(x => x.what)
      expect(now).to.not.include('Ring the venue')
    })

    it('only decides once', async () => {
      const s = await find('Ring the venue')
      expect((await accept(s.id, {}, hana.id)).statusCode).to.equal(409)
      expect((await dismiss(s.id, hana.id)).statusCode).to.equal(409)
      expect(Number((await knex()('agora_tasks').count('id as n').first()).n)).to.equal(1)
    })

    it('shows done or not done of the task on the suggestion', async () => {
      const s = await find('Ring the venue')
      await knex()('agora_tasks').where({ id: s.taskId }).update({ status: 'done' })
      expect((await find('Ring the venue')).taskStatus).to.equal('done')
    })

    it('lets the host change the people, due date, project and title when adding', async () => {
      const s = await find('Guest task')
      expect(s.people).to.deep.equal([])
      const res = await accept(s.id, { assigneeIds: [bea.id, zenab.id], dueDate: '2026-12-24', projectId: project.id, title: 'Gina offered to help' }, hana.id)
      expect(res.body.task).to.include({ title: 'Gina offered to help', dueDate: '2026-12-24', projectId: Number(project.id) })
      expect(res.body.task.assignees.map(a => a.name).sort()).to.deep.equal(['Bea', 'zenab suleiman'])
    })

    it('refuses people who are not members of the circle, and a project from elsewhere, and leaves it open', async () => {
      const s = await find('Bea was not there')
      expect((await accept(s.id, { assigneeIds: [dan.id] }, hana.id)).statusCode).to.equal(400)
      expect((await accept(s.id, { projectId: deadProject.id }, hana.id)).statusCode).to.equal(400)
      expect((await accept(s.id, { dueDate: 'tomorrow' }, hana.id)).statusCode).to.equal(400)
      expect((await find('Bea was not there')).status).to.equal('open')
    })

    it('lets a steward add it for someone', async () => {
      const s = await find('Bea was not there')
      const res = await accept(s.id, { assigneeIds: [bea.id] }, amara.id)
      expect(res.body.task.assignees.map(a => a.name)).to.deep.equal(['Bea'])
      expect(res.body.task.createdBy.name).to.equal('Amara')
    })

    it('emails the people put on a task, but not the one who did it', async () => {
      await new Promise(resolve => setTimeout(resolve, 300))
      const mails = sent.filter(m => m.email_id === 'agora_task_assigned')
      expect(mails.some(m => m.recipient.address === 'bea@sugg.test' && m.email_data.title === 'Bea was not there')).to.equal(true)
      expect(mails.some(m => m.recipient.address === 'mariam@sugg.test' && m.email_data.title === 'Ring the venue')).to.equal(false) // she added it herself
      expect(mails.find(m => m.recipient.address === 'bea@sugg.test').email_data.url).to.contain('/groups/communications/tasks?task=')
    })

    it('says "not a task" for the named person, the host and a steward', async () => {
      const s = await find('Write the flyer')
      const res = await dismiss(s.id, zenab.id)
      expect(res.body.suggestion).to.include({ status: 'dismissed', taskId: null })
      expect((await mine(zenab.id)).body.suggestions.map(x => x.what)).to.not.include('Write the flyer')
      expect((await accept(s.id, {}, hana.id)).statusCode).to.equal(409)
    })

    it('takes a person off with "not mine" and keeps it open for the host', async () => {
      const [zenabCopy] = (await listFor(minutesPost.id)).body.suggestions.filter(x => x.what === 'Read the plan' && x.people[0].name === 'zenab suleiman')
      expect((await notMine(zenabCopy.id, bea.id)).statusCode).to.equal(400) // not named
      const res = await notMine(zenabCopy.id, zenab.id)
      expect(res.body.suggestion.status).to.equal('open')
      expect(res.body.suggestion.people).to.deep.equal([{ id: Number(zenab.id), name: 'zenab suleiman', avatarUrl: null, status: 'declined', me: true }])
      expect(res.body.suggestion.canDecide).to.equal(false) // zenab said it is not hers
      expect((await mine(zenab.id)).body.suggestions.map(x => x.what)).to.not.include('Read the plan')
      expect((await notMine(zenabCopy.id, zenab.id)).statusCode).to.equal(400) // already off it
      const asHost = (await listFor(minutesPost.id, hana.id)).body.suggestions.find(x => x.id === zenabCopy.id)
      expect(asHost.canDecide).to.equal(true)
      // add-all skips an action point nobody is left on
      const all = await acceptAll(minutesPost.id, hana.id)
      expect(all.body.suggestions.map(x => x.id)).to.not.include(zenabCopy.id)
    })

    it('adds all open action points that have a person, for the host only', async () => {
      const left = (await listFor(minutesPost.id)).body.suggestions
      // After the previous test only the one nobody is left on remains open
      expect(left.filter(x => x.status === 'open').map(x => x.id)).to.deep.equal([left.find(x => x.people[0] && x.people[0].status === 'declined').id])
    })
  })

  describe('add all', () => {
    it('makes a task for each open action point with a person', async () => {
      const m = await makeMinutes({ name: 'Bulk', participants: [hana, mariam, zenab] })
      await Suggestions.createFromMinutes({
        sessionId: m.sessionId,
        minutesPostId: m.minutesPost.id,
        actions: [{ who: ['Mariam'], what: 'One' }, { who: ['Zenab'], what: 'Two' }, { who: ['Nobody'], what: 'Three' }]
      })
      expect((await acceptAll(m.minutesPost.id, mariam.id)).statusCode).to.equal(403)
      const res = await acceptAll(m.minutesPost.id, amara.id) // a steward
      expect(res.body.tasks.map(t => t.title).sort()).to.deep.equal(['One', 'Two'])
      expect(res.body.suggestions.every(x => x.status === 'accepted')).to.equal(true)
      const after = (await listFor(m.minutesPost.id)).body
      expect(after.suggestions.filter(x => x.status === 'open').map(x => x.what)).to.deep.equal(['Three'])
      const again = await acceptAll(m.minutesPost.id, amara.id)
      expect(again.body.tasks).to.deep.equal([])
    })
  })

  describe('open tasks from last time', () => {
    const lastTime = (eventPostId, userId = hana.id) => call('openFromLastTime', { query: { eventPostId }, userId })

    it('shows the open tasks from the previous meeting of the same event, not the done ones', async () => {
      const mkTask = (title, minutes, status = 'todo') => knex()('agora_tasks').insert({
        group_id: circle.id, title, status, position: 1, source_minutes_post_id: minutes.id, created_at: new Date(), updated_at: new Date()
      })
      const a = await makeMinutes({ name: 'Series', participants: [hana] })
      const newerPost = await factories.post({ name: 'Newer minutes', type: 'discussion', user_id: amara.id }).save()
      await knex()('groups_posts').insert({ post_id: newerPost.id, group_id: circle.id })
      const [row] = await knex()('meeting_sessions').insert({
        post_id: a.event.id, room_name: 'again', status: 'closed', started_by_id: hana.id, started_at: new Date('2026-11-09T18:00:00Z'), minutes_post_id: newerPost.id
      }).returning('id')
      const sid2 = row.id || row
      const newer = { minutes_post_id: newerPost.id }
      await mkTask('Old and open', a.minutesPost)
      await mkTask('Old and done', a.minutesPost, 'done')
      await mkTask('From newer', { id: newer.minutes_post_id })
      // the newest meeting of this event wins
      expect((await lastTime(a.event.id)).body.tasks.map(t => t.title)).to.deep.equal(['From newer'])
      await knex()('meeting_sessions').where({ id: sid2 }).update({ started_at: new Date('2026-10-01T18:00:00Z') })
      await knex()('meeting_sessions').where({ post_id: a.event.id, room_name: 'room-' + a.event.id }).update({ started_at: new Date('2026-11-09T18:00:00Z') })
      expect((await lastTime(a.event.id)).body.tasks.map(t => t.title)).to.deep.equal(['Old and open'])
    })

    it('falls back to the latest minutes of the circle, hides when there are none, and keeps outsiders out', async () => {
      const lonely = await factories.post({ name: 'New event', type: 'event', user_id: amara.id }).save()
      await knex()('groups_posts').insert({ post_id: lonely.id, group_id: circle.id })
      const res = await lastTime(lonely.id)
      expect(res.body.minutesPostId).to.not.equal(null)
      const empty = await factories.post({ name: 'Care event', type: 'event', user_id: dan.id }).save()
      await knex()('groups_posts').insert({ post_id: empty.id, group_id: other.id })
      expect((await lastTime(empty.id, dan.id)).body).to.deep.equal({ minutesPostId: null, tasks: [] })
      expect((await lastTime(lonely.id, dan.id)).statusCode).to.equal(404)
    })
  })

  describe('which circle the suggestions go to', () => {
    it('uses the main circle when the post is in it, else the circle the post was made in first (not the lowest id)', async () => {
      const first = await new Group({ slug: 'zeta', name: 'Zeta' }).save() // made later, so a higher id...
      const second = await new Group({ slug: 'alpha', name: 'Alpha' }).save()
      const post = await factories.post({ name: 'Two circles', type: 'discussion', user_id: amara.id }).save()
      // ...but the post was made in zeta first, then also put in alpha, then in the circle with the lowest id
      for (const g of [first, second, circle]) await knex()('groups_posts').insert({ post_id: post.id, group_id: g.id })
      expect(await Suggestions.groupOfPost(post.id)).to.equal(String(first.id))
      const main = await new Group({ slug: '7bp', name: '7 Billion Presidents' }).save()
      await knex()('groups_posts').insert({ post_id: post.id, group_id: main.id })
      expect(await Suggestions.groupOfPost(post.id)).to.equal(String(main.id))
      expect(await Suggestions.groupOfPost('99999999')).to.equal(null)
    })

    it('uses that circle for the people who count and for the suggestions', async () => {
      const m = await makeMinutes({ name: 'Joint', participants: [hana, bea] })
      const quiet = await new Group({ slug: 'quiet', name: 'Quiet' }).save()
      await bea.joinGroup(quiet)
      // the minutes post is also in a second circle added later: the first one stays
      await knex()('groups_posts').insert({ post_id: m.minutesPost.id, group_id: quiet.id })
      await Suggestions.createFromMinutes({ sessionId: m.sessionId, minutesPostId: m.minutesPost.id, actions: [{ who: ['Hana', 'Bea'], what: 'Joint job' }], notify: false })
      const rows = await knex()('agora_task_suggestions').where({ minutes_post_id: m.minutesPost.id })
      expect(String(rows[0].group_id)).to.equal(String(circle.id))
    })
  })

  describe('guests and add all emails', () => {
    it('does not match a member to a guest of the same name', async () => {
      const m = await makeMinutes({ name: 'Guest match', participants: [hana, bea], guests: ['Bea'] })
      const { created } = await Suggestions.createFromMinutes({ sessionId: m.sessionId, minutesPostId: m.minutesPost.id, actions: [{ who: ['Bea'], what: 'Guest named Bea' }, { who: ['Bea (guest)'], what: 'Marked guest' }], notify: false })
      expect(created.map(c => c.people.length)).to.deep.equal([0, 0])
    })

    it('sends one email per person for add all, not one per task, and none to the person who pressed it', async () => {
      const m = await makeMinutes({ name: 'Batch', participants: [hana, mariam, zenab] })
      await Suggestions.createFromMinutes({ sessionId: m.sessionId, minutesPostId: m.minutesPost.id, notify: false, actions: [
        { who: ['Mariam'], what: 'B1' }, { who: ['Mariam', 'Zenab'], what: 'B2' }, { who: ['Amara'], what: 'B3 nobody' }, { who: ['Zenab'], what: 'B4' }
      ] })
      const before = sent.length
      const res = await acceptAll(m.minutesPost.id, hana.id)
      expect(res.body.tasks).to.have.length(3)
      await new Promise(resolve => setTimeout(resolve, 400))
      const mails = sent.slice(before).filter(x => x.email_id === 'agora_task_assigned')
      expect(mails.map(x => x.recipient.address).sort()).to.deep.equal(['mariam@sugg.test', 'zenab@sugg.test'])
      expect(mails.find(x => x.recipient.address === 'mariam@sugg.test').email_data.items).to.have.members(['B1', 'B2'])
      expect(mails.find(x => x.recipient.address === 'zenab@sugg.test').email_data.items).to.have.members(['B2', 'B4'])
    })

    it('keeps everyone who is named when a task is added with no people given', async () => {
      const m = await makeMinutes({ name: 'Default people', participants: [hana, mariam, zenab] })
      await Suggestions.createFromMinutes({ sessionId: m.sessionId, minutesPostId: m.minutesPost.id, notify: false, actions: [{ who: ['Mariam', 'Zenab'], what: 'Both of us' }] })
      const s = (await listFor(m.minutesPost.id)).body.suggestions[0]
      const res = await accept(s.id, {}, mariam.id)
      expect(res.body.task.assignees.map(a => a.name).sort()).to.deep.equal(['Mariam:)', 'zenab suleiman'])
    })
  })

  describe('the backfill', () => {
    it('prints what it would do and writes nothing without --apply, then writes once with it', async () => {
      const html = '<h3>Actions</h3><ul><li><strong>Mariam</strong>: Old job (by 2026-10-30)</li><li><strong>Everyone</strong>: Read it</li><li><strong>Nobody</strong>: Lost job</li></ul>'
      const m = await makeMinutes({ name: 'Old meeting', participants: [hana, mariam] })
      await knex()('posts').where({ id: m.minutesPost.id }).update({ description: html })
      // the other minutes posts have no Actions list in this database, or already have suggestions
      const lines = []
      const dry = await backfill({ apply: false, log: l => lines.push(l) })
      expect(dry.created).to.equal(0)
      expect(lines.join('\n')).to.contain('Mariam -> ' + mariam.id + ' Mariam:)')
      expect(lines.join('\n')).to.contain('Everyone -> everyone present (2 suggestion(s))')
      expect(lines.join('\n')).to.contain('Nobody -> no match')
      expect(lines.join('\n')).to.contain('due 2026-10-30')
      expect((await knex()('agora_task_suggestions').where({ minutes_post_id: m.minutesPost.id })).length).to.equal(0)

      const before = sent.length
      const applied = await backfill({ apply: true, log: () => {} })
      expect(applied.created).to.equal(4) // Mariam, Everyone x2, Nobody
      const rows = await knex()('agora_task_suggestions').where({ minutes_post_id: m.minutesPost.id }).orderBy('id')
      expect(rows.map(r => r.what)).to.deep.equal(['Old job', 'Read it', 'Read it', 'Lost job'])
      expect(rows[0].due_date.toISOString().slice(0, 10)).to.equal('2026-10-30')
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(sent.length).to.equal(before) // nobody is emailed about an old meeting

      const secondTime = await backfill({ apply: true, log: () => {} })
      expect(secondTime.created).to.equal(0)
      expect(secondTime.skipped).to.be.greaterThan(0)
      expect((await knex()('agora_task_suggestions').where({ minutes_post_id: m.minutesPost.id })).length).to.equal(4)
    })
  })
})
