/* eslint-env mocha */
/**
 * Agora: "This week in 7BP" (lib/agora/thisWeek.js).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/thisWeek.test.js
 */
import { ensureMainGroup } from '../../../lib/agora/mainGroup'
import { thisWeek } from '../../../lib/agora/thisWeek'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))

const DAY = 24 * 60 * 60 * 1000

describe('Agora This week in 7BP', () => {
  const knex = () => bookshelf.knex
  const now = new Date('2026-10-24T12:00:00Z')
  const at = days => new Date(now.getTime() + days * DAY)
  let admin, ann, bob, outsider, circleA, circleB, main, savedEnv

  const mk = (name, extra = {}) => new User(Object.assign({ name, email: `${name.toLowerCase()}@agora.test`, active: true, email_validated: true }, extra)).save()

  // A post in the given circles. attrs are column values.
  async function post (name, groups, attrs = {}) {
    const [row] = await knex()('posts').insert(Object.assign({ name, type: 'discussion', active: true, created_at: at(-1), updated_at: at(-1), user_id: admin.id, description: '' }, attrs)).returning('id')
    const id = row.id || row
    for (const g of groups) await knex()('groups_posts').insert({ post_id: id, group_id: g.id })
    return String(id)
  }

  before(async () => {
    savedEnv = { admins: process.env.AGORA_ADMINS, slug: process.env.AGORA_MAIN_GROUP_SLUG }
    delete process.env.AGORA_MAIN_GROUP_SLUG
    await setup.clearDb()
    admin = await mk('Admin')
    ann = await mk('Ann')
    bob = await mk('Bob')
    process.env.AGORA_ADMINS = String(admin.id)
    circleA = await Group.create(ann.id, { name: 'Circle A', slug: 'circle-a' })
    circleB = await Group.create(bob.id, { name: 'Circle B', slug: 'circle-b' })
    await knex()('groups').where('id', circleB.id).update({ visibility: Group.Visibility.HIDDEN })
    const r = await ensureMainGroup({ apply: true })
    expect(r.failures).to.deep.equal([])
    main = await knex()('groups').where('slug', '7bp').first()
    outsider = await mk('Outsider')
    const circleC = await Group.create(outsider.id, { name: 'Circle C', slug: 'circle-c' }) // not under the main circle
    circleC.id // eslint-disable-line no-unused-expressions
  })

  after(() => {
    for (const [key, value] of [['AGORA_ADMINS', savedEnv.admins], ['AGORA_MAIN_GROUP_SLUG', savedEnv.slug]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('answers { enabled: false } for another circle, for no one, and for someone outside the main circle', async () => {
    expect(await thisWeek(String(ann.id), 'circle-a', { now })).to.deep.equal({ enabled: false })
    expect(await thisWeek(null, '7bp', { now })).to.deep.equal({ enabled: false })
    expect(await thisWeek(String(outsider.id), '7bp', { now })).to.deep.equal({ enabled: false })
  })

  it('is empty for a member when nothing has happened', async () => {
    const r = await thisWeek(String(ann.id), '7bp', { now })
    expect(r).to.deep.equal({ enabled: true, meetings: [], announcements: [], minutes: [], decisions: [] })
  })

  it('meetings: the soonest first, up to 6, past ones and other kinds left out, with the circle name and room', async () => {
    const ids = []
    for (let i = 7; i >= 1; i--) {
      ids.push(await post(`Meeting ${i}`, [circleA], { type: 'event', start_time: at(i), end_time: at(i + 0.1), meeting_link: i === 1 ? 'x' : null }))
    }
    await post('Last week', [circleA], { type: 'event', start_time: at(-3), end_time: at(-3 + 0.1) })
    await post('Going on now', [circleA], { type: 'event', start_time: at(-0.05), end_time: at(0.05) })
    await post('Not an event', [circleA], { start_time: at(1), end_time: at(1.1) })
    await post('Far away', [circleA], { type: 'event', start_time: at(20), end_time: at(20.1) })
    const r = await thisWeek(String(ann.id), '7bp', { now })
    expect(r.meetings.map(m => m.title)).to.deep.equal(['Going on now', 'Meeting 1', 'Meeting 2', 'Meeting 3', 'Meeting 4', 'Meeting 5'])
    expect(r.meetings[1].circle).to.deep.equal({ name: 'Circle A', slug: 'circle-a' })
    expect(r.meetings[1].roomPath).to.equal(`/noo/meeting/${r.meetings[1].id}/room`)
    expect(r.meetings[2].roomPath).to.equal(null)
    expect(r.meetings[5].inNextSevenDays).to.equal(true)
    expect(new Date(r.meetings[1].startsAt).toISOString()).to.equal(at(1).toISOString())
    await knex()('groups_posts').whereIn('post_id', ids).del()
    await knex()('posts').whereIn('id', ids).del()
  })

  it('visibility: a member of circle A never sees circle B\'s meeting, announcement, minutes or decision', async () => {
    await post('Secret meeting', [circleB], { type: 'event', start_time: at(2), end_time: at(2.1) })
    await post('Secret news', [circleB], { announcement: true })
    const secretMinutes = await post('Minutes: Secret', [circleB])
    const [s] = await knex()('meeting_sessions').insert({ post_id: secretMinutes, room_name: 'r1', status: 'closed', minutes_post_id: secretMinutes }).returning('id')
    expect(s).to.not.equal(undefined)
    await post('Secret decision', [circleB], { type: 'proposal', proposal_status: 'completed', end_time: at(-1), proposal_outcome: 'Secret' })
    const mine = await thisWeek(String(ann.id), '7bp', { now })
    const text = JSON.stringify(mine)
    expect(text).to.not.contain('Secret')
    expect(text).to.not.contain('Circle B')
    // Bob, who is in circle B, sees all four
    const his = await thisWeek(String(bob.id), '7bp', { now })
    expect(his.meetings.map(m => m.title)).to.include('Secret meeting')
    expect(his.announcements.map(m => m.title)).to.deep.equal(['Secret news'])
    expect(his.minutes.map(m => m.title)).to.deep.equal(['Minutes: Secret'])
    expect(his.decisions.map(m => m.title)).to.deep.equal(['Secret decision'])
    expect(his.decisions[0].circle.name).to.equal('Circle B')
  })

  it('a post in a circle the viewer is in and one they are not shows under the first only', async () => {
    await post('Shared meeting', [circleA, circleB], { type: 'event', start_time: at(3), end_time: at(3.1) })
    const mine = await thisWeek(String(ann.id), '7bp', { now })
    const shared = mine.meetings.find(m => m.title === 'Shared meeting')
    expect(shared.circle.name).to.equal('Circle A')
    expect(JSON.stringify(mine)).to.not.contain('Circle B')
  })

  it('a post only in a circle that is not under the main circle never shows', async () => {
    const circleC = await Group.where({ slug: 'circle-c' }).fetch()
    await post('C meeting', [circleC], { type: 'event', start_time: at(1), end_time: at(1.1) })
    await circleC.addMembers([ann.id])
    expect(JSON.stringify(await thisWeek(String(ann.id), '7bp', { now }))).to.not.contain('C meeting')
  })

  it('a circle switched off or left on purpose gives nothing', async () => {
    await knex()('group_memberships').where({ group_id: circleB.id, user_id: bob.id }).update({ active: false })
    expect(JSON.stringify(await thisWeek(String(bob.id), '7bp', { now }))).to.not.contain('Secret')
    await knex()('group_memberships').where({ group_id: circleB.id, user_id: bob.id }).update({ active: true })
    await knex()('group_relationships').where({ parent_group_id: main.id, child_group_id: circleB.id }).update({ active: false })
    expect(JSON.stringify(await thisWeek(String(bob.id), '7bp', { now }))).to.not.contain('Secret')
    await knex()('group_relationships').where({ parent_group_id: main.id, child_group_id: circleB.id }).update({ active: true })
  })

  it('announcements: the newest 3, as plain text, only real announcements, no chat, no removed posts', async () => {
    await post('Old', [circleA], { announcement: true, created_at: at(-9) })
    await post('News 1', [circleA], { announcement: true, created_at: at(-3), description: '<p>Hello <b>all</b>&nbsp;of you</p>' })
    await post('News 2', [main], { announcement: true, created_at: at(-2) })
    await post('News 3', [circleA], { announcement: true, created_at: at(-1) })
    await post('Plain post', [circleA], { created_at: at(-0.5) })
    await post('Chat news', [circleA], { announcement: true, type: 'chat', created_at: at(-0.4) })
    await post('Removed news', [circleA], { announcement: true, active: false, created_at: at(-0.3) })
    const r = await thisWeek(String(ann.id), '7bp', { now })
    expect(r.announcements.map(a => a.title)).to.deep.equal(['News 3', 'News 2', 'News 1'])
    expect(r.announcements[2].summary).to.equal('Hello all of you')
    expect(r.announcements[1].circle.name).to.equal('7BP')
  })

  it('announcements: a post with no type still shows; a post by a deactivated account does not', async () => {
    const gone = await mk('Gone')
    await post('Untyped news', [circleA], { announcement: true, type: null, created_at: at(-0.2) })
    await post('Gone news', [circleA], { announcement: true, created_at: at(-0.1), user_id: gone.id })
    let r = await thisWeek(String(ann.id), '7bp', { now })
    expect(r.announcements.map(a => a.title)).to.include('Untyped news')
    expect(r.announcements.map(a => a.title)).to.include('Gone news')
    await knex()('users').where('id', gone.id).update({ active: false })
    r = await thisWeek(String(ann.id), '7bp', { now })
    expect(r.announcements.map(a => a.title)).to.include('Untyped news')
    expect(r.announcements.map(a => a.title)).to.not.include('Gone news')
  })

  it('minutes: only posts that a meeting session names, newest 3, with the circle', async () => {
    const make = async (title, days, circle = circleA) => {
      const id = await post(title, [circle], { created_at: at(days) })
      await knex()('meeting_sessions').insert({ post_id: id, room_name: `room-${id}`, status: 'closed', minutes_post_id: id })
      return id
    }
    await make('Minutes: One', -6)
    await make('Minutes: Two', -4)
    await make('Minutes: Three', -2)
    await make('Minutes: Four', -1)
    await post('Minutes: typed by hand', [circleA], { created_at: at(-0.1) }) // not named by a session
    const r = await thisWeek(String(ann.id), '7bp', { now })
    expect(r.minutes.map(m => m.title)).to.deep.equal(['Minutes: Four', 'Minutes: Three', 'Minutes: Two'])
    expect(r.minutes[0].circle.name).to.equal('Circle A')
  })

  it('decisions: ended or completed in the last 14 days, newest 3, with the outcome; not still open, not older, not casual and unfinished', async () => {
    const prop = (title, attrs) => post(title, [circleA], Object.assign({ type: 'proposal', proposal_status: 'completed' }, attrs))
    await prop('Decided long ago', { end_time: at(-20) })
    await prop('Decided 10 days ago', { end_time: at(-10), proposal_outcome: 'Yes, by 5 votes to 2' })
    await prop('Decided 5 days ago', { end_time: at(-5) })
    await prop('Ended yesterday, status not yet updated', { end_time: at(-1), proposal_status: 'voting' })
    await prop('Still voting', { proposal_status: 'voting', start_time: at(-1), end_time: at(2) })
    await prop('Still discussing', { proposal_status: 'discussion', start_time: at(1), end_time: at(3) })
    await prop('Casual, open', { proposal_status: 'casual' })
    await prop('Casual, completed 3 days ago', { proposal_status: 'casual', fulfilled_at: at(-3) })
    const r = await thisWeek(String(ann.id), '7bp', { now })
    expect(r.decisions.map(d => d.title)).to.deep.equal(['Ended yesterday, status not yet updated', 'Casual, completed 3 days ago', 'Decided 5 days ago'])
    const r2 = await thisWeek(String(ann.id), '7bp', { now: at(0) })
    expect(r2.decisions).to.have.length(3)
    const gone = (await knex()('posts').where('name', 'Decided 5 days ago').select('id')).map(r => r.id)
    await knex()('groups_posts').whereIn('post_id', gone).del()
    await knex()('posts').whereIn('id', gone).del()
    const r3 = await thisWeek(String(ann.id), '7bp', { now })
    expect(r3.decisions.map(d => d.title)).to.include('Decided 10 days ago')
    expect(r3.decisions.find(d => d.title === 'Decided 10 days ago').outcome).to.equal('Yes, by 5 votes to 2')
  })

  it('uses a fixed number of queries however many posts there are', async () => {
    let queries = 0
    const count = () => { queries++ }
    knex().client.on('query', count)
    try {
      await thisWeek(String(ann.id), '7bp', { now })
    } finally {
      knex().client.removeListener('query', count)
    }
    expect(queries).to.be.at.most(8)
  })
})
