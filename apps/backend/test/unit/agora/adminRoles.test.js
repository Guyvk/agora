/* eslint-env mocha */
/**
 * Agora: roles given in the admin area (lib/agora/admins.js, the table
 * agora_roles, and AgoraAdminController.setRole).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/adminRoles.test.js
 */
import AgoraAdminController from '../../../api/controllers/AgoraAdminController'
import Admins from '../../../lib/agora/admins'
import Dashboard from '../../../lib/agora/adminDashboard'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const ENV_NAMES = ['AGORA_ADMINS', 'AGORA_HELPDESK_ADMINS', 'AGORA_EMAIL_TRANSPORT', 'SENDWITHUS_KEY']
const SAVED_ENV = {}

describe('Agora roles from the admin area', () => {
  let guy, david, amara, lars, sleeping, serverHelper, serverByEmail
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

  const setRole = (userId, account, role) => call('setRole', { userId: userId.id || userId, params: { accountId: String(account.id || account) }, body: { role } })
  const roleRow = async user => knex()('agora_roles').where({ user_id: user.id }).first()
  const changes = async () => knex()('agora_role_changes').orderBy('id')

  before(async () => {
    for (const name of ENV_NAMES) { SAVED_ENV[name] = process.env[name]; delete process.env[name] }
    await setup.clearDb()
    const person = (name, email, attrs = {}) => new User({ name, email, active: true, email_validated: true, created_at: new Date(), ...attrs }).save()
    guy = await person('Guy', 'guy@agora.test')
    david = await person('David', 'david@agora.test')
    amara = await person('Amara', 'amara@agora.test')
    lars = await person('Lars', 'lars@agora.test')
    sleeping = await person('Gone', 'gone@agora.test', { active: false })
    serverHelper = await person('Helper', 'helper@agora.test')
    serverByEmail = await person('Mailed', 'mailed@agora.test')
    process.env.AGORA_ADMINS = `${guy.id}, MAILED@agora.test`
    process.env.AGORA_HELPDESK_ADMINS = String(serverHelper.id)
  })

  after(() => {
    for (const name of ENV_NAMES) {
      if (SAVED_ENV[name] === undefined) delete process.env[name]
      else process.env[name] = SAVED_ENV[name]
    }
  })

  describe('admins.js', () => {
    it('knows nobody from the table while it is empty, and the settings still work', async () => {
      expect(await Admins.isAgoraAdmin(guy.id)).to.equal(true)
      expect(await Admins.isAgoraAdmin(serverByEmail.id)).to.equal(true)
      expect(await Admins.isAgoraAdmin(david.id)).to.equal(false)
      expect(await Admins.isHelpDeskAdmin(serverHelper.id)).to.equal(true)
      expect(await Admins.isHelpDeskAdmin(david.id)).to.equal(false)
      expect(Admins.serverRoleOf({ id: guy.id })).to.equal('admin')
      expect(Admins.serverRoleOf({ id: serverHelper.id })).to.equal('helpdesk')
      expect(Admins.serverRoleOf({ id: serverByEmail.id, email: 'mailed@agora.test', email_validated: true })).to.equal('admin')
      expect(Admins.serverRoleOf({ id: serverByEmail.id, email: 'mailed@agora.test', email_validated: false })).to.equal(null)
      expect(Admins.serverRoleOf({ id: david.id, email: 'david@agora.test', email_validated: true })).to.equal(null)
    })

    it('makes someone with the role admin an Agora admin and a Help desk admin', async () => {
      const change = await Admins.changeRole(guy.id, david.id, 'admin')
      expect(change).to.deep.include({ from: 'member', to: 'admin' })
      expect(await Admins.isAgoraAdmin(david.id)).to.equal(true)
      expect(await Admins.isHelpDeskAdmin(david.id)).to.equal(true)
      const row = await roleRow(david)
      expect(row.role).to.equal('admin')
      expect(String(row.granted_by_id)).to.equal(String(guy.id))
      expect(row.created_at).to.be.a('date')
    })

    it('makes someone with the role helpdesk only a Help desk admin', async () => {
      await Admins.changeRole(guy.id, amara.id, 'helpdesk')
      expect(await Admins.isAgoraAdmin(amara.id)).to.equal(false)
      expect(await Admins.isHelpDeskAdmin(amara.id)).to.equal(true)
    })

    it('counts no role of a switched off account, and gives none to it', async () => {
      await knex()('agora_roles').insert({ user_id: sleeping.id, role: 'admin', granted_by_id: guy.id, created_at: new Date() })
      expect(await Admins.isAgoraAdmin(sleeping.id)).to.equal(false)
      expect(await Admins.isHelpDeskAdmin(sleeping.id)).to.equal(false)
      await knex()('agora_roles').where({ user_id: sleeping.id }).del()
      await expect(Admins.changeRole(guy.id, sleeping.id, 'helpdesk')).to.be.rejectedWith(Admins.RoleError, 'switched on')
      expect(await roleRow(sleeping)).to.equal(undefined)
    })

    it('refuses anyone who is not an Agora admin, also a Help desk admin', async () => {
      for (const who of [lars, amara, serverHelper, sleeping]) {
        const err = await Admins.changeRole(who.id, lars.id, 'admin').catch(e => e)
        expect(err).to.be.instanceOf(Admins.RoleError)
        expect(err.status).to.equal(404)
      }
      expect(await roleRow(lars)).to.equal(undefined)
    })

    it('refuses to let anyone change their own role, so nobody lowers their own admin role', async () => {
      for (const role of ['member', 'helpdesk', 'admin']) {
        const err = await Admins.changeRole(david.id, david.id, role).catch(e => e)
        expect(err.status, role).to.equal(409)
      }
      expect((await roleRow(david)).role).to.equal('admin')
    })

    it('refuses to change people named in the server settings', async () => {
      for (const who of [guy, serverHelper, serverByEmail]) {
        const err = await Admins.changeRole(david.id, who.id, 'member').catch(e => e)
        expect(err.status).to.equal(409)
        expect(err.message).to.include('set on the server')
      }
      expect(await Admins.isAgoraAdmin(guy.id)).to.equal(true)
    })

    it('refuses a role that does not exist, an account that does not exist, and no change', async () => {
      expect((await Admins.changeRole(guy.id, lars.id, 'owner').catch(e => e)).status).to.equal(400)
      expect((await Admins.changeRole(guy.id, '999999', 'admin').catch(e => e)).status).to.equal(404)
      expect((await Admins.changeRole(guy.id, '1 or 1=1', 'admin').catch(e => e)).status).to.equal(404)
      expect((await Admins.changeRole(guy.id, lars.id, 'member').catch(e => e)).status).to.equal(409)
    })

    it('writes every change, and only real changes, to the log', async () => {
      const rows = await changes()
      expect(rows.map(r => [String(r.user_id), String(r.changed_by_id), r.from_role, r.to_role])).to.deep.equal([
        [String(david.id), String(guy.id), 'member', 'admin'],
        [String(amara.id), String(guy.id), 'member', 'helpdesk']
      ])
    })

    it('lets an admin from the table lower another admin from the table, and take a role away', async () => {
      await Admins.changeRole(guy.id, lars.id, 'admin')
      await Admins.changeRole(david.id, lars.id, 'helpdesk')
      expect(await Admins.isAgoraAdmin(lars.id)).to.equal(false)
      expect(await Admins.isHelpDeskAdmin(lars.id)).to.equal(true)
      await Admins.changeRole(david.id, lars.id, 'member')
      expect(await roleRow(lars)).to.equal(undefined)
      expect(await Admins.isHelpDeskAdmin(lars.id)).to.equal(false)
    })
  })

  describe('the admin area', () => {
    it('shows each role on the Accounts tab, and which ones are set on the server', async () => {
      const res = await call('accounts', { userId: guy.id })
      const byName = Object.fromEntries(res.body.accounts.map(a => [a.name, a]))
      expect(byName.Guy).to.include({ role: 'admin', roleSetOnServer: true, isAgoraAdmin: true, isMe: true })
      expect(byName.Mailed).to.include({ role: 'admin', roleSetOnServer: true })
      expect(byName.Helper).to.include({ role: 'helpdesk', roleSetOnServer: true, isAgoraAdmin: false })
      expect(byName.David).to.include({ role: 'admin', roleSetOnServer: false, isAgoraAdmin: true })
      expect(byName.Amara).to.include({ role: 'helpdesk', roleSetOnServer: false, isAgoraAdmin: false })
      expect(byName.Lars).to.include({ role: 'member', roleSetOnServer: false, isAgoraAdmin: false })
    })

    it('lets an admin from the table open the whole admin area', async () => {
      expect((await call('me', { userId: david.id })).body).to.deep.equal({ isAdmin: true, helpDesk: true })
      expect((await call('me', { userId: amara.id })).body).to.deep.equal({ isAdmin: false, helpDesk: true })
      expect((await call('overview', { userId: david.id })).statusCode).to.equal(200)
      expect((await call('overview', { userId: amara.id })).statusCode).to.equal(404)
    })

    it('changes a role through the page, and emails the person', async () => {
      const sent = []
      const result = await Dashboard.setRole(guy.id, String(lars.id), 'admin', { sendEmail: async options => { sent.push(options); return true } })
      expect(result).to.include({ ok: true, from: 'member', role: 'admin', emailed: true })
      expect(sent).to.have.length(1)
      expect(sent[0].email_id).to.equal('agora_role_given')
      expect(sent[0].recipient.address).to.equal('lars@agora.test')
      expect(sent[0].email_data.url).to.match(/\/admin$/)

      const res = await setRole(guy, lars, 'member') // the real email sender, which only writes to the log here
      expect(res.statusCode).to.equal(200)
      expect(res.body).to.include({ ok: true, from: 'admin', role: 'member', emailed: false })
    })

    it('has an email text for both roles', () => {
      const mailer = require('../../../lib/agora/mailer')
      const admin = mailer.TEMPLATES.agora_role_given({ role: 'admin', url: 'https://agora.test/admin' })
      expect(admin.subject).to.equal('You are now an admin of Agora')
      expect(admin.text).to.include('https://agora.test/admin')
      const desk = mailer.TEMPLATES.agora_role_given({ role: 'helpdesk', url: 'https://agora.test/admin/help-desk' })
      expect(desk.subject).to.include('Help desk')
      for (const email of [admin, desk]) expect(email.text + email.subject).not.to.include('—')
    })

    it('answers the page with the same refusals', async () => {
      expect((await setRole(guy, guy, 'member')).statusCode).to.equal(409)
      expect((await setRole(amara, lars, 'admin')).body).to.deep.equal({ error: 'This page does not exist.' })
      expect((await setRole(guy, sleeping, 'admin')).statusCode).to.equal(409)
      expect((await setRole(guy, lars, 'boss')).statusCode).to.equal(400)
      const noHeader = await call('setRole', { userId: guy.id, params: { accountId: String(lars.id) }, body: { role: 'admin' }, fromPage: false })
      expect(noHeader.statusCode).to.equal(400)
      const noLogin = await call('setRole', { params: { accountId: String(lars.id) }, body: { role: 'admin' } })
      expect(noLogin.statusCode).to.equal(401)
      expect(await roleRow(lars)).to.equal(undefined)
    })

    it('shows who changed whose role, from what to what, in the Activity log', async () => {
      const res = await call('activity', { userId: guy.id })
      const roles = res.body.events.filter(e => e.kind === 'role_changed')
      expect(roles.length).to.equal((await changes()).length)
      const davidMade = roles.find(e => e.target && e.target.name === 'David')
      expect(davidMade.person.name).to.equal('Guy')
      expect(davidMade.role).to.deep.equal({ from: 'member', to: 'admin' })
      expect(davidMade.at).to.be.a('string')
    })

    it('still lets the settings work when the table is missing (before yarn migrate)', async () => {
      await knex().raw('alter table agora_roles rename to agora_roles_hidden')
      try {
        expect(await Admins.isAgoraAdmin(guy.id)).to.equal(true)
        expect(await Admins.isAgoraAdmin(david.id)).to.equal(false)
        expect(await Admins.rolesOf([david.id])).to.deep.equal({})
      } finally {
        await knex().raw('alter table agora_roles_hidden rename to agora_roles')
      }
    })
  })
})
