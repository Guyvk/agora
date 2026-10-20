/* eslint-env mocha */
/**
 * Agora: someone who signs up from a circle's join link or an invitation email
 * ends up a member of that circle (lib/agora/signup.js, joinRememberedCircle).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test node node_modules/mocha/bin/mocha \
 *     -r test/setup/core -r @babel/register --exit --timeout 60000 test/unit/agora/joinOnSignup.test.js
 */
import AgoraSignup from '../../../lib/agora/signup'
import { sendEmailVerification, verifyEmail, register } from '../../../api/graphql/mutations/user'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const SessionController = require(rootPath('api/controllers/SessionController'))

describe('Agora: joining the circle of the invitation someone signed up with', () => {
  let steward, circle, originalSetting, originalClassMethod, queued

  const fetchOne = (type, id) => ({ type, id })
  const findByEmail = email => User.query(q => q.whereRaw('lower(email) = ?', email)).fetch()
  const isMember = async (user, group) => {
    const membership = await GroupMembership.forPair(user.id, group.id).fetch()
    return Boolean(membership && membership.get('active'))
  }

  /** The whole sign-up as the web app does it: email, the code from the email, name and password. */
  async function signUpAndFinish (email, held = {}) {
    const sent = await sendEmailVerification(null, { email, ...held }, { req: { ip: '127.0.0.8' } })
    expect(sent).to.deep.equal({ success: true })
    const job = queued.filter(j => j.method === 'sendEmailVerification' && j.data.email === email).pop()
    expect(job, 'a verification email').to.exist
    // The code and the rest may happen in another browser: nothing from the first page is needed
    const req = factories.mock.request()
    const verified = await verifyEmail(fetchOne)(null, { email, code: job.data.templateData.code }, { req })
    expect(verified.error).to.equal(undefined)
    const user = await findByEmail(email)
    const finished = await register(fetchOne)(null, { name: 'New Person', password: 'a-long-password-1' }, { req, currentUserId: user.id })
    expect(finished.error).to.equal(undefined)
    return findByEmail(email)
  }

  before(async () => {
    originalSetting = process.env.AGORA_INVITE_ONLY
    await setup.clearDb()
    steward = await factories.user({ email: 'steward@agora.test' }).save()
    // A circle that only takes people with an invitation, as Agora's circles do
    circle = await factories.group({
      name: 'Governance',
      slug: 'governance',
      access_code: 'join-governance',
      accessibility: Group.Accessibility.RESTRICTED
    }).save()
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
  })

  it('makes someone who signs up from a join link a member of that circle', async () => {
    const user = await signUpAndFinish('mariam@agora.test', { accessCode: 'join-governance' })
    expect(user.get('active')).to.equal(true)
    expect(await isMember(user, circle)).to.equal(true)
    // The invitation is not kept once used
    expect(user.getSetting(AgoraSignup.REMEMBERED_INVITATION)).to.equal(undefined)
    // No join request is needed
    const requests = await JoinRequest.where({ user_id: user.id, group_id: circle.id }).count()
    expect(Number(requests)).to.equal(0)
  })

  it('keeps the invitation with the new account while it is not finished', async () => {
    await sendEmailVerification(null, { email: 'halfway@agora.test', accessCode: 'join-governance' }, { req: { ip: '127.0.0.8' } })
    const user = await findByEmail('halfway@agora.test')
    expect(user.get('active')).to.equal(false)
    expect(user.getSetting(AgoraSignup.REMEMBERED_INVITATION)).to.deep.equal({ accessCode: 'join-governance' })
    expect(await isMember(user, circle)).to.equal(false)
  })

  it('makes someone who signs up from an invitation email a member, and marks the invitation used', async () => {
    const invite = await Invitation.create({ email: 'nana@agora.test', userId: steward.id, groupId: circle.id })
    const user = await signUpAndFinish('nana@agora.test', { invitationToken: invite.get('token') })
    expect(await isMember(user, circle)).to.equal(true)
    await invite.refresh()
    expect(invite.get('used_by_id')).to.equal(user.id)
  })

  it('does not join when the join link was replaced before the account was finished, but still finishes the account', async () => {
    const other = await factories.group({ name: 'Other', slug: 'other', access_code: 'join-other', accessibility: Group.Accessibility.RESTRICTED }).save()
    await sendEmailVerification(null, { email: 'late@agora.test', accessCode: 'join-other' }, { req: { ip: '127.0.0.8' } })
    await other.save({ access_code: 'a-new-code' }, { patch: true })
    const job = queued.filter(j => j.data.email === 'late@agora.test').pop()
    const req = factories.mock.request()
    await verifyEmail(fetchOne)(null, { email: 'late@agora.test', code: job.data.templateData.code }, { req })
    const pending = await findByEmail('late@agora.test')
    const finished = await register(fetchOne)(null, { name: 'Late Person', password: 'a-long-password-1' }, { req, currentUserId: pending.id })
    expect(finished.error).to.equal(undefined)
    const user = await findByEmail('late@agora.test')
    expect(user.get('active')).to.equal(true)
    expect(await isMember(user, other)).to.equal(false)
  })

  it('does not keep an invitation with an account that already exists', async () => {
    const member = await factories.user({ email: 'existing@agora.test', active: true }).save()
    await sendEmailVerification(null, { email: 'existing@agora.test', accessCode: 'join-governance' }, { req: { ip: '127.0.0.8' } })
    await member.refresh()
    expect(member.getSetting(AgoraSignup.REMEMBERED_INVITATION)).to.equal(undefined)
    expect(await isMember(member, circle)).to.equal(false)
  })

  it('also joins when sign-up is open to everyone', async () => {
    process.env.AGORA_INVITE_ONLY = 'off'
    const user = await signUpAndFinish('open-joiner@agora.test', { accessCode: 'join-governance' })
    expect(await isMember(user, circle)).to.equal(true)
  })

  it('finishes a sign-up without an invitation as before when sign-up is open', async () => {
    process.env.AGORA_INVITE_ONLY = 'off'
    const user = await signUpAndFinish('plain@agora.test')
    expect(user.get('active')).to.equal(true)
    expect(await isMember(user, circle)).to.equal(false)
  })

  it('makes someone who logs in with Apple for the first time from a join link a member', async () => {
    const appleSigninAuth = require('apple-signin-auth').default
    const originalVerify = appleSigninAuth.verifyIdToken
    try {
      const email = 'apple-joiner@agora.test'
      appleSigninAuth.verifyIdToken = async () => ({ sub: `apple-${email}`, email, email_verified: 'true' })
      const req = factories.mock.request()
      req.params = { accessCode: 'join-governance' }
      req.body = { user: `apple-${email}`, identityToken: 'token', fullName: { givenName: 'New', familyName: 'Person' } }
      req.get = () => undefined
      const res = factories.mock.response()
      await SessionController.finishAppleOAuth(req, res)
      expect(res.ok).to.have.been.called()
      const user = await findByEmail(email)
      expect(await isMember(user, circle)).to.equal(true)
    } finally {
      appleSigninAuth.verifyIdToken = originalVerify
    }
  })

  it('never fails or joins with an unknown invitation', async () => {
    const user = await factories.user({ email: 'someone@agora.test', active: true }).save()
    expect(await AgoraSignup.joinInvitedCircle(user, { accessCode: 'not-a-code' })).to.equal(null)
    expect(await AgoraSignup.joinInvitedCircle(user, { invitationToken: 'not-a-token' })).to.equal(null)
    expect(await AgoraSignup.joinInvitedCircle(user, {})).to.equal(null)
    expect(await isMember(user, circle)).to.equal(false)
  })
})
