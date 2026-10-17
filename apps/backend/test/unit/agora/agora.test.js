/* eslint-env mocha */
/**
 * Agora: checks for the parts that need no database.
 *
 *   cd apps/backend
 *   npx mocha -r @babel/register test/unit/agora/agora.test.js
 */
const { expect } = require('chai')
const MeetingMinutes = require('../../../api/services/MeetingMinutes')
const mailer = require('../../../lib/agora/mailer')

const startedAt = new Date('2026-10-12T17:00:00Z')
const at = seconds => new Date(startedAt.getTime() + seconds * 1000)

describe('Agora meeting minutes', () => {
  const lines = [
    { name: 'Lars', text: 'I propose consent.', spokenAt: at(5) },
    { name: 'Lars', text: 'For three months.', spokenAt: at(12) },
    { name: 'Amara', text: 'Fine by me.', spokenAt: at(20) },
    { name: 'Lars', text: 'Good.', spokenAt: at(200) }
  ]

  it('joins what one person says in a row', () => {
    const merged = MeetingMinutes.mergeLines(lines)
    expect(merged.map(l => l.name)).to.deep.equal(['Lars', 'Amara', 'Lars'])
    expect(merged[0].text).to.equal('I propose consent. For three months.')
  })

  it('writes the transcript with a clock and a name on each line', () => {
    const text = MeetingMinutes.transcriptAsText(lines, startedAt)
    expect(text.split('\n')[0]).to.equal('[0:05] Lars: I propose consent. For three months.')
    expect(text).to.contain('[3:20] Lars: Good.')
  })

  it('escapes whatever the assistant or the speech recognition returns', () => {
    const html = MeetingMinutes.renderHtml({
      minutes: {
        summary: 'A <b>bold</b> summary',
        topics: [{ title: 'T', points: ['<img src=x onerror=alert(1)>'] }],
        decisions: ['<script>alert(1)</script>'],
        actions: [{ who: 'Lars', what: 'Rewrite & send', due: '' }],
        open_questions: []
      },
      attendees: ['Lars', 'Amara <x>'],
      lines: [{ name: 'Lars', text: '<i>hello</i>', spokenAt: at(1) }],
      startedAt
    })
    expect(html).to.not.contain('<script>')
    expect(html).to.not.contain('<img')
    expect(html).to.not.contain('<i>hello</i>')
    expect(html).to.contain('&lt;script&gt;')
    expect(html).to.contain('<strong>Lars</strong>: Rewrite &amp; send')
    expect(html).to.contain('Amara &lt;x&gt;')
  })

  it('falls back to the transcript when there is no summary', () => {
    const html = MeetingMinutes.renderHtml({ minutes: null, attendees: [], lines, startedAt })
    expect(html).to.contain('The assistant is not connected yet')
    expect(html).to.contain('<h3>Transcript</h3>')
    expect(html).to.not.contain('<h3>Decisions</h3>')
  })
})

describe('Agora mailer', () => {
  it('has a text for every email a new member needs', () => {
    const needed = [
      'tem_h99yGHv9MXTpMrPSDVTjQFyB', // verification code
      'tem_fqGSrDrSK6WpjTBFXSfY79k4', // finish registration
      'tem_phRPHm3y6RHvRFww6Vc3VBVB', // password reset
      'tem_GTwXKBfkTpTHRfHpmJWbYr9d' // invitation
    ]
    needed.forEach(id => expect(mailer.TEMPLATES[id], id).to.be.a('function'))
  })

  it('puts the code in the verification email and escapes links in the HTML', () => {
    const email = mailer.TEMPLATES.tem_h99yGHv9MXTpMrPSDVTjQFyB({ code: '482913', verify_url: 'https://agora.test/v?a=1&b=<2>' })
    expect(email.subject).to.contain('482913')
    expect(email.text).to.contain('https://agora.test/v?a=1&b=<2>')
    expect(email.html).to.contain('href="https://agora.test/v?a=1&amp;b=&lt;2&gt;"')
  })

  it('has a text for event, post and digest emails', () => {
    const needed = [
      'tem_8pt9FjFkxRGQ7XYhRRW3BBrK', // event invitation
      'tem_93YXdBV6bg4WmD8w3krpGP7H', // reply to an event
      'tem_77XY6QJTVYKKFhDtkVgW3W93', // event changed
      'tem_YCTQy4pJywkRDw6pfhShDg9H', // event cancelled
      'tem_cPYpXw7d9pCdm6M8QmtPvPGG', // new post
      'tem_77d99tkvmTBJt7rD83DD4XRP', // mention
      'tem_t7rmGfJKvqXrvmrVWJjjWkg4' // digest
    ]
    needed.forEach(id => expect(mailer.TEMPLATES[id], id).to.be.a('function'))
  })

  it('turns post HTML into plain text that stays escaped', () => {
    expect(mailer.plainText('<p>One &amp; two</p><p>Three<br>four</p>')).to.equal('One & two\nThree\nfour')
    const email = mailer.TEMPLATES.tem_cPYpXw7d9pCdm6M8QmtPvPGG({
      group_name: 'Comms',
      post: { title: 'Plan', details: '<p>&lt;script&gt;x&lt;/script&gt;</p>', url: 'https://agora.test/p/1', user: { name: 'Lars' } }
    }, { sender: { name: 'Lars (via Hylo)' } })
    expect(email.subject).to.equal('Lars posted in Comms: Plan')
    expect(email.text).to.contain('<script>x</script>')
    expect(email.html).to.not.contain('<script>')
    expect(email.html).to.contain('&lt;script&gt;')
  })

  it('names the inviter in an event invitation', () => {
    const email = mailer.TEMPLATES.tem_8pt9FjFkxRGQ7XYhRRW3BBrK({
      group_name: 'Network',
      post: { title: 'Circle meeting', when: 'Mon, Oct 20, 7:00 PM', location: 'Online', url: 'https://agora.test/p/2', user: { name: 'Amara' } }
    }, { sender: { name: 'Lars (via Hylo)' } })
    expect(email.subject).to.equal('Lars invites you to Circle meeting')
    expect(email.text).to.contain('When: Mon, Oct 20, 7:00 PM')
    expect(email.text).to.contain('Where: Online')
  })

  it('says what a reply to an event means and mentions the calendar file', () => {
    const email = mailer.TEMPLATES.tem_93YXdBV6bg4WmD8w3krpGP7H({
      user_name: 'Amara', event_name: 'Circle meeting', response: 'Going to', date: 'Mon, Oct 20', event_url: 'https://agora.test/p/2'
    }, {})
    expect(email.text).to.contain('You are going to Circle meeting.')
    expect(email.text).to.contain('calendar file')
  })

  it('writes a digest with a list per kind of post, and says Agora instead of Hylo', () => {
    const email = mailer.TEMPLATES.tem_t7rmGfJKvqXrvmrVWJjjWkg4({
      subject: 'Your Hylo Weekly Digest',
      unified: true,
      group_name: 'Hylo',
      time_period: 'week',
      group_url: 'https://agora.test/',
      recipient: { name: 'Amara' },
      discussions: [{ title: 'Budget', url: 'https://agora.test/p/3', user: { name: 'Lars' } }],
      posts_with_new_comments: [{ title: 'Playbook', url: 'https://agora.test/p/4', comments: [{}, {}], comment_count: 2 }],
      chat_rooms: [{ name: 'Comms', num_new_chats: 1, url: 'https://agora.test/c' }],
      offers: []
    }, {})
    expect(email.subject).to.equal('Your Agora Weekly Digest')
    expect(email.text).to.contain('New discussions\n- Budget (by Lars)')
    expect(email.text).to.contain('Playbook (2 new comments)')
    expect(email.text).to.contain('Comms (1 new message)')
    expect(email.text).to.not.contain('Offers')
    expect(email.text).to.not.contain('Hylo')
  })

  it('leaves out reply addresses that only Hylo reads, and keeps a real person', () => {
    const before = process.env.INBOUND_EMAIL_DOMAIN
    process.env.INBOUND_EMAIL_DOMAIN = 'inbound-staging.hylo.com'
    try {
      expect(mailer.fromHeader({ sender: { reply_to: 'reply-abc@inbound-staging.hylo.com' } }).replyTo).to.equal(null)
      expect(mailer.fromHeader({ sender: { reply_to: 'DoNotReply@hylo.com' } }).replyTo).to.equal(null)
      expect(mailer.fromHeader({ sender: { reply_to: 'lars@example.org' } }).replyTo).to.equal('lars@example.org')
      expect(mailer.fromHeader({ sender: { name: 'Lars (via Hylo)' } }).name).to.equal('Lars (via Agora)')
    } finally {
      process.env.INBOUND_EMAIL_DOMAIN = before
    }
  })

  it('passes the calendar file on to Brevo', async () => {
    const saved = { fetch: global.fetch, transport: process.env.AGORA_EMAIL_TRANSPORT, key: process.env.BREVO_API_KEY, sender: process.env.EMAIL_SENDER }
    let body
    global.fetch = async (url, request) => {
      body = JSON.parse(request.body)
      return { ok: true, json: async () => ({ messageId: 'x' }) }
    }
    process.env.AGORA_EMAIL_TRANSPORT = 'brevo'
    process.env.BREVO_API_KEY = 'test-only'
    process.env.EMAIL_SENDER = 'agora@agora.test'
    try {
      await new Promise((resolve, reject) => mailer.send({
        email_id: 'tem_YCTQy4pJywkRDw6pfhShDg9H',
        recipient: { address: 'amara@agora.test' },
        email_data: { event_name: 'Circle meeting', date: 'Mon, Oct 20' },
        files: [{ id: 'invite.ics', data: 'QkVHSU46VkNBTEVOREFS' }]
      }, err => err ? reject(err) : resolve()))
      expect(body.attachment).to.deep.equal([{ name: 'invite.ics', content: 'QkVHSU46VkNBTEVOREFS' }])
      expect(body.subject).to.equal('Cancelled: Circle meeting')
    } finally {
      global.fetch = saved.fetch
      const restore = (name, value) => { if (value === undefined) delete process.env[name]; else process.env[name] = value }
      restore('AGORA_EMAIL_TRANSPORT', saved.transport)
      restore('BREVO_API_KEY', saved.key)
      restore('EMAIL_SENDER', saved.sender)
    }
  })

  it('sends through an SMTP server with encryption, the calendar file and no Hylo reply address', async () => {
    const nodemailerPath = require.resolve('nodemailer')
    const saved = { cached: require.cache[nodemailerPath], env: { ...process.env } }
    let transportOptions, mail
    require.cache[nodemailerPath] = {
      id: nodemailerPath,
      filename: nodemailerPath,
      loaded: true,
      exports: {
        createTransport: options => {
          transportOptions = options
          return { sendMail: async message => { mail = message; return { messageId: 'x' } } }
        }
      }
    }
    Object.assign(process.env, {
      AGORA_EMAIL_TRANSPORT: 'smtp',
      AGORA_SMTP_HOST: 'smtp.agora.test',
      AGORA_SMTP_USER: 'agora@agora.test',
      AGORA_SMTP_PASSWORD: 'test-only',
      EMAIL_SENDER: 'agora@agora.test',
      INBOUND_EMAIL_DOMAIN: 'inbound.agora.test'
    })
    try {
      await new Promise((resolve, reject) => mailer.send({
        email_id: 'tem_YCTQy4pJywkRDw6pfhShDg9H',
        recipient: { address: 'amara@agora.test' },
        sender: { name: 'Network (via Hylo)', reply_to: 'reply-1@inbound.agora.test' },
        email_data: { event_name: 'Circle meeting', date: 'Mon, Oct 20' },
        files: [{ id: 'invite.ics', data: 'QkVHSU46VkNBTEVOREFS' }]
      }, err => err ? reject(err) : resolve()))
      expect(transportOptions).to.include({ host: 'smtp.agora.test', port: 587, secure: false, requireTLS: true })
      expect(transportOptions.auth).to.deep.equal({ user: 'agora@agora.test', pass: 'test-only' })
      expect(mail.from).to.deep.equal({ name: 'Network (via Agora)', address: 'agora@agora.test' })
      expect(mail.replyTo).to.equal(undefined)
      expect(mail.subject).to.equal('Cancelled: Circle meeting')
      expect(mail.attachments).to.deep.equal([{ filename: 'invite.ics', content: 'QkVHSU46VkNBTEVOREFS', encoding: 'base64' }])
    } finally {
      if (saved.cached) require.cache[nodemailerPath] = saved.cached
      else delete require.cache[nodemailerPath]
      for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key]
      Object.assign(process.env, saved.env)
    }
  })

  it('does not send an email it has no text for', done => {
    mailer.send({ email_id: 'tem_does_not_exist', recipient: { address: 'x@agora.test' } }, (err, result) => {
      expect(err).to.equal(null)
      expect(result).to.deep.equal({ skipped: true })
      done()
    })
  })
})
