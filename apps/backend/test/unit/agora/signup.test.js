/* eslint-env mocha */
/**
 * Agora: sign-up by invitation only (lib/agora/signup.js).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/signup.test.js
 */
import AgoraSignup from '../../../lib/agora/signup'
import AgoraSignupController from '../../../api/controllers/AgoraSignupController'
import { sendEmailVerification } from '../../../api/graphql/mutations/user'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const SessionController = require(rootPath('api/controllers/SessionController'))

// The bcrypt hash of the word "password", as in SessionController.test.js
const PASSWORD_HASH = '$2a$10$UPh85nJvMSrm6gMPqYIS.OPhLjAMbZiFnlpjq1xrtoSBTyV6fMdJS'

describe('Agora sign-up by invitation only', () => {
  let steward, circle, closedCircle, originalSetting, originalEnv, originalClassMethod, queued

  const findByEmail = email => User.query(q => q.whereRaw('lower(email) = ?', email)).fetch()
  const signUp = (email, held = {}) => sendEmailVerification(null, { email, ...held }, { req: { ip: '127.0.0.9' } })
  const emailsTo = email => queued.filter(j => j.method === 'sendEmailVerification' && j.data.email === email)

  async function invitation (attrs = {}) {
    return Invitation.create({ email: 'someone@agora.test', userId: steward.id, groupId: circle.id, ...attrs })
  }

  before(async () => {
    originalSetting = process.env.AGORA_INVITE_ONLY
    originalEnv = process.env.NODE_ENV
    await setup.clearDb()
    steward = await factories.user({ email: 'steward@agora.test' }).save()
    circle = await factories.group({ name: 'Governance', slug: 'governance', access_code: 'join-governance' }).save()
    closedCircle = await factories.group({ name: 'Gone', slug: 'gone', access_code: 'join-gone', active: false }).save()
    originalClassMethod = Queue.classMethod
  })

  beforeEach(() => {
    process.env.AGORA_INVITE_ONLY = 'on'
    queued = []
    Queue.classMethod = (model, method, data) => { queued.push({ model, method, data }); return Promise.resolve() }
  })

  afterEach(() => {
    Queue.classMethod = originalClassMethod
  })

  after(() => {
    if (originalSetting === undefined) delete process.env.AGORA_INVITE_ONLY
    else process.env.AGORA_INVITE_ONLY = originalSetting
    process.env.NODE_ENV = originalEnv
  })

  describe('the setting', () => {
    afterEach(() => { process.env.NODE_ENV = originalEnv })

    it('is on or off as AGORA_INVITE_ONLY says', () => {
      for (const value of ['on', 'true', '1', 'ON ']) {
        process.env.AGORA_INVITE_ONLY = value
        expect(AgoraSignup.isInviteOnly()).to.equal(true)
      }
      for (const value of ['off', 'false', '0']) {
        process.env.AGORA_INVITE_ONLY = value
        expect(AgoraSignup.isInviteOnly()).to.equal(false)
      }
    })

    it('when not set, is on for a server and off elsewhere', () => {
      delete process.env.AGORA_INVITE_ONLY
      process.env.NODE_ENV = 'production'
      expect(AgoraSignup.isInviteOnly()).to.equal(true)
      process.env.NODE_ENV = 'development'
      expect(AgoraSignup.isInviteOnly()).to.equal(false)
      process.env.NODE_ENV = 'test'
      expect(AgoraSignup.isInviteOnly()).to.equal(false)
    })

    it('is told to the sign-up page', async () => {
      const res = factories.mock.response()
      res.set = () => {}
      AgoraSignupController.policy(factories.mock.request(), res)
      expect(res.body).to.deep.equal({ inviteOnly: true })
      process.env.AGORA_INVITE_ONLY = 'off'
      AgoraSignupController.policy(factories.mock.request(), res)
      expect(res.body).to.deep.equal({ inviteOnly: false })
    })
  })

  describe('signing up with an email address', () => {
    it('makes no account and sends no email without an invitation', async () => {
      const result = await signUp('stranger@agora.test')
      // The same answer as for an address that has an account, so it does not tell who has one
      expect(result).to.deep.equal({ success: true })
      expect(await findByEmail('stranger@agora.test')).to.equal(null)
      expect(emailsTo('stranger@agora.test')).to.have.length(0)
    })

    it('makes an account with a valid invitation email', async () => {
      const invite = await invitation({ email: 'invited@agora.test' })
      const result = await signUp('invited@agora.test', { invitationToken: invite.get('token') })
      expect(result).to.deep.equal({ success: true })
      const user = await findByEmail('invited@agora.test')
      expect(user).to.not.equal(null)
      expect(user.get('active')).to.equal(false) // not finished until they choose a name and password
      expect(emailsTo('invited@agora.test')).to.have.length(1)
    })

    it('makes an account with a valid join link', async () => {
      const result = await signUp('joiner@agora.test', { accessCode: 'JOIN-governance' })
      expect(result).to.deep.equal({ success: true })
      expect(await findByEmail('joiner@agora.test')).to.not.equal(null)
      expect(emailsTo('joiner@agora.test')).to.have.length(1)
    })

    it('refuses an invitation email used for another address, and makes no account for it', async () => {
      const invite = await invitation({ email: 'bea@agora.test' })
      for (const other of ['m1@agora.test', 'm2@agora.test']) {
        expect(await signUp(other, { invitationToken: invite.get('token') }))
          .to.deep.equal({ success: false, error: 'invite-expired' })
        expect(await findByEmail(other)).to.equal(null)
        expect(emailsTo(other)).to.have.length(0)
      }
      // The invited person can still use it
      expect(await signUp('bea@agora.test', { invitationToken: invite.get('token') })).to.deep.equal({ success: true })
      expect(await findByEmail('bea@agora.test')).to.not.equal(null)
    })

    it('accepts the invited address written with capitals or spaces', async () => {
      const invite = await invitation({ email: 'Carla.Case@Agora.test' })
      expect(await signUp('  CARLA.case@agora.TEST ', { invitationToken: invite.get('token') })).to.deep.equal({ success: true })
      expect(await findByEmail('carla.case@agora.test')).to.not.equal(null)
    })

    it('lets anyone with a join link sign up, with any address', async () => {
      for (const email of ['link1@agora.test', 'link2@agora.test']) {
        expect(await signUp(email, { accessCode: 'join-governance' })).to.deep.equal({ success: true })
        expect(await findByEmail(email)).to.not.equal(null)
      }
    })

    it('refuses an invitation that was already used', async () => {
      const invite = await invitation({ email: 'used@agora.test' })
      await invite.save({ used_by_id: steward.id, used_at: new Date() }, { patch: true })
      const result = await signUp('used@agora.test', { invitationToken: invite.get('token') })
      expect(result).to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await findByEmail('used@agora.test')).to.equal(null)
      expect(emailsTo('used@agora.test')).to.have.length(0)
    })

    it('refuses an invitation that was withdrawn', async () => {
      const invite = await invitation({ email: 'withdrawn@agora.test' })
      await invite.expire(steward.id)
      const result = await signUp('withdrawn@agora.test', { invitationToken: invite.get('token') })
      expect(result).to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await findByEmail('withdrawn@agora.test')).to.equal(null)
    })

    it('refuses an unknown invitation or join link', async () => {
      expect(await signUp('guess1@agora.test', { invitationToken: 'not-a-real-token' }))
        .to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await signUp('guess2@agora.test', { accessCode: 'not-a-real-code' }))
        .to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await findByEmail('guess1@agora.test')).to.equal(null)
      expect(await findByEmail('guess2@agora.test')).to.equal(null)
    })

    it('refuses the join link and invitations of a deleted circle', async () => {
      const invite = await invitation({ email: 'late@agora.test', groupId: closedCircle.id })
      expect(await signUp('late1@agora.test', { accessCode: 'join-gone' }))
        .to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await signUp('late@agora.test', { invitationToken: invite.get('token') }))
        .to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await findByEmail('late1@agora.test')).to.equal(null)
      expect(await findByEmail('late@agora.test')).to.equal(null)
    })

    it('still sends a code to an address that already has an account, as Hylo does', async () => {
      await factories.user({ email: 'member@agora.test' }).save()
      const before = await User.query(q => q.whereRaw('lower(email) = ?', 'member@agora.test')).count()
      expect(await signUp('member@agora.test')).to.deep.equal({ success: true })
      const after = await User.query(q => q.whereRaw('lower(email) = ?', 'member@agora.test')).count()
      expect(Number(after)).to.equal(Number(before))
      expect(emailsTo('member@agora.test')).to.have.length(1)
    })

    it('lets anyone sign up when the setting is off, as in Hylo', async () => {
      process.env.AGORA_INVITE_ONLY = 'off'
      expect(await signUp('open@agora.test')).to.deep.equal({ success: true })
      expect(await findByEmail('open@agora.test')).to.not.equal(null)
      expect(emailsTo('open@agora.test')).to.have.length(1)
    })
  })

  describe('a first login with Apple, Google and the like', () => {
    const appleSigninAuth = require('apple-signin-auth').default
    let originalVerify

    before(() => { originalVerify = appleSigninAuth.verifyIdToken })
    after(() => { appleSigninAuth.verifyIdToken = originalVerify })

    async function appleLogin (email, params = {}) {
      appleSigninAuth.verifyIdToken = async () => ({ sub: `apple-${email}`, email, email_verified: 'true' })
      const req = factories.mock.request()
      req.params = params
      req.body = { user: `apple-${email}`, identityToken: 'token', fullName: { givenName: 'New', familyName: 'Person' } }
      req.get = () => undefined
      const res = factories.mock.response()
      await SessionController.finishAppleOAuth(req, res)
      return { req, res }
    }

    it('makes no account without an invitation', async () => {
      const { req, res } = await appleLogin('apple-stranger@agora.test')
      expect(res.statusCode).to.equal(422)
      expect(res.body).to.equal('agora-invite-only')
      expect(req.session.userId).to.equal(undefined)
      expect(await findByEmail('apple-stranger@agora.test')).to.equal(null)
    })

    it('makes an account with a valid join link', async () => {
      const { req, res } = await appleLogin('apple-joiner@agora.test', { accessCode: 'join-governance' })
      expect(res.ok).to.have.been.called()
      const user = await findByEmail('apple-joiner@agora.test')
      expect(user).to.not.equal(null)
      expect(req.session.userId).to.equal(user.id)
    })

    it('makes an account with an invitation email for the address it was sent to', async () => {
      const invite = await invitation({ email: 'apple-invited@agora.test' })
      const { req, res } = await appleLogin('apple-invited@agora.test', { invitationToken: invite.get('token') })
      expect(res.ok).to.have.been.called()
      const user = await findByEmail('apple-invited@agora.test')
      expect(user).to.not.equal(null)
      expect(req.session.userId).to.equal(user.id)
    })

    it('makes no account with an invitation email sent to another address', async () => {
      const invite = await invitation({ email: 'apple-someone-else@agora.test' })
      const { res } = await appleLogin('apple-forwarded@agora.test', { invitationToken: invite.get('token') })
      expect(res.statusCode).to.equal(422)
      expect(res.body).to.equal('agora-invite-only')
      expect(await findByEmail('apple-forwarded@agora.test')).to.equal(null)
    })

    it('never takes an invitation from the session (the web app sends none with a Google login)', async () => {
      const invite = await invitation({ email: 'google-invited@agora.test' })
      const req = factories.mock.request()
      req.session.agoraInvitation = { invitationToken: invite.get('token') }
      expect(AgoraSignup.hasInvitation(AgoraSignup.invitationFromRequest(req))).to.equal(false)
      expect(await AgoraSignup.mayCreateAccount(AgoraSignup.invitationFromRequest(req), 'google-invited@agora.test')).to.equal(false)
    })

    it('logs in someone who already has an account', async () => {
      const member = await factories.user({ email: 'apple-member@agora.test' }).save()
      const { req, res } = await appleLogin('apple-member@agora.test')
      expect(res.ok).to.have.been.called()
      expect(req.session.userId).to.equal(member.id)
    })

    it('makes an account without an invitation when the setting is off', async () => {
      process.env.AGORA_INVITE_ONLY = 'off'
      const { res } = await appleLogin('apple-open@agora.test')
      expect(res.ok).to.have.been.called()
      expect(await findByEmail('apple-open@agora.test')).to.not.equal(null)
    })
  })

  describe('logging in with a password', () => {
    it('works as before for someone who has an account', async () => {
      const cat = await new User({ name: 'Cat', email: 'cat@agora.test', active: true }).save()
      await new LinkedAccount({ provider_user_id: PASSWORD_HASH, provider_key: 'password', user_id: cat.id }).save()
      const req = factories.mock.request()
      req.params = { email: 'cat@agora.test', password: 'password' }
      const res = factories.mock.response()
      await SessionController.create(req, res)
      expect(res.ok).to.have.been.called()
      expect(req.session.userId).to.equal(cat.id)
    })
  })
})
