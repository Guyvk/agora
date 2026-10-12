/* eslint-env mocha */
/**
 * Agora: the shared Contacts page.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/contacts.test.js
 */
import AgoraContactsController from '../../../api/controllers/AgoraContactsController'
import Contacts from '../../../lib/agora/contacts'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

describe('Agora contacts', () => {
  let amara, lars, outsider, circle, other

  function call (action, { params = {}, query = {}, body, userId, fromPage = true } = {}) {
    const req = factories.mock.request()
    req.params = params
    req.query = query
    req.body = body
    req.headers = fromPage ? { 'x-agora': '1' } : {}
    req.originalUrl = '/noo/agora/contacts'
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.set = () => {}
    return AgoraContactsController[action](req, res).then(() => res)
  }

  const knex = () => bookshelf.knex
  const add = (body, userId = amara.id) => call('create', { body, userId })

  before(async () => {
    process.env.PROTOCOL = process.env.PROTOCOL || 'https'
    process.env.DOMAIN = process.env.DOMAIN || 'agora.example.org'
    await setup.clearDb()
    amara = await new User({ name: 'Amara', email: 'amara@agora.test', active: true }).save()
    lars = await new User({ name: 'Lars', email: 'lars@agora.test', active: true }).save()
    outsider = await new User({ name: 'Signed up only', email: 'outsider@agora.test', active: true }).save()
    circle = await new Group({ slug: 'communications', name: 'Communications' }).save()
    other = await new Group({ slug: 'care', name: 'Care' }).save()
    await amara.joinGroup(circle)
    await lars.joinGroup(other)
  })

  it('takes "today" from where 7BP is, not from world time', () => {
    const saved = process.env.AGORA_TIME_ZONE
    try {
      process.env.AGORA_TIME_ZONE = 'Pacific/Kiritimati' // 14 hours ahead of world time
      const ahead = Contacts.today()
      process.env.AGORA_TIME_ZONE = 'Pacific/Pago_Pago' // 11 hours behind
      const behind = Contacts.today()
      expect(ahead).to.match(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(ahead) - new Date(behind)).to.equal(86400000)
    } finally {
      if (saved === undefined) delete process.env.AGORA_TIME_ZONE
      else process.env.AGORA_TIME_ZONE = saved
    }
  })

  describe('who gets in', () => {
    it('sends people who are not logged in to the login page', async () => {
      const res = await call('page')
      expect(res.redirected).to.match(/\/login\?returnToUrl=/)
    })

    it('shows the page to a member of any circle', async () => {
      const res = await call('page', { userId: lars.id })
      expect(res.body).to.contain('"me":{"id":"' + lars.id + '","name":"Lars"}')
    })

    it('keeps out someone who has an account but no circle', async () => {
      const page = await call('page', { userId: outsider.id })
      expect(page.statusCode).to.equal(403)
      const list = await call('list', { userId: outsider.id })
      expect(list.statusCode).to.equal(403)
      const made = await add({ name: 'Sneaky' }, outsider.id)
      expect(made.statusCode).to.equal(403)
    })

    it('refuses changes that do not come from the page itself', async () => {
      const res = await call('create', { body: { name: 'Forged' }, userId: amara.id, fromPage: false })
      expect(res.statusCode).to.equal(400)
      const count = await knex()('agora_contacts').count('id as n').first()
      expect(Number(count.n)).to.equal(0)
    })
  })

  describe('working with contacts', () => {
    let pressId

    it('adds a contact and logs who did it', async () => {
      const res = await add({
        name: 'Mia de Vries',
        organisation: 'Trouw',
        kind: 'press',
        email: 'mia@example.test',
        website: 'trouw.example.test',
        circle_id: String(circle.id),
        source: 'Met at the launch event',
        consent: true,
        follow_up_on: '2000-01-01',
        follow_up_what: 'Send the press kit',
        follow_up_owner_id: String(lars.id)
      })
      expect(res.body.id).to.match(/^\d+$/)
      pressId = res.body.id
      const row = await knex()('agora_contacts').where({ id: pressId }).first()
      expect(row.website).to.equal('https://trouw.example.test')
      expect(row.consent).to.equal(true)
      const log = await knex()('agora_contact_changes').where({ contact_id: pressId })
      expect(log.map(l => [l.action, String(l.user_id)])).to.deep.equal([['created', String(amara.id)]])
    })

    it('says what is wrong with a contact that cannot be saved', async () => {
      expect((await add({ name: '  ' })).body.error).to.match(/name is needed/i)
      expect((await add({ name: 'X', email: 'not an email' })).body.error).to.match(/email/i)
      expect((await add({ name: 'X', kind: 'enemy' })).statusCode).to.equal(400)
      expect((await add({ name: 'X', follow_up_on: '12 October' })).statusCode).to.equal(400)
      expect((await add({ name: 'X', follow_up_owner_id: String(outsider.id) })).body.error).to.match(/not an Agora member/)
    })

    it('finds contacts by search and filters', async () => {
      await add({ name: 'Open Society Fund', kind: 'funder', status: 'active' })
      const byText = await call('list', { query: { q: 'trouw' }, userId: lars.id })
      expect(byText.body.contacts.map(c => c.name)).to.deep.equal(['Mia de Vries'])
      const byKind = await call('list', { query: { kind: 'funder' }, userId: lars.id })
      expect(byKind.body.contacts.map(c => c.name)).to.deep.equal(['Open Society Fund'])
      const byCircle = await call('list', { query: { circle: String(circle.id) }, userId: lars.id })
      expect(byCircle.body.contacts[0]).to.include({ name: 'Mia de Vries', circle_name: 'Communications' })
      const wild = await call('list', { query: { q: '%' }, userId: lars.id })
      expect(wild.body.contacts).to.have.length(0)
    })

    it('shows my follow-ups and counts the ones that are due', async () => {
      const mine = await call('list', { query: { mine: '1' }, userId: lars.id })
      expect(mine.body.contacts.map(c => c.name)).to.deep.equal(['Mia de Vries'])
      const due = await call('dueCount', { userId: lars.id })
      expect(due.body.count).to.equal(1)
      const none = await call('dueCount', { userId: amara.id })
      expect(none.body.count).to.equal(0)
    })

    it('logs which fields changed, but not what they were', async () => {
      const before = (await call('show', { params: { contactId: pressId }, userId: amara.id })).body.contact
      await call('update', {
        params: { contactId: pressId },
        body: { ...before, status: 'in_touch', phone: '+31 6 1234 5678' },
        userId: lars.id
      })
      const log = await knex()('agora_contact_changes').where({ contact_id: pressId, action: 'updated' }).first()
      expect(log.fields.sort()).to.deep.equal(['phone', 'status'])
      expect(JSON.stringify(log)).not.to.contain('1234')
    })

    it('keeps notes with their author', async () => {
      await call('addNote', { params: { contactId: pressId }, body: { body: 'She wants an interview in May.' }, userId: amara.id })
      const shown = (await call('show', { params: { contactId: pressId }, userId: lars.id })).body.contact
      expect(shown.notes.map(n => [n.body, n.author_name])).to.deep.equal([['She wants an interview in May.', 'Amara']])
      expect(shown.changes.map(c => c.action)).to.include('note')
    })

    it('deletes a contact and its notes for good, keeping no personal data', async () => {
      const res = await call('destroy', { params: { contactId: pressId }, userId: lars.id })
      expect(res.body).to.deep.equal({ ok: true })
      expect(await knex()('agora_contacts').where({ id: pressId }).first()).to.equal(undefined)
      expect(await knex()('agora_contact_notes').where({ contact_id: pressId }).first()).to.equal(undefined)
      const log = await knex()('agora_contact_changes').where({ contact_id: pressId })
      expect(log.map(l => l.action)).to.include('deleted')
      expect(JSON.stringify(log)).not.to.match(/Mia|Trouw|mia@/)
      const again = await call('show', { params: { contactId: pressId }, userId: lars.id })
      expect(again.statusCode).to.equal(404)
    })
  })
})
