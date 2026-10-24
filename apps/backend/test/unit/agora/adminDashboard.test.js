/* eslint-env mocha */
/**
 * Agora: the admin dashboard (lib/agora/adminDashboard.js, AgoraAdminController).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/adminDashboard.test.js
 */
import AgoraAdminController from '../../../api/controllers/AgoraAdminController'
import Admins from '../../../lib/agora/admins'
import Dashboard from '../../../lib/agora/adminDashboard'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const ENV_NAMES = ['AGORA_ADMINS', 'AGORA_HELPDESK_ADMINS', 'AGORA_EMAIL_TRANSPORT', 'SENDWITHUS_KEY', 'BREVO_API_KEY', 'ANTHROPIC_API_KEY',
  'AGORA_TRANSCRIPTION_KEY', 'AGORA_SMTP_PASSWORD', 'AGORA_BACKUP_DIR', 'AGORA_OFFSITE_CONF', 'AGORA_VERSION']
const SAVED_ENV = {}

describe('Agora admin dashboard', () => {
  let guy, amara, lars, unconfirmed, sleeping, helpOnly, circle, otherCircle, goneCircle
  let waiting, accepted, revoked
  const knex = () => bookshelf.knex

  function call (action, { params = {}, query = {}, body, userId, fromPage = true } = {}) {
    const req = factories.mock.request()
    req.params = params
    req.query = query
    req.body = body
    req.headers = fromPage ? { 'x-agora': '1' } : {}
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.set = () => {}
    return AgoraAdminController[action](req, res).then(() => res)
  }

  const ACTIONS_EXCEPT_ME = Object.keys(AgoraAdminController).filter(a => a !== 'me')
  const anyParams = { invitationId: '1', accountId: '1' }

  before(async () => {
    for (const name of ENV_NAMES) { SAVED_ENV[name] = process.env[name]; delete process.env[name] }
    process.env.AGORA_VERSION = 'abc1234'
    await setup.clearDb()
    guy = await new User({ name: 'Guy', email: 'guy@agora.test', active: true, email_validated: true, created_at: new Date() }).save()
    amara = await new User({ name: 'Amara Okafor', email: 'amara@agora.test', active: true, email_validated: true, created_at: new Date(), last_active_at: new Date() }).save()
    lars = await new User({ name: 'Lars', email: 'lars@agora.test', active: true, email_validated: true, created_at: new Date(Date.now() - 60 * 24 * 3600 * 1000) }).save()
    unconfirmed = await new User({ name: 'Not confirmed', email: 'boss@agora.test', active: true, email_validated: false, created_at: new Date() }).save()
    sleeping = await new User({ name: 'Gone', email: 'gone@agora.test', active: false, email_validated: true, created_at: new Date() }).save()
    helpOnly = await new User({ name: 'Helper', email: 'helper@agora.test', active: true, email_validated: true, created_at: new Date() }).save()
    process.env.AGORA_ADMINS = `${guy.id}, boss@agora.test, GONE@agora.test, ${sleeping.id}`
    process.env.AGORA_HELPDESK_ADMINS = String(helpOnly.id)

    circle = await factories.group({ name: 'Governance', slug: 'governance', access_code: 'join-governance', created_by_id: guy.id, created_at: new Date() }).save()
    otherCircle = await factories.group({ name: 'Media', slug: 'media', access_code: null, created_by_id: guy.id, created_at: new Date() }).save()
    goneCircle = await factories.group({ name: 'Old', slug: 'old', access_code: 'join-old', active: false, created_at: new Date() }).save()
    await circle.addMembers([guy.id, lars.id])

    const invite = attrs => Invitation.create({ userId: guy.id, groupId: circle.id, ...attrs })
    waiting = await invite({ email: 'new@agora.test' })
    accepted = await invite({ email: 'amara@agora.test' })
    await accepted.use(amara.id)
    revoked = await invite({ email: 'nope@agora.test' })
    await revoked.expire(guy.id)
    await Invitation.create({ userId: guy.id, groupId: goneCircle.id, email: 'late@agora.test' })

    await knex()('join_requests').insert({ user_id: helpOnly.id, group_id: circle.id, status: 0, created_at: new Date(), updated_at: new Date() })
    await knex()('agora_help_requests').insert({ user_id: amara.id, title: 'Save fails', status: 'new', created_at: new Date(), updated_at: new Date() })
    await knex()('agora_help_requests').insert({ user_id: amara.id, title: 'Old wish', status: 'fixed', created_at: new Date(), updated_at: new Date() })

    const event = await factories.post({ user_id: guy.id, type: 'event', name: 'Weekly call' }).save()
    const [session] = await knex()('meeting_sessions').insert({ post_id: event.id, room_name: 'room-1', status: 'closed', started_by_id: guy.id, ended_by_id: guy.id, started_at: new Date(), ended_at: new Date(), created_at: new Date(), updated_at: new Date() }).returning('id')
    const sessionId = session.id || session
    const segment = (ms, status) => ({ session_id: sessionId, user_id: guy.id, spoken_at: new Date(), duration_ms: ms, status, created_at: new Date(), updated_at: new Date() })
    await knex()('meeting_segments').insert([segment(90000, 'done'), segment(30000, 'empty'), segment(600000, 'failed')])
  })

  after(() => {
    for (const name of ENV_NAMES) {
      if (SAVED_ENV[name] === undefined) delete process.env[name]
      else process.env[name] = SAVED_ENV[name]
    }
  })

  describe('who gets in', () => {
    it('knows Agora admins by id of an active account, never by email address', async () => {
      expect(await Admins.isAgoraAdmin(guy.id)).to.equal(true)
      expect(await Admins.isAgoraAdmin(amara.id)).to.equal(false)
      expect(await Admins.isAgoraAdmin(unconfirmed.id)).to.equal(false) // address listed: email entries are ignored
      expect(await Admins.isAgoraAdmin(sleeping.id)).to.equal(false) // listed, but deactivated
      expect(await Admins.isAgoraAdmin(helpOnly.id)).to.equal(false) // only runs the Help desk
      expect(await Admins.isAgoraAdmin(null)).to.equal(false)
      expect(await Admins.isAgoraAdmin('1 or 1=1')).to.equal(false)
      // A confirmed address in the list gives nothing
      const saved = process.env.AGORA_ADMINS
      try {
        process.env.AGORA_ADMINS = 'amara@agora.test'
        expect(await Admins.isAgoraAdmin(amara.id)).to.equal(false)
      } finally {
        process.env.AGORA_ADMINS = saved
      }
    })

    it('makes Help desk admins the people in either list', async () => {
      expect(await Admins.isHelpDeskAdmin(guy.id)).to.equal(true)
      expect(await Admins.isHelpDeskAdmin(helpOnly.id)).to.equal(true)
      expect(await Admins.isHelpDeskAdmin(amara.id)).to.equal(false)
      expect(await Admins.isHelpDeskAdmin(unconfirmed.id)).to.equal(false)
    })

    it('lets nobody in while AGORA_ADMINS is empty', async () => {
      const saved = process.env.AGORA_ADMINS
      try {
        process.env.AGORA_ADMINS = ''
        expect(await Admins.isAgoraAdmin(guy.id)).to.equal(false)
        const res = await call('overview', { userId: guy.id })
        expect(res.statusCode).to.equal(404)
      } finally {
        process.env.AGORA_ADMINS = saved
      }
    })

    it('asks everyone who is not logged in to log in, for every action', async () => {
      for (const action of Object.keys(AgoraAdminController)) {
        const res = await call(action, { params: anyParams })
        expect(res.statusCode, action).to.equal(401)
        expect(JSON.stringify(res.body || '')).not.to.include('token')
      }
    })

    for (const [who, pick] of [['a member', () => amara], ['a deactivated admin', () => sleeping], ['an admin whose listed email is not confirmed', () => unconfirmed], ['a Help desk admin', () => helpOnly]]) {
      it(`tells ${who} that the page does not exist, for every action`, async () => {
        for (const action of ACTIONS_EXCEPT_ME) {
          const res = await call(action, { userId: pick().id, params: anyParams, body: { email: 'x@agora.test' } })
          expect(res.statusCode, action).to.equal(404)
          expect(res.body, action).to.deep.equal({ error: 'This page does not exist.' })
        }
        const me = await call('me', { userId: pick().id })
        expect(me.body).to.deep.equal({ isAdmin: false, helpDesk: pick() === helpOnly })
      })
    }

    it('changed nothing for those people', async () => {
      const row = await knex()('group_invites').where({ id: waiting.id }).first()
      expect(row.expired_by_id).to.equal(null)
      expect(Number(row.sent_count)).to.equal(0)
      expect((await knex()('users').where({ id: guy.id }).first()).active).to.equal(true)
      expect(await knex()('users').where({ email: 'x@agora.test' }).first()).to.equal(undefined)
    })

    it('refuses every request that does not come from the page itself, also reading', async () => {
      for (const action of Object.keys(AgoraAdminController)) {
        const res = await call(action, { userId: guy.id, fromPage: false, params: anyParams })
        expect(res.statusCode, action).to.equal(400)
      }
    })

    it('tells an admin they are one', async () => {
      const res = await call('me', { userId: guy.id })
      expect(res.body).to.deep.equal({ isAdmin: true, helpDesk: true })
    })
  })

  describe('overview', () => {
    it('counts members, sign-ups, circles, active people, invitations, join and help requests, and meetings', async () => {
      const res = await call('overview', { userId: guy.id })
      const o = res.body
      expect(o.members).to.equal(5) // guy, amara, lars, unconfirmed, helper
      expect(o.signups.last7).to.equal(4)
      expect(o.signups.last30).to.equal(4)
      expect(o.circles).to.equal(2)
      expect(o.activeLast7).to.equal(1)
      expect(o.pendingInvitations).to.equal(1) // not the one in the deleted circle
      expect(o.joinRequests).to.equal(1)
      expect(o.helpRequests).to.equal(1)
      expect(o.help.byStatus).to.deep.equal({ new: 1, fixed: 1 })
      expect(o.help.newest.map(r => r.title)).to.deep.equal(['Save fails'])
      expect(o.help.newest[0].from).to.equal('Amara Okafor')
      expect(o.meetings.held).to.equal(1)
      expect(o.meetings.transcribedMinutes).to.equal(2) // 90 s done + 30 s empty, not the failed one
      expect(o.meetings.estimatedCost).to.equal(0.01)
      expect(o.email).to.deep.equal({ transport: 'log', sends: false })
    })
  })

  describe('invitations', () => {
    it('lists every invitation with what became of it, and a link only for the waiting one', async () => {
      const res = await call('invitations', { userId: guy.id })
      const list = res.body.invitations
      expect(res.body.total).to.equal(4)
      const byEmail = Object.fromEntries(list.map(i => [i.email, i]))
      expect(byEmail['new@agora.test'].status).to.equal('waiting')
      expect(byEmail['new@agora.test'].link).to.include(waiting.get('token'))
      expect(byEmail['new@agora.test'].invitedBy.name).to.equal('Guy')
      expect(byEmail['new@agora.test'].circle.name).to.equal('Governance')
      expect(byEmail['amara@agora.test'].status).to.equal('accepted')
      expect(byEmail['amara@agora.test'].usedBy.name).to.equal('Amara Okafor')
      expect(byEmail['amara@agora.test'].usedAt).to.be.a('string')
      expect(byEmail['amara@agora.test'].link).to.equal(null)
      expect(byEmail['nope@agora.test'].status).to.equal('revoked')
      expect(byEmail['nope@agora.test'].link).to.equal(null)
      expect(byEmail['late@agora.test'].status).to.equal('revoked')
      expect(byEmail['late@agora.test'].circle.deleted).to.equal(true)
      expect(JSON.stringify(res.body)).not.to.include(accepted.get('token'))
      expect(res.body.circles.map(c => c.name)).to.deep.equal(['Governance', 'Media'])
    })

    it('filters by status and by circle', async () => {
      const w = await call('invitations', { userId: guy.id, query: { status: 'waiting' } })
      expect(w.body.invitations.map(i => i.email)).to.deep.equal(['new@agora.test'])
      const r = await call('invitations', { userId: guy.id, query: { status: 'revoked' } })
      expect(r.body.invitations.map(i => i.email).sort()).to.deep.equal(['late@agora.test', 'nope@agora.test'])
      const c = await call('invitations', { userId: guy.id, query: { circle: String(goneCircle.id) } })
      expect(c.body.invitations.map(i => i.email)).to.deep.equal(['late@agora.test'])
      const bad = await call('invitations', { userId: guy.id, query: { status: 'everything' } })
      expect(bad.statusCode).to.equal(400)
    })

    it('sends a waiting invitation again through Hylo, and says email only goes to the log', async () => {
      const res = await call('resendInvitation', { userId: guy.id, params: { invitationId: String(waiting.id) } })
      expect(res.body).to.deep.equal({ ok: true, email: { transport: 'log', sends: false } })
      const row = await knex()('group_invites').where({ id: waiting.id }).first()
      expect(Number(row.sent_count)).to.equal(1)
      expect(row.last_sent_at).to.not.equal(null)
    })

    it('does not resend or revoke an invitation that was used or withdrawn', async () => {
      for (const action of ['resendInvitation', 'revokeInvitation']) {
        expect((await call(action, { userId: guy.id, params: { invitationId: String(accepted.id) } })).statusCode).to.equal(409)
        expect((await call(action, { userId: guy.id, params: { invitationId: String(revoked.id) } })).statusCode).to.equal(409)
        expect((await call(action, { userId: guy.id, params: { invitationId: '999999' } })).statusCode).to.equal(404)
        expect((await call(action, { userId: guy.id, params: { invitationId: 'abc' } })).statusCode).to.equal(404)
      }
    })

    it('withdraws a waiting invitation', async () => {
      const extra = await Invitation.create({ userId: guy.id, groupId: circle.id, email: 'later@agora.test' })
      const res = await call('revokeInvitation', { userId: guy.id, params: { invitationId: String(extra.id) } })
      expect(res.body).to.deep.equal({ ok: true })
      const row = await knex()('group_invites').where({ id: extra.id }).first()
      expect(String(row.expired_by_id)).to.equal(String(guy.id))
    })

    it('shows each circle with its join link and the join requests that wait', async () => {
      const res = await call('joins', { userId: guy.id })
      const governance = res.body.circles.find(c => c.name === 'Governance')
      expect(governance.joinLink).to.match(/\/groups\/governance\/join\/join-governance$/)
      expect(governance.members).to.equal(3) // guy, lars, amara
      expect(governance.joinedWithoutInvitation).to.equal(2) // guy and lars were added directly
      expect(res.body.circles.find(c => c.name === 'Media').joinLink).to.equal(null)
      expect(res.body.circles.find(c => c.name === 'Old')).to.equal(undefined)
      expect(res.body.joinRequests).to.have.length(1)
      expect(res.body.joinRequests[0].person.name).to.equal('Helper')
    })
  })

  describe('accounts', () => {
    it('lists people with their circles, last activity, confirmed email and state', async () => {
      const res = await call('accounts', { userId: guy.id })
      const byName = Object.fromEntries(res.body.accounts.map(a => [a.name, a]))
      expect(byName.Lars.circles.map(c => c.name)).to.deep.equal(['Governance'])
      expect(byName['Amara Okafor'].lastActiveAt).to.be.a('string')
      expect(byName['Not confirmed'].emailConfirmed).to.equal(false)
      expect(byName.Gone.state).to.equal('unfinished') // never had a password, see below
      expect(byName.Guy.isAgoraAdmin).to.equal(true)
      expect(byName.Guy.isMe).to.equal(true)
      expect(byName['Not confirmed'].isAgoraAdmin).to.equal(false)
      const search = await call('accounts', { userId: guy.id, query: { search: 'amara' } })
      expect(search.body.accounts.map(a => a.name)).to.deep.equal(['Amara Okafor'])
      const wild = await call('accounts', { userId: guy.id, query: { search: '%' } })
      expect(wild.body.accounts).to.have.length(0)
    })

    it('lets someone in without a circle with the same sign-up link as the script', async () => {
      const res = await call('letIn', { userId: guy.id, body: { email: ' Newcomer@Agora.test ' } })
      expect(res.body.kind).to.equal('signup')
      expect(res.body.email).to.equal('newcomer@agora.test')
      expect(res.body.link).to.match(/\/signup\/verify-email\?email=newcomer%40agora\.test&token=/)
      expect(res.body.emailStatus.sends).to.equal(false)
      const user = await knex()('users').where({ email: 'newcomer@agora.test' }).first()
      expect(user.active).to.equal(false)
      expect(await knex()('user_verification_codes').where({ email: 'newcomer@agora.test' }).first()).to.not.equal(undefined)
    })

    it('says so when the person already has an account, and refuses what is not an email address', async () => {
      const has = await call('letIn', { userId: guy.id, body: { email: 'lars@agora.test' } })
      expect(has.body).to.include({ kind: 'has_account', link: null })
      const bad = await call('letIn', { userId: guy.id, body: { email: 'not an address' } })
      expect(bad.statusCode).to.equal(400)
    })

    it('lets someone in with a circle as a circle invitation, and gives its link', async () => {
      const res = await call('letIn', { userId: guy.id, body: { email: 'joiner@agora.test', circle: String(otherCircle.id) } })
      expect(res.body.kind).to.equal('invitation')
      expect(res.body.circle.name).to.equal('Media')
      const row = await knex()('group_invites').where({ email: 'joiner@agora.test' }).first()
      expect(String(row.group_id)).to.equal(String(otherCircle.id))
      expect(String(row.invited_by_id)).to.equal(String(guy.id))
      expect(res.body.link).to.include(row.token)
      const member = await call('letIn', { userId: guy.id, body: { email: 'lars@agora.test', circle: String(circle.id) } })
      expect(member.statusCode).to.equal(409)
      const gone = await call('letIn', { userId: guy.id, body: { email: 'x@agora.test', circle: String(goneCircle.id) } })
      expect(gone.statusCode).to.equal(404)
    })

    it('switches an account off and on again, never itself, and never deletes', async () => {
      await knex()('linked_account').insert({ user_id: lars.id, provider_key: 'password', provider_user_id: '$2a$10$fake' })
      const self = await call('deactivate', { userId: guy.id, params: { accountId: String(guy.id) } })
      expect(self.statusCode).to.equal(409)

      const off = await call('deactivate', { userId: guy.id, params: { accountId: String(lars.id) } })
      expect(off.body).to.deep.equal({ ok: true })
      expect((await knex()('users').where({ id: lars.id }).first()).active).to.equal(false)
      expect((await call('deactivate', { userId: guy.id, params: { accountId: String(lars.id) } })).statusCode).to.equal(409)
      const listed = await call('accounts', { userId: guy.id, query: { state: 'deactivated' } })
      expect(listed.body.accounts.map(a => a.name)).to.deep.equal(['Lars'])

      const on = await call('reactivate', { userId: guy.id, params: { accountId: String(lars.id) } })
      expect(on.body).to.deep.equal({ ok: true })
      expect((await knex()('users').where({ id: lars.id }).first()).active).to.equal(true)

      // An unfinished sign-up is not an account to switch on
      const unfinished = await call('reactivate', { userId: guy.id, params: { accountId: String(sleeping.id) } })
      expect(unfinished.statusCode).to.equal(409)
      expect((await call('deactivate', { userId: guy.id, params: { accountId: '999999' } })).statusCode).to.equal(404)
    })
  })

  describe('system', () => {
    it('says which services are set up without ever showing a key', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-for-test'
      process.env.AGORA_TRANSCRIPTION_KEY = 'stt-secret-for-test'
      process.env.AGORA_SMTP_PASSWORD = 'smtp-secret-for-test'
      process.env.AGORA_BACKUP_DIR = '/nonexistent/agora-backups'
      try {
        const res = await call('system', { userId: guy.id })
        const s = res.body
        expect(s.version).to.equal('abc1234')
        expect(s.serverUptimeSeconds).to.be.a('number')
        expect(s.services.claude).to.equal(true)
        expect(s.services.email).to.deep.equal({ transport: 'log', sends: false })
        expect(s.services).to.have.property('speechToText')
        expect(s.services).to.have.property('googleDrive')
        expect(s.backups.nightly).to.equal(null) // not readable here: "check on the server"
        const text = JSON.stringify(s)
        for (const secret of ['sk-ant-secret-for-test', 'stt-secret-for-test', 'smtp-secret-for-test']) expect(text).not.to.include(secret)
        if (process.env.DATABASE_URL) expect(text).not.to.include(process.env.DATABASE_URL)
        if (process.env.JWT_SECRET) expect(text).not.to.include(process.env.JWT_SECRET)
      } finally {
        delete process.env.ANTHROPIC_API_KEY
        delete process.env.AGORA_TRANSCRIPTION_KEY
        delete process.env.AGORA_SMTP_PASSWORD
        delete process.env.AGORA_BACKUP_DIR
      }
    })

    it('tells real sending from the log', () => {
      process.env.AGORA_EMAIL_TRANSPORT = 'brevo'
      try {
        expect(Dashboard.emailStatus()).to.deep.equal({ transport: 'brevo', sends: false })
      } finally {
        delete process.env.AGORA_EMAIL_TRANSPORT
      }
    })
  })

  describe('activity', () => {
    it('lists the latest events, newest first, with names', async () => {
      const res = await call('activity', { userId: guy.id })
      const kinds = res.body.events.map(e => e.kind)
      for (const kind of ['signup', 'invited', 'invitation_accepted', 'invitation_revoked', 'circle_created', 'joined', 'join_request', 'meeting_ended', 'help_request']) {
        expect(kinds, kind).to.include(kind)
      }
      const times = res.body.events.map(e => new Date(e.at).getTime())
      expect(times).to.deep.equal([...times].sort((a, b) => b - a))
      const meeting = res.body.events.find(e => e.kind === 'meeting_ended')
      expect(meeting.meeting.title).to.equal('Weekly call')
      expect(JSON.stringify(res.body)).not.to.include(waiting.get('token'))
      const page2 = await call('activity', { userId: guy.id, query: { page: '2' } })
      expect(page2.body.page).to.equal(2)
    })
  })
})
