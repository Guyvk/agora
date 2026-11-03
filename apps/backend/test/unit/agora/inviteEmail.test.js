/* eslint-env mocha */
/**
 * Agora: the invitation email and the links in Agora's emails.
 *
 * - The invitation email says Agora, names who invites, and shows the
 *   invitation text as plain paragraphs (Hylo stores it as HTML, which used to
 *   show up escaped: "<p>Hi!</p> <p>I&#39;m inviting you ...").
 * - An email invitation belongs to the address it was sent to, also for
 *   someone who is already logged in with another account.
 * - Links in emails carry no click counting (ctt, cti, ctcn), and the link to
 *   the notification settings holds no login token, name or user id.
 *
 * No email is sent: the tests catch what would go out before it reaches a
 * mail server. These checks need a database, and empty it first. Never point
 * them at a database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/inviteEmail.test.js
 */
import { mockify, unspyify } from '../../setup/helpers'
import mailer from '../../../lib/agora/mailer'
import { locales } from '../../../lib/i18n/locales'
import { createInvitation } from '../../../api/graphql/mutations/invitation'
import { joinGroup } from '../../../api/graphql/mutations/group'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))
const InvitationService = require(rootPath('api/services/InvitationService'))

const INVITATION = 'tem_GTwXKBfkTpTHRfHpmJWbYr9d'
const POST = 'tem_cPYpXw7d9pCdm6M8QmtPvPGG'
const DIGEST = 'tem_t7rmGfJKvqXrvmrVWJjjWkg4'

/** Every link in an email, from its text and its HTML. */
function linksIn (content) {
  const found = `${content.text}\n${content.html}`.match(/https?:\/\/[^\s"<>]+/g) || []
  return found.map(link => link.replace(/&amp;/g, '&'))
}

describe('Agora invitation email', () => {
  it('shows Hylo\'s stored HTML message as plain paragraphs, escaped once, with Agora instead of Hylo', () => {
    // What Hylo stored for Guy's test invitation on 19 October
    const content = mailer.TEMPLATES[INVITATION]({
      subject: 'Join me in Governance on Hylo!',
      message: '<p>Hi!</p>\n<p>I&#39;m inviting you to join Governance on Hylo.</p>\n<p>Governance is using Hylo for our online community: this is our dedicated space for communication &amp; collaboration.</p>',
      inviter_name: 'Guy van Koolwijk',
      group_name: 'Governance',
      invite_link: 'https://agora.example.org/h/use-invitation?token=abc&email=guyvankool%40gmail.com'
    })
    expect(content.subject).to.equal('Guy van Koolwijk invites you to Governance in Agora')
    expect(content.html).to.contain('<p>Hi!</p>')
    expect(content.html).to.contain("<p>I'm inviting you to join Governance on Agora.</p>")
    expect(content.html).to.contain('communication &amp; collaboration.')
    expect(content.html).to.not.contain('&lt;p&gt;')
    expect(content.html).to.not.contain('&amp;#39;')
    expect(content.html).to.not.contain('&amp;amp;')
    expect(content.text).to.contain("Hi!\n\nI'm inviting you to join Governance on Agora.")
    expect(content.text).to.not.contain('<p>')
    expect(`${content.subject} ${content.text} ${content.html}`).to.not.match(/Hylo/)
  })

  it('never lets HTML from the message into the email', () => {
    const content = mailer.TEMPLATES[INVITATION]({
      message: '<p>Hello <b>you</b></p><script>alert("x")</script><img src=x onerror="alert(1)"><a href="https://evil.example">click</a>',
      inviter_name: 'Mallory',
      group_name: 'Governance',
      invite_link: 'https://agora.example.org/h/use-invitation?token=abc'
    })
    expect(content.html).to.contain('<p>Hello you<br>click</p>')
    expect(content.html).to.not.match(/<script|<img|<b>|onerror|evil\.example|alert/)
    // The inviter's name and the circle's name are escaped too
    const named = mailer.TEMPLATES[INVITATION]({ inviter_name: '<b>Eve</b>', group_name: 'A & B', invite_link: 'https://a.example/x' })
    expect(named.html).to.contain('&lt;b&gt;Eve&lt;/b&gt;')
    expect(named.html).to.contain('A &amp; B')
  })

  it('keeps a subject that says nothing of Hylo, and has a text without a message', () => {
    const content = mailer.TEMPLATES[INVITATION]({
      subject: 'Guy lädt dich zu Governance in Agora ein',
      inviter_name: 'Guy',
      group_name: 'Governance',
      invite_link: 'https://agora.example.org/h/use-invitation?token=abc'
    })
    expect(content.subject).to.equal('Guy lädt dich zu Governance in Agora ein')
    expect(content.text).to.contain('Guy invites you to join Governance in Agora.')
  })

  it('has Agora\'s default texts in every language, with no Hylo in them', () => {
    expect(locales.en.createInvitationSubject('Governance', 'Guy van Koolwijk')).to.equal('Guy van Koolwijk invites you to Governance in Agora')
    expect(locales.en.createInvitationMessage('Governance')).to.equal("Hi!\n\nI'm inviting you to join Governance in Agora, 7 Billion Presidents' own online home.")
    for (const [lang, strings] of Object.entries(locales)) {
      for (const text of [
        strings.createInvitationSubject('Governance', 'Guy'),
        strings.createInvitationSubject('Governance'),
        strings.createInvitationMessage('Governance'),
        strings.apiInviteMessageSubject('Governance'),
        strings.clientInviteSubjectDefault('Governance')
      ]) {
        expect(text, lang).to.contain('Agora')
        expect(text, lang).to.not.contain('Hylo')
      }
    }
  })
})

describe('Agora links in emails', () => {
  const settingsWithToken = 'https://agora.example.org/notifications?ctt=post_email&cti=1&ctcn=Governance&expand=account&token=' +
    'eyJ' + 'x'.repeat(600) + '&name=Guy%20van%20Koolwijk&u=1'

  function expectCleanLinks (content) {
    const links = linksIn(content)
    expect(links.length).to.be.above(0)
    for (const link of links) {
      expect(link).to.not.match(/[?&](ctt|cti|ctcn)=/)
      expect(link).to.not.match(/[?&](token|name|u)=/)
      expect(link).to.not.contain('Koolwijk')
      expect(link.length).to.be.below(120)
    }
  }

  it('gives a post notification a clean post link and a short settings link', () => {
    const content = mailer.TEMPLATES[POST]({
      group_name: 'Governance',
      email_settings_url: settingsWithToken,
      post: {
        title: 'Hello',
        user: { name: 'Guy van Koolwijk' },
        details: '<p>Read <a href="https://agora.example.org/x?ctt=post_email&cti=1">this</a></p>',
        url: 'https://agora.example.org/groups/governance/all/post/2?ctt=post_email&cti=1&ctcn=Governance'
      }
    }, { sender: { name: 'Guy van Koolwijk (via Hylo)' } })
    expectCleanLinks(content)
    expect(content.text).to.contain('Read and reply: https://agora.example.org/groups/governance/all/post/2\n')
    expect(content.text).to.contain('You can change them here: https://agora.example.org/my/notifications')
    // The fallback under the button is the same short link
    expect(content.html).to.contain('copy this address into your browser:<br>https://agora.example.org/groups/governance/all/post/2</p>')
  })

  it('cleans every link of a digest', () => {
    const content = mailer.TEMPLATES[DIGEST]({
      group_name: 'Governance',
      time_period: 'week',
      group_url: 'https://agora.example.org/groups/governance?ctt=digest_email&cti=1&ctcn=Hylo',
      email_settings_url: settingsWithToken,
      discussions: [{ title: 'A talk', url: 'https://agora.example.org/groups/governance/post/3?ctt=digest_email&cti=1&ctcn=Governance', user: { name: 'Lars' } }],
      chat_rooms: [{ name: 'general', url: 'https://agora.example.org/groups/governance/chat/general?ctt=digest_email&cti=1&ctcn=Governance', num_new_chats: 2 }]
    })
    expectCleanLinks(content)
    expect(linksIn(content)).to.include('https://agora.example.org/groups/governance/post/3')
  })

  it('keeps what a link needs to work, like the token of an invitation', () => {
    expect(mailer.cleanLink('https://agora.example.org/h/use-invitation?token=abc&email=a%40b.org&ctt=x'))
      .to.equal('https://agora.example.org/h/use-invitation?token=abc&email=a%40b.org')
    expect(mailer.cleanLink('https://agora.example.org/groups/g?ctt=x&cti=1&ctcn=G&utm_source=y')).to.equal('https://agora.example.org/groups/g')
    expect(mailer.cleanLink('not a link')).to.equal('not a link')
    expect(mailer.settingsLink({ email_settings_url: settingsWithToken })).to.equal('https://agora.example.org/my/notifications')
    expect(mailer.settingsLink({})).to.equal(null)
  })

  it('signs as Agora, not as Hylo\'s team or robot, in every language', () => {
    for (const strings of Object.values(locales)) {
      expect(mailer.fromHeader({ sender: { name: strings.theTeamAtHylo } }).name).to.equal('Agora')
    }
    expect(mailer.fromHeader({ sender: { name: 'Hylobot' } }).name).to.equal('Agora')
    expect(mailer.fromHeader({ sender: { name: 'Guy (über Hylo)' } }).name).to.equal('Guy (über Agora)')
  })

  it('turns the <br/> lines of a plain message into text', () => {
    const content = mailer.TEMPLATES.tem_jFYJ3bxMyfbbtbwgDGS4JGfK({ subject: 'New Hylo Group Created: X', body: 'Group<br/>\nName: X<br/>\n' })
    expect(content.subject).to.equal('New Agora Group Created: X')
    expect(content.html).to.not.contain('&lt;br')
    expect(content.text).to.contain('Group\nName: X')
  })
})

describe('Agora invitations from the Invite settings of a circle', () => {
  let guy, governance, originalSetting, originalClassMethod, originalHasResponsibility, queued, sent

  before(async () => {
    originalSetting = process.env.AGORA_INVITE_ONLY
    await setup.clearDb()
    guy = await factories.user({ name: 'Guy van Koolwijk', email: 'info@guyvankoolwijk.nl' }).save()
    governance = await factories.group({
      name: 'Governance',
      slug: 'governance',
      access_code: 'join-governance',
      accessibility: Group.Accessibility.CLOSED
    }).save()
    await guy.joinGroup(governance)
    originalClassMethod = Queue.classMethod
    originalHasResponsibility = GroupMembership.hasResponsibility
  })

  beforeEach(() => {
    process.env.AGORA_INVITE_ONLY = 'on'
    queued = []
    sent = []
    Queue.classMethod = (model, method, data) => { queued.push({ model, method, data }); return Promise.resolve() }
    // Guy may invite to his circle (the steward roles are tested in stewardRoles.test.js)
    GroupMembership.hasResponsibility = () => Promise.resolve(true)
    // Catch the email before it leaves: it is rendered with Agora's text, never sent
    mockify(Email, 'sendInvitation', (email, data) => {
      sent.push({ email, data, content: mailer.TEMPLATES[INVITATION](data) })
      return Promise.resolve(true)
    })
  })

  afterEach(() => {
    Queue.classMethod = originalClassMethod
    GroupMembership.hasResponsibility = originalHasResponsibility
    unspyify(Email, 'sendInvitation')
  })

  after(() => {
    if (originalSetting === undefined) delete process.env.AGORA_INVITE_ONLY
    else process.env.AGORA_INVITE_ONLY = originalSetting
  })

  async function invite (email) {
    const { invitations } = await createInvitation(guy.id, governance.id, { emails: [email] })
    expect(invitations[0].error).to.equal(undefined)
    const job = queued.find(j => j.method === 'createAndSend')
    await Invitation.createAndSend(job.data)
    return Invitation.find(invitations[0].id)
  }

  it('sends an email that says Agora, names Guy and shows the text as paragraphs', async () => {
    const invitation = await invite('guyvankool@gmail.com')
    expect(sent).to.have.length(1)
    const { email, data, content } = sent[0]
    expect(email).to.equal('guyvankool@gmail.com')
    expect(invitation.get('subject')).to.equal('Guy van Koolwijk invites you to Governance in Agora')
    expect(content.subject).to.equal('Guy van Koolwijk invites you to Governance in Agora')
    expect(content.html).to.contain('<p>Hi!</p>')
    expect(content.html).to.contain("<p>I'm inviting you to join Governance in Agora, 7 Billion Presidents' own online home.</p>")
    expect(content.html).to.not.contain('&lt;')
    expect(`${content.subject} ${content.text} ${content.html}`).to.not.match(/Hylo/)
    expect(data.invite_link).to.contain(`/h/use-invitation?token=${invitation.get('token')}`)
  })

  it('does not let someone logged in with another address use it, and makes no membership', async () => {
    const invitation = await invite('bea@agora.test')
    const bea = await factories.user({ email: 'bea@agora.test' }).save()
    const other = await factories.user({ email: 'someone.else@agora.test' }).save()

    await expect(InvitationService.use(other.id, invitation.get('token'))).to.be.rejectedWith('agora-invitation-other-account')
    await expect(joinGroup(governance.id, other.id, [], null, invitation.get('token'))).to.be.rejectedWith('You do not have permission to do that')
    expect(await GroupMembership.forPair(other, governance).fetch()).to.equal(null)
    await invitation.refresh()
    expect(invitation.get('used_by_id')).to.equal(null)

    // The invited address can still accept it, also written with capitals
    await bea.save({ email: 'Bea@Agora.test' }, { patch: true })
    const membership = await joinGroup(governance.id, bea.id, [], null, invitation.get('token'))
    expect(membership).to.not.equal(null)
    expect(await GroupMembership.forPair(bea, governance).fetch()).to.not.equal(null)
    await invitation.refresh()
    expect(String(invitation.get('used_by_id'))).to.equal(String(bea.id))
  })

  it('lets anyone use a join link, which has no address', async () => {
    const someone = await factories.user({ email: 'joiner@agora.test' }).save()
    await joinGroup(governance.id, someone.id, [], 'join-governance', null)
    expect(await GroupMembership.forPair(someone, governance).fetch()).to.not.equal(null)
  })

  it('works as in Hylo when sign-up by invitation is off', async () => {
    process.env.AGORA_INVITE_ONLY = 'off'
    const invitation = await invite('carl@agora.test')
    const other = await factories.user({ email: 'not.carl@agora.test' }).save()
    await InvitationService.use(other.id, invitation.get('token'))
    expect(await GroupMembership.forPair(other, governance).fetch()).to.not.equal(null)
  })
})
