/* eslint-env mocha */
/**
 * Agora: Help and the Help desk.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/help.test.js
 *
 * Claude is never called: a pretend client stands in for it.
 */
import AgoraHelpController from '../../../api/controllers/AgoraHelpController'
import Help from '../../../lib/agora/help'
import HelpClaude from '../../../lib/agora/helpClaude'
import mailer from '../../../lib/agora/mailer'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const SAVED_ENV = {}
const ENV_NAMES = ['ANTHROPIC_API_KEY', 'AGORA_HELPDESK_ADMINS', 'AGORA_ADMINS', 'AGORA_VERSION', 'AGORA_HELP_CHAT_PER_HOUR', 'AGORA_HELP_REQUESTS_PER_DAY', 'AGORA_HELP_REPLY_EMAIL']

describe('Agora help', () => {
  let amara, lars, guy, unconfirmed, sleeping

  function call (action, { params = {}, query = {}, body, userId, fromPage = true } = {}) {
    const req = factories.mock.request()
    req.params = params
    req.query = query
    req.body = body
    req.headers = fromPage ? { 'x-agora': '1' } : {}
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.set = () => {}
    return AgoraHelpController[action](req, res).then(() => res)
  }

  const knex = () => bookshelf.knex
  const context = {
    page: 'https://agora.example.org/groups/7bp/playbook?token=secret#top',
    userAgent: 'Mozilla/5.0 (Test)',
    screen: '1440x900 @2x<script>'
  }
  const sendForm = (userId, body = {}) => call('create', { userId, body: { what_happened: 'The save button does nothing', context, ...body } })

  // A pretend Anthropic client: answers come from `answers`, requests go into `sent`.
  let sent, answers
  function pretendClaude () {
    sent = []
    answers = []
    HelpClaude.useClientForTests({
      messages: {
        create: async params => {
          sent.push(JSON.parse(JSON.stringify(params)))
          const next = answers.shift()
          if (next instanceof Error) throw next
          return next
        }
      }
    })
  }

  before(async () => {
    for (const name of ENV_NAMES) { SAVED_ENV[name] = process.env[name]; delete process.env[name] }
    process.env.AGORA_VERSION = 'abc1234'
    await setup.clearDb()
    amara = await new User({ name: 'Amara Okafor', email: 'amara@agora.test', active: true, email_validated: true }).save()
    lars = await new User({ name: 'Lars', email: 'lars@agora.test', active: true, email_validated: true }).save()
    guy = await new User({ name: 'Guy', email: 'guy@agora.test', active: true, email_validated: true }).save()
    unconfirmed = await new User({ name: 'Not confirmed', email: 'boss@agora.test', active: true, email_validated: false }).save()
    sleeping = await new User({ name: 'Gone', email: 'gone@agora.test', active: false, email_validated: true }).save()
    process.env.AGORA_HELPDESK_ADMINS = `${guy.id}, boss@agora.test, GONE@agora.test`
  })

  after(() => {
    HelpClaude.useClientForTests(null)
    for (const name of ENV_NAMES) {
      if (SAVED_ENV[name] === undefined) delete process.env[name]
      else process.env[name] = SAVED_ENV[name]
    }
  })

  beforeEach(async () => {
    HelpClaude.useClientForTests(null)
    Help.resetChatLimits()
    await knex()('agora_help_chats').del()
    await knex()('agora_help_replies').del()
    await knex()('agora_help_requests').del()
  })

  describe('who gets in', () => {
    it('needs a login for every action', async () => {
      // The tests lift Sails without its policies, so read the file afresh.
      const file = require.resolve('../../../config/policies')
      delete require.cache[file]
      const rules = require(file).policies.AgoraHelpController
      expect(rules).to.deep.equal({ '*': 'sessionAuth' })
      // and every action refuses too, should the policy ever be changed
      for (const action of Object.keys(AgoraHelpController)) {
        const res = await call(action, { params: { requestId: '1' } })
        expect(res.statusCode, action).to.equal(401)
      }
    })

    it('knows Help desk admins by id, or by a confirmed email address of an active account', async () => {
      expect(await Help.isAdmin(guy.id)).to.equal(true)
      expect(await Help.isAdmin(amara.id)).to.equal(false)
      expect(await Help.isAdmin(unconfirmed.id)).to.equal(false)
      expect(await Help.isAdmin(sleeping.id)).to.equal(false)
      const saved = process.env.AGORA_HELPDESK_ADMINS
      try {
        process.env.AGORA_HELPDESK_ADMINS = 'AMARA@agora.test'
        expect(await Help.isAdmin(amara.id)).to.equal(true)
        process.env.AGORA_HELPDESK_ADMINS = ''
        expect(await Help.isAdmin(guy.id)).to.equal(false)
      } finally {
        process.env.AGORA_HELPDESK_ADMINS = saved
      }
    })

    it('also lets Agora admins (AGORA_ADMINS) run the Help desk, with the same rules', async () => {
      const saved = process.env.AGORA_HELPDESK_ADMINS
      try {
        process.env.AGORA_HELPDESK_ADMINS = ''
        process.env.AGORA_ADMINS = `${lars.id}, boss@agora.test, gone@agora.test`
        expect(await Help.isAdmin(lars.id)).to.equal(true)
        expect(await Help.isAdmin(unconfirmed.id)).to.equal(false)
        expect(await Help.isAdmin(sleeping.id)).to.equal(false)
        expect(await Help.isAdmin(guy.id)).to.equal(false)
        // Both lists together
        process.env.AGORA_HELPDESK_ADMINS = String(guy.id)
        expect(await Help.isAdmin(guy.id)).to.equal(true)
        expect(await Help.isAdmin(lars.id)).to.equal(true)
        expect(await Help.isAdmin(amara.id)).to.equal(false)
      } finally {
        process.env.AGORA_HELPDESK_ADMINS = saved
        delete process.env.AGORA_ADMINS
      }
    })

    it('tells the Help window whether Claude is on and whether this person runs the Help desk', async () => {
      const member = await call('status', { userId: amara.id })
      expect(member.body).to.include({ claude: false, isAdmin: false, unread: 0 })
      const admin = await call('status', { userId: guy.id })
      expect(admin.body.isAdmin).to.equal(true)
    })

    it('refuses changes that do not come from the page itself', async () => {
      const res = await call('create', { userId: amara.id, fromPage: false, body: { what_happened: 'Forged' } })
      expect(res.statusCode).to.equal(400)
      const count = await knex()('agora_help_requests').count('id as n').first()
      expect(Number(count.n)).to.equal(0)
    })
  })

  describe('the plain form', () => {
    it('saves a request with the page, browser, screen and version, without the query of the address', async () => {
      const res = await sendForm(amara.id, { type: 'wish', urgency: 'urgent', what_expected: 'It saves' })
      expect(res.statusCode).to.equal(undefined)
      const row = await knex()('agora_help_requests').where({ id: res.body.id }).first()
      expect(row).to.include({
        user_id: String(amara.id),
        status: 'new',
        type: 'wish',
        urgency: 'urgent',
        mode: 'form',
        title: 'The save button does nothing',
        what_expected: 'It saves',
        page_url: 'https://agora.example.org/groups/7bp/playbook',
        user_agent: 'Mozilla/5.0 (Test)',
        screen: '1440x900 @2x',
        app_version: 'abc1234',
        unread_by_desk: true
      })
    })

    it('says what is wrong with a request that cannot be saved', async () => {
      expect((await call('create', { userId: amara.id, body: {} })).statusCode).to.equal(400)
      expect((await sendForm(amara.id, { type: 'complaint' })).statusCode).to.equal(400)
      expect((await sendForm(amara.id, { what_happened: 'x'.repeat(5001) })).statusCode).to.equal(400)
      expect((await sendForm(amara.id, { context: { page: 'javascript:alert(1)' } })).statusCode).to.equal(undefined)
      const row = await knex()('agora_help_requests').first()
      expect(row.page_url).to.equal(null)
    })

    it('limits how many requests one person sends in a day', async () => {
      process.env.AGORA_HELP_REQUESTS_PER_DAY = '2'
      try {
        await sendForm(amara.id)
        await sendForm(amara.id)
        expect((await sendForm(amara.id)).statusCode).to.equal(429)
        expect((await sendForm(lars.id)).statusCode).to.equal(undefined)
      } finally {
        delete process.env.AGORA_HELP_REQUESTS_PER_DAY
      }
    })
  })

  describe('my requests', () => {
    it('shows people only their own requests', async () => {
      const mine = (await sendForm(amara.id)).body.id
      await sendForm(lars.id, { what_happened: 'Lars has a problem' })
      const list = await call('mine', { userId: amara.id })
      expect(list.body.requests.map(r => r.id)).to.deep.equal([mine])

      const own = await call('showMine', { userId: amara.id, params: { requestId: mine } })
      expect(own.body.request.what_happened).to.equal('The save button does nothing')

      const other = await call('showMine', { userId: lars.id, params: { requestId: mine } })
      expect(other.statusCode).to.equal(404)
      const answer = await call('replyMine', { userId: lars.id, params: { requestId: mine }, body: { body: 'Sneaky' } })
      expect(answer.statusCode).to.equal(404)
      const strange = await call('showMine', { userId: amara.id, params: { requestId: '1 or 1=1' } })
      expect(strange.statusCode).to.equal(404)
    })

    it('never shows the person the internal note or the builder task', async () => {
      const id = (await sendForm(amara.id)).body.id
      await call('deskUpdate', { userId: guy.id, params: { requestId: id }, body: { internal_note: 'Probably the old browser', builder_task: 'Fix it' } })
      const own = await call('showMine', { userId: amara.id, params: { requestId: id } })
      expect(own.body.request).not.to.have.property('internal_note')
      expect(own.body.request).not.to.have.property('builder_task')
      expect(own.body.request).not.to.have.property('builder_task_link')
      expect(own.body.request).not.to.have.property('user_agent')
    })

    it('lets the person add to their own request, which the Help desk then sees as new', async () => {
      const id = (await sendForm(amara.id)).body.id
      await call('deskShow', { userId: guy.id, params: { requestId: id } })
      const res = await call('replyMine', { userId: amara.id, params: { requestId: id }, body: { body: 'It happens on my phone too' } })
      expect(res.statusCode).to.equal(undefined)
      const row = await knex()('agora_help_requests').where({ id }).first()
      expect(row.unread_by_desk).to.equal(true)
    })
  })

  describe('the Help desk', () => {
    it('is closed to everyone who is not a Help desk admin', async () => {
      const id = (await sendForm(amara.id)).body.id
      for (const userId of [amara.id, lars.id, unconfirmed.id, sleeping.id]) {
        expect((await call('deskList', { userId })).statusCode).to.equal(403)
        expect((await call('deskShow', { userId, params: { requestId: id } })).statusCode).to.equal(403)
        expect((await call('deskUpdate', { userId, params: { requestId: id }, body: { status: 'fixed' } })).statusCode).to.equal(403)
        expect((await call('deskReply', { userId, params: { requestId: id }, body: { body: 'Hi' } })).statusCode).to.equal(403)
        expect((await call('deskBuild', { userId, params: { requestId: id }, body: { task: 'Do it' } })).statusCode).to.equal(403)
      }
      const row = await knex()('agora_help_requests').where({ id }).first()
      expect(row.status).to.equal('new')
      expect(row.builder_task).to.equal(null)
      const replies = await knex()('agora_help_replies').count('id as n').first()
      expect(Number(replies.n)).to.equal(0)
    })

    it('lists every request with filters by status and type, and counts per status', async () => {
      const fault = (await sendForm(amara.id)).body.id
      const wish = (await sendForm(lars.id, { type: 'wish' })).body.id
      await call('deskUpdate', { userId: guy.id, params: { requestId: wish }, body: { status: 'looking' } })

      const all = await call('deskList', { userId: guy.id })
      expect(all.body.requests.map(r => r.id).sort()).to.deep.equal([fault, wish].sort())
      expect(all.body.counts).to.include({ new: 1, looking: 1, fixed: 0 })
      const wishes = await call('deskList', { userId: guy.id, query: { type: 'wish' } })
      expect(wishes.body.requests.map(r => r.id)).to.deep.equal([wish])
      const fresh = await call('deskList', { userId: guy.id, query: { status: 'new' } })
      expect(fresh.body.requests.map(r => r.id)).to.deep.equal([fault])
      expect((await call('deskList', { userId: guy.id, query: { status: 'gone' } })).statusCode).to.equal(400)
    })

    it('shows a request with who sent it, and changes its status and note', async () => {
      const id = (await sendForm(amara.id)).body.id
      const shown = await call('deskShow', { userId: guy.id, params: { requestId: id } })
      expect(shown.body.request.person).to.deep.equal({ id: String(amara.id), name: 'Amara Okafor', email: 'amara@agora.test' })
      expect(shown.body.request.user_agent).to.equal('Mozilla/5.0 (Test)')

      const res = await call('deskUpdate', { userId: guy.id, params: { requestId: id }, body: { status: 'fixed', internal_note: 'Fixed in #20', builder_task_link: 'github.com/Guyvk/agora/issues/1' } })
      expect(res.statusCode).to.equal(undefined)
      const row = await knex()('agora_help_requests').where({ id }).first()
      expect(row).to.include({ status: 'fixed', internal_note: 'Fixed in #20', builder_task_link: 'https://github.com/Guyvk/agora/issues/1', unread_by_user: true })

      expect((await call('deskUpdate', { userId: guy.id, params: { requestId: id }, body: { status: 'deleted' } })).statusCode).to.equal(400)
      expect((await call('deskUpdate', { userId: guy.id, params: { requestId: id }, body: { builder_task_link: 'javascript:alert(1)' } })).statusCode).to.equal(400)
      expect((await call('deskShow', { userId: guy.id, params: { requestId: '999999' } })).statusCode).to.equal(404)
    })

    it('replies to the person, who sees it in My requests and gets an email', async () => {
      const id = (await sendForm(amara.id)).body.id
      const emails = []
      const result = await Help.deskReply(guy.id, id, 'Thanks, we are looking at it', { sendEmail: async options => { emails.push(options); return true } })
      expect(result.emailed).to.equal(true)
      expect(emails).to.have.length(1)
      expect(emails[0].recipient.address).to.equal('amara@agora.test')
      expect(emails[0].email_id).to.equal('agora_help_reply')
      expect(emails[0].email_data.url).to.match(new RegExp(`/\\?help=${id}$`))

      const status = await call('status', { userId: amara.id })
      expect(status.body.unread).to.equal(1)
      const list = await call('mine', { userId: amara.id })
      expect(list.body.requests[0].unread).to.equal(true)
      const own = await call('showMine', { userId: amara.id, params: { requestId: id } })
      expect(own.body.request.replies.map(r => [r.body, r.from_desk, r.author_name])).to.deep.equal([['Thanks, we are looking at it', true, 'Guy']])
      expect((await call('status', { userId: amara.id })).body.unread).to.equal(0)
    })

    it('has an email text for a reply', () => {
      const email = mailer.TEMPLATES.agora_help_reply({ title: 'Save button', reply: 'Fixed <b>now</b>', url: 'https://agora.example.org/?help=4' })
      expect(email.subject).to.equal('An answer to your request: Save button')
      expect(email.text).to.contain('Fixed <b>now</b>')
      expect(email.html).to.contain('Fixed &lt;b&gt;now&lt;/b&gt;')
      expect(email.html).to.contain('https://agora.example.org/?help=4')
    })

    it('sends no email when that is switched off', async () => {
      const id = (await sendForm(amara.id)).body.id
      process.env.AGORA_HELP_REPLY_EMAIL = 'off'
      try {
        let asked = false
        const result = await Help.deskReply(guy.id, id, 'Hi', { sendEmail: async () => { asked = true; return true } })
        expect(asked).to.equal(false)
        expect(result.emailed).to.equal(false)
      } finally {
        delete process.env.AGORA_HELP_REPLY_EMAIL
      }
    })
  })

  describe('Build this', () => {
    it('stores a task the admin typed and marks the request as building', async () => {
      const id = (await sendForm(amara.id)).body.id
      const res = await call('deskBuild', { userId: guy.id, params: { requestId: id }, body: { task: 'Goal: the save button saves.' } })
      expect(res.body).to.include({ by: 'admin', builder_task: 'Goal: the save button saves.', warning: null })
      const row = await knex()('agora_help_requests').where({ id }).first()
      expect(row).to.include({ status: 'building', builder_task: 'Goal: the save button saves.' })
    })

    it('warns when a typed task names the person', async () => {
      const id = (await sendForm(amara.id)).body.id
      const res = await call('deskBuild', { userId: guy.id, params: { requestId: id }, body: { task: 'Amara cannot save' } })
      expect(res.body.warning).to.match(/name the person/)
    })

    it('without a typed task, needs a Claude key', async () => {
      const id = (await sendForm(amara.id)).body.id
      const res = await call('deskBuild', { userId: guy.id, params: { requestId: id }, body: {} })
      expect(res.statusCode).to.equal(400)
      expect(res.body.error).to.match(/no Claude key/)
    })

    it('never sends a request from the plain form to Claude', async () => {
      pretendClaude()
      const id = (await sendForm(amara.id)).body.id
      const res = await call('deskBuild', { userId: guy.id, params: { requestId: id }, body: {} })
      expect(res.statusCode).to.equal(400)
      expect(res.body.error).to.match(/plain form/)
      expect(sent).to.have.length(0)
    })
  })

  describe('chat with Claude', () => {
    const chat = (userId, body) => call('chat', { userId, body: { context, ...body } })
    const textAnswer = text => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'sig-1' }, { type: 'text', text }] })
    const fileAnswer = input => ({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Thanks, I passed it on to the team.' },
        { type: 'tool_use', id: 'toolu_1', name: 'file_request', input }
      ]
    })

    it('is off without a Claude key, and the Help window uses the form', async () => {
      const res = await chat(amara.id, { message: 'How do I join a circle?' })
      expect(res.body).to.deep.equal({ fallback: true, reason: 'off' })
    })

    it('answers a question, and sends earlier answers back unchanged', async () => {
      pretendClaude()
      answers.push(textAnswer('Ask a steward for an invitation.'), textAnswer('You are welcome.'))
      const first = await chat(amara.id, { message: 'How do I join a circle?' })
      expect(first.body).to.include({ reply: 'Ask a steward for an invitation.', filed: null })
      expect(first.body.chatId).to.match(/^\d+$/)

      expect(sent[0].model).to.equal('claude-haiku-5-5')
      expect(sent[0].tools[0].name).to.equal('file_request')
      expect(sent[0].system[0].text).to.contain('<guide>')
      expect(sent[0].system[0].text).to.contain('Agora is by invitation. A steward of a circle invites you')
      expect(sent[0].messages).to.deep.equal([{ role: 'user', content: '[I am on the page /groups/7bp/playbook]\n\nHow do I join a circle?' }])

      const second = await chat(amara.id, { chatId: first.body.chatId, message: 'Thanks' })
      expect(second.body.reply).to.equal('You are welcome.')
      expect(sent[1].messages).to.deep.equal([
        { role: 'user', content: '[I am on the page /groups/7bp/playbook]\n\nHow do I join a circle?' },
        { role: 'assistant', content: textAnswer('Ask a steward for an invitation.').content },
        { role: 'user', content: 'Thanks' }
      ])
      const count = await knex()('agora_help_requests').count('id as n').first()
      expect(Number(count.n)).to.equal(0)
    })

    describe('the guide', () => {
      const savedGuideFile = process.env.AGORA_HELP_GUIDE_FILE
      beforeEach(() => { delete process.env.AGORA_HELP_GUIDE_FILE })
      after(() => { if (savedGuideFile === undefined) delete process.env.AGORA_HELP_GUIDE_FILE; else process.env.AGORA_HELP_GUIDE_FILE = savedGuideFile })

      it('answers from the same guide members read, part by part in order, then the Help desk notes', () => {
        const parts = require('../../../../web/src/agora/guide/guideParts.json').parts
        const english = require('../../../../web/public/locales/en.json')
        const prompt = HelpClaude.systemPrompt()
        const guideText = prompt.slice(prompt.indexOf('<guide>'), prompt.indexOf('</guide>'))
        let last = -1
        parts.forEach(part => {
          const at = guideText.indexOf(`## ${english[part.title]} (/guide#${part.id})`)
          expect(at, part.id).to.be.above(last)
          last = at
          part.blocks.filter(b => b.text).forEach(b => expect(guideText).to.contain(english[b.text]))
        })
        expect(guideText).to.contain('Coming soon: A guest link')
        expect(guideText).to.contain('- Link: Open Contacts (/contacts)')
        // The notes come after the guide, and do not repeat it
        const notes = guideText.indexOf('# More notes for Help')
        expect(notes).to.be.above(last)
        expect(guideText).to.contain('Forgot password?')
        expect(guideText).not.to.contain('Click Help at the bottom right')
      })

      it('answers from AGORA_HELP_GUIDE_FILE instead, when it is set', () => {
        const file = require('path').join(require('os').tmpdir(), `agora-help-guide-${process.pid}.md`)
        require('fs').writeFileSync(file, 'Our own guide: the tea is in the kitchen.')
        process.env.AGORA_HELP_GUIDE_FILE = file
        try {
          const prompt = HelpClaude.systemPrompt()
          expect(prompt).to.contain('Our own guide: the tea is in the kitchen.')
          expect(prompt).not.to.contain('Agora is by invitation')
        } finally {
          delete process.env.AGORA_HELP_GUIDE_FILE
          require('fs').unlinkSync(file)
        }
        expect(HelpClaude.systemPrompt()).to.contain('Agora is by invitation')
      })
    })

    it('uses the model in AGORA_HELP_MODEL', async () => {
      pretendClaude()
      answers.push(textAnswer('Hi'))
      process.env.AGORA_HELP_MODEL = 'claude-sonnet-5-5'
      try {
        await chat(amara.id, { message: 'Hello' })
        expect(sent[0].model).to.equal('claude-sonnet-5-5')
      } finally {
        delete process.env.AGORA_HELP_MODEL
      }
    })

    it('files a request with the whole conversation when Claude decides to', async () => {
      pretendClaude()
      answers.push(
        textAnswer('Which page were you on?'),
        fileAnswer({ type: 'fault', urgency: 'urgent', title: 'Playbook save fails', summary: 'Saving a chapter does nothing.' })
      )
      const first = await chat(amara.id, { message: 'Saving does not work' })
      const second = await chat(amara.id, { chatId: first.body.chatId, message: 'The playbook page' })
      expect(second.body.filed.title).to.equal('Playbook save fails')
      expect(second.body.reply).to.equal('Thanks, I passed it on to the team.')

      const row = await knex()('agora_help_requests').where({ id: second.body.filed.id }).first()
      expect(row).to.include({
        user_id: String(amara.id),
        mode: 'chat',
        type: 'fault',
        urgency: 'urgent',
        title: 'Playbook save fails',
        summary: 'Saving a chapter does nothing.',
        page_url: 'https://agora.example.org/groups/7bp/playbook',
        app_version: 'abc1234'
      })
      expect(row.conversation.map(m => [m.role, m.text])).to.deep.equal([
        ['person', 'Saving does not work'],
        ['claude', 'Which page were you on?'],
        ['person', 'The playbook page'],
        ['claude', 'Thanks, I passed it on to the team.']
      ])

      // The chat has ended: a new message needs a new chat.
      const after = await chat(amara.id, { chatId: first.body.chatId, message: 'And another thing' })
      expect(after.statusCode).to.equal(404)
    })

    it('keeps each chat to the person who started it', async () => {
      pretendClaude()
      answers.push(textAnswer('Hello Amara'))
      const first = await chat(amara.id, { message: 'Hi' })
      const res = await chat(lars.id, { chatId: first.body.chatId, message: 'Show me' })
      expect(res.statusCode).to.equal(404)
      expect(sent).to.have.length(1)
    })

    it('falls back to the form when Claude cannot be reached or declines', async () => {
      pretendClaude()
      const failure = new Error('overloaded')
      failure.status = 529
      answers.push(failure, { stop_reason: 'refusal', content: [] })
      expect((await chat(amara.id, { message: 'Hi' })).body).to.deep.equal({ fallback: true, reason: 'error' })
      expect((await chat(amara.id, { message: 'Hi' })).body).to.deep.equal({ fallback: true, reason: 'error' })
    })

    it('limits how many chat messages one person sends in an hour', async () => {
      pretendClaude()
      process.env.AGORA_HELP_CHAT_PER_HOUR = '2'
      try {
        answers.push(textAnswer('One'), textAnswer('Two'), textAnswer('Lars'))
        await chat(amara.id, { message: '1' })
        await chat(amara.id, { message: '2' })
        expect((await chat(amara.id, { message: '3' })).body).to.deep.equal({ fallback: true, reason: 'limit' })
        expect((await chat(lars.id, { message: '1' })).body.reply).to.equal('Lars')
        expect(sent).to.have.length(3)
      } finally {
        delete process.env.AGORA_HELP_CHAT_PER_HOUR
      }
    })

    it('lets Claude write the builder task of a chat request, without the person\'s name or email', async () => {
      pretendClaude()
      answers.push(fileAnswer({ type: 'wish', urgency: 'low', title: 'Amara wants dark mode', summary: 'Amara Okafor (amara@agora.test) wants a dark mode.' }))
      const filed = (await chat(amara.id, { message: 'I am Amara Okafor and I want dark mode' })).body.filed
      answers.push({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Goal: offer a dark mode. Asked by Amara.' }] })

      const res = await call('deskBuild', { userId: guy.id, params: { requestId: filed.id }, body: {} })
      expect(res.statusCode).to.equal(undefined)
      expect(res.body.by).to.equal('claude')
      expect(res.body.builder_task).to.equal('Goal: offer a dark mode. Asked by the member.')
      const toClaude = JSON.stringify(sent[1])
      expect(toClaude).not.to.match(/amara/i)
      expect(toClaude).not.to.contain('Okafor')
      const row = await knex()('agora_help_requests').where({ id: filed.id }).first()
      expect(row.status).to.equal('building')
    })
  })
})
