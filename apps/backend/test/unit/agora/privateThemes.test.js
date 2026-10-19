/* eslint-env mocha */
/**
 * Agora: what Ask may learn from private messages (lib/agora/privateThemes.js).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep. Infomaniak is never called: a pretend service
 * stands in for it.
 */
import Ask from '../../../lib/agora/ask'
import AskIndex from '../../../lib/agora/askIndex'
import AI from '../../../lib/agora/infomaniakAI'
import PrivateThemes from '../../../lib/agora/privateThemes'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))

const ENV_NAMES = ['AGORA_ASK_ENABLED', 'AGORA_AI_KEY', 'AGORA_AI_PRODUCT_ID', 'AGORA_AI_URL_BASE', 'AGORA_ASK_PRIVATE_THEMES', 'AGORA_ASK_VECTOR', 'AGORA_ASK_MONTHLY_CAP']
const SAVED_ENV = {}

const AMARA_SECRET = 'I honestly think the travel refunds take forever and the form is confusing'
const LARS_SECRET = 'the travel refund form is far too confusing for new volunteers to finish'

let calls, themeAnswer, checkFlags, answer
function pretendInfomaniak () {
  calls = []
  AI.useFetchForTests(async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({ url, body })
    let data
    if (url.endsWith('/embeddings')) {
      data = { data: body.input.map((t, i) => ({ index: i, embedding: [1, 0, 0, 0] })), usage: { total_tokens: 5 } }
    } else if (url.endsWith('/chat/completions')) {
      const system = body.messages[0].content
      let content
      if (system.includes('THEMES')) content = JSON.stringify(themeAnswer)
      else if (system.includes('You check statements')) content = JSON.stringify({ identifies: checkFlags.some(f => body.messages[1].content.includes(f)) })
      else content = answer
      data = { model: body.model, choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }
    } else {
      data = { results: [], usage: { total_tokens: 0 } }
    }
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }
  })
}
const chats = () => calls.filter(c => c.url.endsWith('/chat/completions'))
const text = c => c.body.messages.map(m => m.content).join('\n')

describe('Agora Ask private themes', () => {
  let amara, lars, kenji, circle, other
  const knex = () => bookshelf.knex

  async function thread (people, messages) {
    const [t] = await knex()('posts').insert({ type: 'thread', active: true, user_id: people[0].id, created_at: new Date(), updated_at: new Date() }).returning('id')
    const id = t.id || t
    for (const [user, message] of messages) {
      await knex()('comments').insert({ post_id: id, user_id: user.id, text: `<p>${message}</p>`, active: true, created_at: new Date() })
    }
    return id
  }

  before(async () => {
    for (const name of ENV_NAMES) { SAVED_ENV[name] = process.env[name]; delete process.env[name] }
    process.env.AGORA_ASK_ENABLED = 'on'
    process.env.AGORA_AI_KEY = 'pretend-key'
    process.env.AGORA_AI_PRODUCT_ID = '999999'
    process.env.AGORA_ASK_VECTOR = 'off'
    await setup.clearDb()
    AskIndex.forgetVectorCheck()
    amara = await new User({ name: 'Amara Okafor', email: 'amara@agora.test', active: true }).save()
    lars = await new User({ name: 'Lars Berg', email: 'lars@agora.test', active: true }).save()
    kenji = await new User({ name: 'Kenji Sato', email: 'kenji@agora.test', active: true }).save()
    circle = await new Group({ slug: 'finance', name: 'Finance', active: true }).save()
    other = await new Group({ slug: 'care', name: 'Care', active: true }).save()
    await amara.joinGroup(circle)
    await lars.joinGroup(circle)
    await kenji.joinGroup(other)
    await kenji.joinGroup(circle)
    const [p] = await knex()('posts').insert({ type: 'discussion', name: 'Travel refunds', description: '<p>How travel refunds work.</p>', active: true, user_id: lars.id, created_at: new Date(), updated_at: new Date() }).returning('id')
    await knex()('groups_posts').insert({ post_id: p.id || p, group_id: circle.id })

    await thread([amara, lars], [
      [amara, `${AMARA_SECRET}. Mail me at amara.private@example.org or call +41 79 123 45 67.`],
      [lars, `Agreed, ${LARS_SECRET}. Kenji Sato said the same.`]
    ])
    await thread([kenji, amara], [[kenji, 'My back hurts and I may be away for a while, please keep it quiet.']])
  })

  after(() => {
    AI.useFetchForTests(null)
    for (const name of ENV_NAMES) {
      if (SAVED_ENV[name] === undefined) delete process.env[name]
      else process.env[name] = SAVED_ENV[name]
    }
  })

  beforeEach(() => {
    pretendInfomaniak()
    checkFlags = ['FLAGME']
    answer = 'Members find the travel refund process unclear [1].'
  })

  describe('the fixed checks', () => {
    const names = PrivateThemes.namePatterns(['Amara Okafor', 'Lars Berg', 'Guy van Koolwijk'])

    it('takes out email addresses, phone numbers, web addresses, @mentions and member names', () => {
      const out = PrivateThemes.redactText('Ask Amara (amara@example.org, +41 79 123 45 67, https://x.example/a) or @lars, or Lars Berg, or Guy.', names)
      expect(out).not.to.match(/amara@|123 45|https|@lars|Lars|Amara|Guy/)
      expect(out).to.include('[email]')
    })

    it('leaves ordinary words alone that happen to be a name in lower case', () => {
      expect(PrivateThemes.redactText('a nice guy said so', names)).to.equal('a nice guy said so')
    })

    it('drops a theme that copies more than six words in a row from a message, and strips quotes', () => {
      expect(PrivateThemes.cleanTheme('Members say the travel refund form is far too confusing for new volunteers', { namesRegex: names, messages: [LARS_SECRET] })).to.equal(null)
      expect(PrivateThemes.cleanTheme('Members find refunds slow "it takes forever" and unclear', { namesRegex: names, messages: [] }))
        .to.equal('Members find refunds slow and unclear')
      expect(PrivateThemes.cleanTheme('Lars Berg thinks refunds are slow and unclear', { namesRegex: names })).to.equal('a member thinks refunds are slow and unclear')
    })

    it('keeps a theme from two people, or one clearly about the work, and drops a personal one from one person', () => {
      expect(PrivateThemes.keepTheme({ sourceCount: 2, aboutWork: false })).to.equal(true)
      expect(PrivateThemes.keepTheme({ sourceCount: 1, aboutWork: true })).to.equal(true)
      expect(PrivateThemes.keepTheme({ sourceCount: 1, aboutWork: false })).to.equal(false)
    })
  })

  describe('making themes', () => {
    before(async () => {
      pretendInfomaniak()
      checkFlags = ['FLAGME']
      themeAnswer = {
        themes: [
          { theme: 'Several members find the travel refund process slow and unclear.', people: ['Person 1', 'Person 2'], circles: [String(circle.id), String(other.id)], about_work: true },
          { theme: 'One member has health problems and may be away.', people: ['Person 3'], circles: [], about_work: false },
          { theme: 'Members say the travel refund form is far too confusing for new volunteers.', people: ['Person 1', 'Person 2'], circles: [String(circle.id)], about_work: true },
          { theme: 'FLAGME the treasurer from Zurich is unhappy.', people: ['Person 1', 'Person 2'], circles: [String(circle.id)], about_work: true },
          { theme: 'Person 9 wants a new logo for the movement.', people: ['Person 9'], circles: [], about_work: false }
        ]
      }
      await PrivateThemes.refreshThemes()
    })

    it('sends the AI no names, email addresses or phone numbers, only Person 1, Person 2', () => {
      const prompt = text(chats().find(c => c.body.messages[0].content.includes('THEMES')))
      expect(prompt).to.include('Person 1')
      for (const bad of ['Amara', 'Okafor', 'Lars', 'Kenji', 'amara.private@example.org', '123 45 67']) expect(prompt, bad).not.to.include(bad)
    })

    it('keeps only the theme that passed every check, without links to people or messages', async () => {
      const themes = await knex()('agora_private_themes').select('*')
      expect(themes.map(t => t.theme)).to.deep.equal(['Several members find the travel refund process slow and unclear.'])
      expect(themes[0].source_count).to.equal(2)
      // Circle "Care" is not shared by Person 1 and Person 2, so the theme does not go there
      expect(themes[0].group_ids.map(String)).to.deep.equal([String(circle.id)])
      expect(Object.keys(themes[0]).sort()).to.deep.equal(['created_at', 'group_ids', 'id', 'source_count', 'theme', 'updated_at'])
    })

    it('indexes the theme in its circle only, without a link or author, and never a raw message', async () => {
      const pieces = await knex()('agora_knowledge_chunks').where('source_type', 'private_theme')
      expect(pieces).to.have.length(1)
      expect(String(pieces[0].group_id)).to.equal(String(circle.id))
      expect(pieces[0].url).to.equal(null)
      expect(pieces[0].author_id).to.equal(null)
      expect(pieces[0].title).to.equal(PrivateThemes.THEME_LABEL)
      const all = await knex()('agora_knowledge_chunks').pluck('text')
      expect(all.join('\n')).not.to.include('travel refunds take forever')
      expect(all.join('\n')).not.to.include('back hurts')
    })

    it('uses the theme in answers as "From private conversations (anonymised)", without a link, and no raw message reaches the prompt', async () => {
      const result = await Ask.ask(amara.id, 'finance', 'What do people think about travel refunds?')
      const prompt = text(chats()[chats().length - 1])
      expect(prompt).to.include('From private conversations (anonymised)')
      expect(prompt).to.include('Never quote it')
      expect(prompt).not.to.include(AMARA_SECRET)
      expect(prompt).not.to.include(LARS_SECRET)
      expect(prompt).not.to.include('back hurts')
      const theme = result.sources.find(s => s.type === 'private_theme')
      if (theme) {
        expect(theme.url).to.equal(null)
        expect(theme.title).to.equal('From private conversations (anonymised)')
      }
    })

    it('removes all themes when switched off', async () => {
      process.env.AGORA_ASK_PRIVATE_THEMES = 'off'
      try {
        await PrivateThemes.refreshThemes()
        expect(await knex()('agora_private_themes')).to.have.length(0)
        expect(await knex()('agora_knowledge_chunks').where('source_type', 'private_theme')).to.have.length(0)
      } finally {
        delete process.env.AGORA_ASK_PRIVATE_THEMES
      }
    })
  })

  describe('the check on every answer', () => {
    it('removes a sentence that copies a private message of someone else', async () => {
      const out = await PrivateThemes.scrubAnswer(`Refunds are discussed [1]. Someone wrote that ${LARS_SECRET}. That is all.`, amara.id)
      expect(out.removed).to.equal(1)
      expect(out.text).not.to.include('far too confusing')
      expect(out.text).to.include('Refunds are discussed [1].')
      expect(out.text).to.include('That is all.')
    })

    it('leaves a sentence that copies the asker\'s own message', async () => {
      const out = await PrivateThemes.scrubAnswer(`You wrote that ${LARS_SECRET}.`, lars.id)
      expect(out.removed).to.equal(0)
    })

    it('runs on answers too', async () => {
      answer = `People say ${AMARA_SECRET} [1].`
      const result = await Ask.ask(lars.id, 'finance', 'What do people think about travel refunds?')
      expect(result.answer || '').not.to.include('take forever')
    })
  })
})
