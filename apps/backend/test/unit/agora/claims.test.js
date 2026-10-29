/* eslint-env mocha */
/**
 * Agora: profiles people can claim later (lib/agora/claims.js), the claim
 * links on the Contacts page, and signing up with a claim link.
 * All names here are made up.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/claims.test.js
 */
import AgoraContactsController from '../../../api/controllers/AgoraContactsController'
import AgoraClaimController from '../../../api/controllers/AgoraClaimController'
import Claims from '../../../lib/agora/claims'
import AgoraSignup from '../../../lib/agora/signup'
import { sendEmailVerification } from '../../../api/graphql/mutations/user'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const InvitationService = require(rootPath('api/services/InvitationService'))

describe('Agora profiles people can claim later', () => {
  let steward, member, main, saved, queued, originalClassMethod

  const knex = () => bookshelf.knex
  const secretOf = link => link.split('/claim/')[1]

  function call (controller, action, { params = {}, body, userId, fromPage = true } = {}) {
    const req = factories.mock.request()
    req.params = params
    req.body = body
    req.headers = fromPage ? { 'x-agora': '1' } : {}
    req.ip = '127.0.0.5'
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.set = () => {}
    // The pretend response only notes a status when one is set; res.ok means 200
    return controller[action](req, res).then(() => { if (res.statusCode === undefined) res.statusCode = 200; return res })
  }

  async function profile (attrs = {}) {
    const [row] = await knex()('agora_contacts').insert({
      name: 'Ilse Voorbeeld',
      kind: 'team',
      status: 'new',
      source: 'activist-council-2026',
      country: 'Made-up Land',
      offers: 'Facilitates circles; can teach drawing',
      why_here: 'To meet people who care',
      skills: 'Facilitation, Drawing',
      photo_url: 'https://agora.example.org/noo/uploads/evo-uploads/user/system/agoraContactPhoto/1/photo_abc.jpg',
      created_at: new Date(),
      updated_at: new Date(),
      ...attrs
    }).returning('id')
    return String(row.id || row)
  }

  const makeLink = async (contactId, userId = steward.id) => {
    const res = await call(AgoraContactsController, 'createClaimLink', { params: { contactId }, body: {}, userId })
    return res
  }

  const changesOf = contactId => knex()('agora_contact_changes').where({ contact_id: contactId }).orderBy('id').pluck('action')

  before(async () => {
    saved = {
      PROTOCOL: process.env.PROTOCOL,
      DOMAIN: process.env.DOMAIN,
      AGORA_ADMINS: process.env.AGORA_ADMINS,
      AGORA_MAIN_GROUP_SLUG: process.env.AGORA_MAIN_GROUP_SLUG,
      AGORA_INVITE_ONLY: process.env.AGORA_INVITE_ONLY
    }
    process.env.PROTOCOL = 'https'
    process.env.DOMAIN = 'agora.example.org'
    delete process.env.AGORA_ADMINS
    process.env.AGORA_MAIN_GROUP_SLUG = 'made-up-7bp'
    await setup.clearDb()
    steward = await factories.user({ name: 'Steward', email: 'steward@agora.test', active: true }).save()
    member = await factories.user({ name: 'Plain Member', email: 'member@agora.test', active: true }).save()
    main = await factories.group({ name: 'Made-up 7BP', slug: 'made-up-7bp', access_code: 'join-made-up' }).save()
    await steward.joinGroup(main, { assignAdministrator: true })
    await member.joinGroup(main)
    originalClassMethod = Queue.classMethod
  })

  beforeEach(() => {
    AgoraClaimController._resetLimits()
    queued = []
    Queue.classMethod = (model, method, data) => { queued.push({ model, method, data }); return Promise.resolve() }
  })

  afterEach(() => {
    Queue.classMethod = originalClassMethod
  })

  after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe('making claim links', () => {
    it('lets a steward of the main circle make one, keeps only its hash and logs it', async () => {
      const id = await profile({ name: 'Anna Proef' })
      const res = await makeLink(id)
      expect(res.statusCode).to.equal(200)
      const link = res.body.link
      expect(link).to.match(/^https:\/\/agora\.example\.org\/claim\/[A-Za-z0-9_-]{43}$/)
      const row = await knex()('agora_contacts').where({ id }).first()
      expect(row.claim_token_hash).to.equal(Claims.hashSecret(secretOf(link)))
      expect(JSON.stringify(row)).to.not.contain(secretOf(link))
      expect(await changesOf(id)).to.deep.equal(['claim_link'])
      // The page shows that a link is out, never the hash
      const shown = await call(AgoraContactsController, 'show', { params: { contactId: id }, userId: steward.id })
      expect(shown.body.contact.has_claim_link).to.equal(true)
      expect(shown.body.contact).to.not.have.property('claim_token_hash')
    })

    it('refuses members who are not stewards, and requests from other websites', async () => {
      const id = await profile({ name: 'Bram Proef' })
      expect((await makeLink(id, member.id)).statusCode).to.equal(403)
      const meta = await call(AgoraContactsController, 'meta', { userId: member.id })
      expect(meta.body.canMakeClaimLinks).to.equal(false)
      expect((await call(AgoraContactsController, 'meta', { userId: steward.id })).body.canMakeClaimLinks).to.equal(true)
      const res = await call(AgoraContactsController, 'createClaimLink', { params: { contactId: id }, body: {}, userId: steward.id, fromPage: false })
      expect(res.statusCode).to.equal(400)
    })

    it('lets an Agora admin make one, also without being a steward', async () => {
      process.env.AGORA_ADMINS = String(member.id)
      try {
        const id = await profile({ name: 'Cor Proef' })
        expect((await makeLink(id, member.id)).statusCode).to.equal(200)
      } finally {
        delete process.env.AGORA_ADMINS
      }
    })

    it('replaces the old link with a new one, and the old one stops working', async () => {
      const id = await profile({ name: 'Dirk Proef' })
      const first = secretOf((await makeLink(id)).body.link)
      const second = secretOf((await makeLink(id)).body.link)
      expect(first).to.not.equal(second)
      expect(await Claims.isValidToken(first)).to.equal(false)
      expect(await Claims.isValidToken(second)).to.equal(true)
      const old = await call(AgoraClaimController, 'show', { params: { token: first } })
      expect(old.statusCode).to.equal(404)
    })

    it('withdraws a link', async () => {
      const id = await profile({ name: 'Eva Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      expect((await call(AgoraContactsController, 'withdrawClaimLink', { params: { contactId: id }, body: {}, userId: member.id })).statusCode).to.equal(403)
      const res = await call(AgoraContactsController, 'withdrawClaimLink', { params: { contactId: id }, body: {}, userId: steward.id })
      expect(res.statusCode).to.equal(200)
      expect(await Claims.isValidToken(secret)).to.equal(false)
      const row = await knex()('agora_contacts').where({ id }).first()
      expect(row.claim_token_hash).to.equal(null)
      expect(await changesOf(id)).to.deep.equal(['claim_link', 'claim_link_withdrawn'])
    })
  })

  describe('the claim page', () => {
    it('shows the profile to anyone with the link, and nothing more', async () => {
      const id = await profile({ name: 'Fien Proef', email: 'fien@agora.test', phone: '+00 000' })
      const secret = secretOf((await makeLink(id)).body.link)
      const res = await call(AgoraClaimController, 'show', { params: { token: secret } })
      expect(res.statusCode).to.equal(200)
      expect(res.body.profile).to.deep.equal({
        name: 'Fien Proef',
        country: 'Made-up Land',
        offers: 'Facilitates circles; can teach drawing',
        whyHere: 'To meet people who care',
        skills: ['Facilitation', 'Drawing'],
        photoUrl: 'https://agora.example.org/noo/uploads/evo-uploads/user/system/agoraContactPhoto/1/photo_abc.jpg'
      })
      expect(JSON.stringify(res.body)).to.not.contain('fien@agora.test')
      for (const bad of ['', 'short', 'x'.repeat(43), secret.slice(0, 42) + '!']) {
        expect((await call(AgoraClaimController, 'show', { params: { token: bad } })).statusCode).to.equal(404)
      }
    })
  })

  describe('claiming', () => {
    it('fills in the empty parts of the profile, uses up the link and joins the main circle', async () => {
      const id = await profile({ name: 'Gijs Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      const gijs = await factories.user({ name: 'Gijs', email: 'gijs@agora.test', active: true, bio: null, intention: null, location: null }).save()
      await gijs.save({ avatar_url: User.gravatar('gijs@agora.test') }, { patch: true })

      // Only from the page itself
      expect((await call(AgoraClaimController, 'claim', { params: { token: secret }, userId: gijs.id, fromPage: false })).statusCode).to.equal(400)

      const res = await call(AgoraClaimController, 'claim', { params: { token: secret }, userId: gijs.id, body: {} })
      expect(res.statusCode).to.equal(200)
      expect(res.body.contactId).to.equal(id)
      expect(res.body.joinedGroup).to.deep.equal({ slug: 'made-up-7bp', name: 'Made-up 7BP' })
      expect(res.body.filled).to.have.members(['bio', 'intention', 'location', 'avatar_url', 'skills'])

      await gijs.refresh()
      expect(gijs.get('name')).to.equal('Gijs') // their own name stays
      expect(gijs.get('bio')).to.equal('Facilitates circles; can teach drawing')
      expect(gijs.get('intention')).to.equal('To meet people who care')
      expect(gijs.get('location')).to.equal('Made-up Land')
      expect(gijs.get('avatar_url')).to.contain('/agoraContactPhoto/')
      const skills = await knex()('skills_users').join('skills', 'skills.id', 'skills_users.skill_id')
        .where({ 'skills_users.user_id': gijs.id, 'skills_users.type': 0 }).pluck('skills.name')
      expect(skills).to.have.members(['Facilitation', 'Drawing'])
      expect(await GroupMembership.forPair(gijs, main).fetch()).to.not.equal(null)

      const row = await knex()('agora_contacts').where({ id }).first()
      expect(String(row.claimed_user_id)).to.equal(String(gijs.id))
      expect(row.claimed_at).to.be.an.instanceof(Date)
      expect(row.claim_token_hash).to.equal(null)
      expect(await changesOf(id)).to.deep.equal(['claim_link', 'claimed'])

      // The Contacts page shows who claimed it
      const shown = await call(AgoraContactsController, 'show', { params: { contactId: id }, userId: steward.id })
      expect(shown.body.contact.claimed_user_id).to.equal(String(gijs.id))
      expect(shown.body.contact.claimed_user_name).to.equal('Gijs')
    })

    it('never overwrites what someone wrote in their own profile', async () => {
      const id = await profile({ name: 'Hanna Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      const hanna = await factories.user({ name: 'Hanna', email: 'hanna@agora.test', active: true, bio: 'My own words', intention: 'My own reason', location: 'Utopia', avatar_url: 'https://agora.example.org/noo/uploads/mine.png' }).save()
      const res = await call(AgoraClaimController, 'claim', { params: { token: secret }, userId: hanna.id, body: {} })
      expect(res.statusCode).to.equal(200)
      expect(res.body.filled).to.deep.equal(['skills'])
      await hanna.refresh()
      expect(hanna.get('bio')).to.equal('My own words')
      expect(hanna.get('intention')).to.equal('My own reason')
      expect(hanna.get('location')).to.equal('Utopia')
      expect(hanna.get('avatar_url')).to.equal('https://agora.example.org/noo/uploads/mine.png')
    })

    it('refuses a link that was used already, and someone who claimed a profile before', async () => {
      const id = await profile({ name: 'Ivo Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      const ivo = await factories.user({ email: 'ivo@agora.test', active: true }).save()
      const other = await factories.user({ email: 'not.ivo@agora.test', active: true }).save()
      expect((await call(AgoraClaimController, 'claim', { params: { token: secret }, userId: ivo.id, body: {} })).statusCode).to.equal(200)

      // The same link again, by anyone
      for (const userId of [ivo.id, other.id]) {
        const again = await call(AgoraClaimController, 'claim', { params: { token: secret }, userId, body: {} })
        expect(again.statusCode).to.equal(404)
      }
      expect((await call(AgoraClaimController, 'show', { params: { token: secret } })).statusCode).to.equal(404)

      // Ivo cannot take a second profile
      const second = await profile({ name: 'Jet Proef' })
      const secondSecret = secretOf((await makeLink(second)).body.link)
      const res = await call(AgoraClaimController, 'claim', { params: { token: secondSecret }, userId: ivo.id, body: {} })
      expect(res.statusCode).to.equal(409)
      expect(await Claims.isValidToken(secondSecret)).to.equal(true)
    })

    it('lets the person who claimed delete the sheet data, and only them', async () => {
      const id = await profile({ name: 'Kees Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      const kees = await factories.user({ name: 'Kees', email: 'kees@agora.test', active: true, bio: null }).save()
      const other = await factories.user({ email: 'not.kees@agora.test', active: true }).save()
      expect((await call(AgoraClaimController, 'claim', { params: { token: secret }, userId: kees.id, body: {} })).statusCode).to.equal(200)

      // Someone who claimed nothing, and a request from outside the page, get nowhere
      expect((await call(AgoraClaimController, 'removeSheetData', { userId: other.id, body: {} })).statusCode).to.equal(404)
      expect((await call(AgoraClaimController, 'removeSheetData', { userId: kees.id, body: {}, fromPage: false })).statusCode).to.equal(400)

      const res = await call(AgoraClaimController, 'removeSheetData', { userId: kees.id, body: {} })
      expect(res.statusCode).to.equal(200)
      const row = await knex()('agora_contacts').where({ id }).first()
      for (const column of ['country', 'offers', 'why_here', 'skills', 'photo_url']) expect(row[column]).to.equal(null)
      expect(row.name).to.equal('Kees Proef')
      expect(String(row.claimed_user_id)).to.equal(String(kees.id))
      expect(await changesOf(id)).to.deep.equal(['claim_link', 'claimed', 'sheet_data_removed'])
      // What was copied into their own profile stays theirs
      await kees.refresh()
      expect(kees.get('bio')).to.equal('Facilitates circles; can teach drawing')
    })

    it('gives a claimed profile no new link', async () => {
      const id = await profile({ name: 'Kees Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      const kees = await factories.user({ email: 'kees@agora.test', active: true }).save()
      await Claims.claim({ secret, userId: kees.id })
      const res = await makeLink(id)
      expect(res.statusCode).to.equal(409)
      expect(res.body.error).to.equal('This profile has been claimed already.')
    })

    it('works without a main circle; the person just joins none', async () => {
      process.env.AGORA_MAIN_GROUP_SLUG = 'no-such-circle'
      try {
        process.env.AGORA_ADMINS = String(steward.id)
        const id = await profile({ name: 'Lot Proef' })
        const { link } = await Claims.createLink({ contactId: id, userId: steward.id })
        const lot = await factories.user({ email: 'lot@agora.test', active: true }).save()
        const result = await Claims.claim({ secret: secretOf(link), userId: lot.id })
        expect(result.joinedGroup).to.equal(null)
        expect(await GroupMembership.forPair(lot, main).fetch()).to.equal(null)
      } finally {
        process.env.AGORA_MAIN_GROUP_SLUG = 'made-up-7bp'
        delete process.env.AGORA_ADMINS
      }
    })

    it('needs a login', async () => {
      const res = await call(AgoraClaimController, 'claim', { params: { token: 'x'.repeat(43) }, body: {} })
      expect(res.statusCode).to.equal(401)
    })
  })

  describe('signing up with a claim link while sign-up is by invitation only', () => {
    const findByEmail = email => User.query(q => q.whereRaw('lower(email) = ?', email)).fetch()
    const signUp = (email, held = {}) => sendEmailVerification(null, { email, ...held }, { req: { ip: '127.0.0.6' } })
    let original

    beforeEach(() => { original = process.env.AGORA_INVITE_ONLY; process.env.AGORA_INVITE_ONLY = 'on' })
    afterEach(() => {
      if (original === undefined) delete process.env.AGORA_INVITE_ONLY
      else process.env.AGORA_INVITE_ONLY = original
    })

    it('makes an account, with any address, for someone with a working claim link', async () => {
      const id = await profile({ name: 'Mira Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      expect(await signUp('mira.own@agora.test', { claimToken: secret })).to.deep.equal({ success: true })
      expect(await findByEmail('mira.own@agora.test')).to.not.equal(null)
      expect(queued.filter(j => j.method === 'sendEmailVerification' && j.data.email === 'mira.own@agora.test')).to.have.length(1)
    })

    it('refuses a withdrawn, used or made-up claim link, and makes no account', async () => {
      const id = await profile({ name: 'Noor Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      await Claims.withdrawLink({ contactId: id, userId: steward.id })
      expect(await signUp('noor@agora.test', { claimToken: secret })).to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await signUp('noor@agora.test', { claimToken: 'y'.repeat(43) })).to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await findByEmail('noor@agora.test')).to.equal(null)

      const used = await profile({ name: 'Olga Proef' })
      const usedSecret = secretOf((await makeLink(used)).body.link)
      const olga = await factories.user({ email: 'olga@agora.test', active: true }).save()
      await Claims.claim({ secret: usedSecret, userId: olga.id })
      expect(await signUp('olga.second@agora.test', { claimToken: usedSecret })).to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await findByEmail('olga.second@agora.test')).to.equal(null)
    })

    it('is never taken from a Google or Apple login', () => {
      const req = { param: name => ({ claimToken: 'z'.repeat(43) })[name], body: {} }
      expect(AgoraSignup.invitationFromRequest(req).claimToken).to.equal(undefined)
      expect(AgoraSignup.hasInvitation(AgoraSignup.invitationFromRequest(req))).to.equal(false)
    })

    it('does not weaken email invitations: one sent to another address still cannot be used', async () => {
      const id = await profile({ name: 'Piet Proef' })
      const secret = secretOf((await makeLink(id)).body.link)
      const invitation = await Invitation.create({ email: 'invited.person@agora.test', userId: steward.id, groupId: main.id })
      const token = invitation.get('token')

      // Without the claim link, the invitation still only works for its own address
      expect(await signUp('piet@agora.test', { invitationToken: token })).to.deep.equal({ success: false, error: 'invite-expired' })
      expect(await findByEmail('piet@agora.test')).to.equal(null)

      // With a claim link the account is made, but the invitation stays the other person's
      expect(await signUp('piet@agora.test', { invitationToken: token, claimToken: secret })).to.deep.equal({ success: true })
      const piet = await findByEmail('piet@agora.test')
      await piet.save({ active: true }, { patch: true })
      await expect(InvitationService.use(piet.id, token)).to.be.rejectedWith('agora-invitation-other-account')
      await invitation.refresh()
      expect(invitation.get('used_by_id')).to.equal(null)
      expect(await AgoraSignup.isValidInvitation({ invitationToken: token }, 'piet@agora.test')).to.equal(false)
    })
  })
})
