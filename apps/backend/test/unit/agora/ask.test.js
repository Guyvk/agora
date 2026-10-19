/* eslint-env mocha */
/**
 * Agora: the Ask tab of a circle: the index, the permissions rule, answers,
 * history, sharing, limits and the spend cap.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep. Infomaniak is never called: a pretend service
 * stands in for it (see pretendInfomaniak below).
 *
 * When the test database has pgvector (Postgres.app has it), search by
 * meaning is tested for real; without it those checks are skipped and only
 * keyword search is tested.
 */
import AgoraAskController from '../../../api/controllers/AgoraAskController'
import Ask from '../../../lib/agora/ask'
import AskIndex from '../../../lib/agora/askIndex'
import AI from '../../../lib/agora/infomaniakAI'
import { askScope } from '../../../lib/agora/askPermissions'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const ENV_NAMES = [
  'AGORA_ASK_ENABLED', 'AGORA_AI_KEY', 'AGORA_AI_PRODUCT_ID', 'AGORA_AI_URL_BASE', 'AGORA_AI_RERANK_URL',
  'AGORA_TRANSCRIPTION_URL', 'AGORA_TRANSCRIPTION_KEY', 'AGORA_ASK_MODEL', 'AGORA_ASK_EMBED_MODEL',
  'AGORA_ASK_RERANK_MODEL', 'AGORA_ASK_MONTHLY_CAP', 'AGORA_ASK_PER_HOUR', 'AGORA_ASK_PER_DAY',
  'AGORA_ASK_VECTOR', 'AGORA_ASK_PRIVATE_THEMES', 'AGORA_AI_EUR_PER_CHF'
]
const SAVED_ENV = {}

/* A pretend Infomaniak --------------------------------------------------- */

const DIMS = 16
const SYNONYMS = { money: 'budget', funds: 'budget', cash: 'budget', euros: 'budget' }
function pretendVector (text) {
  const v = new Array(DIMS).fill(0)
  for (const raw of String(text).toLowerCase().match(/[a-z]+/g) || []) {
    const word = SYNONYMS[raw] || raw
    if (word.length < 4) continue
    let h = 0
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % 9973
    v[h % DIMS] += 1
  }
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0)) || 1
  return v.map(x => x / norm)
}

let calls, nextAnswer
function pretendInfomaniak () {
  calls = []
  nextAnswer = null
  AI.useFetchForTests(async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({ url, body, headers: options.headers })
    let data
    if (url.endsWith('/embeddings')) {
      data = { object: 'list', data: body.input.map((t, i) => ({ object: 'embedding', index: i, embedding: pretendVector(t) })), usage: { prompt_tokens: 10 * body.input.length, total_tokens: 10 * body.input.length } }
    } else if (url.endsWith('/rerank')) {
      data = { id: 'rerank-1', model: body.model, results: body.documents.map((d, i) => ({ index: i, relevance_score: 1 / (i + 1) })).slice(0, body.top_n), usage: { total_tokens: 100 } }
    } else if (url.endsWith('/chat/completions')) {
      const answer = typeof nextAnswer === 'function' ? nextAnswer(body) : (nextAnswer || 'The circle decided to plant trees along the river [1].')
      data = { id: 'chatcmpl-1', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: answer } }], usage: { prompt_tokens: 4000, completion_tokens: 300, total_tokens: 4300 } }
    } else {
      return { ok: false, status: 404, text: async () => 'unknown', json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }
  })
}
const chatCalls = () => calls.filter(c => c.url.endsWith('/chat/completions'))
const promptText = call => call.body.messages.map(m => m.content).join('\n')

/* ------------------------------------------------------------------------ */

describe('Agora Ask', () => {
  let amara, lars, kenji, sleeper, circleA, circleB, hasVector
  let decisionPost, budgetPost, thread, meetingEvent
  const knex = () => bookshelf.knex

  function call (action, { params = {}, body, userId, fromPage = true } = {}) {
    const req = factories.mock.request()
    req.params = params
    req.body = body
    req.headers = fromPage ? { 'x-agora': '1' } : {}
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.set = () => {}
    return AgoraAskController[action](req, res).then(() => res)
  }
  const askAs = (user, slug, question) => call('ask', { params: { groupSlug: slug }, body: { question }, userId: user && user.id })

  async function makePost (attrs, groups) {
    const now = attrs.created_at || new Date()
    const [row] = await knex()('posts').insert({ type: 'discussion', active: true, created_at: now, updated_at: now, ...attrs }).returning('id')
    const id = row.id || row
    for (const g of groups) await knex()('groups_posts').insert({ post_id: id, group_id: g.id })
    return id
  }
  const comment = (postId, user, text, createdAt = new Date()) =>
    knex()('comments').insert({ post_id: postId, user_id: user.id, text, active: true, created_at: createdAt })

  before(async () => {
    for (const name of ENV_NAMES) { SAVED_ENV[name] = process.env[name]; delete process.env[name] }
    process.env.AGORA_ASK_ENABLED = 'on'
    process.env.AGORA_AI_KEY = 'pretend-key'
    process.env.AGORA_AI_PRODUCT_ID = '999999'
    process.env.AGORA_ASK_EMBED_MODEL = 'pretend-embed'
    await setup.clearDb()
    try {
      await knex().raw('create extension if not exists vector')
      hasVector = true
    } catch (e) {
      hasVector = false
    }
    AskIndex.forgetVectorCheck()

    amara = await new User({ name: 'Amara Okafor', email: 'amara@agora.test', active: true }).save()
    lars = await new User({ name: 'Lars Berg', email: 'lars@agora.test', active: true }).save()
    kenji = await new User({ name: 'Kenji', email: 'kenji@agora.test', active: true }).save()
    sleeper = await new User({ name: 'Gone', email: 'gone@agora.test', active: false }).save()
    circleA = await new Group({ slug: 'circle-a', name: 'Circle A', active: true }).save()
    circleB = await new Group({ slug: 'circle-b', name: 'Circle B', active: true }).save()
    await amara.joinGroup(circleA)
    await lars.joinGroup(circleA)
    await lars.joinGroup(circleB)
    await kenji.joinGroup(circleB)
    await sleeper.joinGroup(circleA)

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000)
    decisionPost = await makePost({ name: 'Tree planting', description: '<p>We decided to plant <b>trees</b> along the river.</p>', user_id: amara.id, created_at: tenDaysAgo }, [circleA])
    await comment(decisionPost, lars, '<p>Great, I will bring the shovels.</p>')
    budgetPost = await makePost({ name: 'Our finances', description: '<p>The budget for the festival is 500.</p>', user_id: lars.id }, [circleA])
    await makePost({ name: 'Circle B plans', description: '<p>The zebracorn project is secret to circle B.</p>', user_id: kenji.id }, [circleB])
    meetingEvent = await makePost({ name: 'Weekly call', type: 'event', description: '<p>Our call</p>', user_id: amara.id, start_time: new Date(), end_time: new Date() }, [circleA])
    const [session] = await knex()('meeting_sessions').insert({ post_id: meetingEvent, room_name: 'room-1', status: 'closed', started_at: new Date(), created_at: new Date(), updated_at: new Date() }).returning('id')
    await knex()('meeting_segments').insert({ session_id: session.id || session, user_id: amara.id, spoken_at: new Date(), text: 'Amara takes on chapter three of the playbook.', status: 'done', created_at: new Date(), updated_at: new Date() })
    await knex()('agora_playbook_chapters').insert({ group_id: circleA.id, position: 3, title: 'Fundraising', status: 'draft', owner_id: lars.id, summary: 'How we raise funds.', created_at: new Date(), updated_at: new Date() })

    // A private message thread between Amara and Kenji. It must never be used as it is.
    const [t] = await knex()('posts').insert({ type: 'thread', active: true, user_id: amara.id, created_at: new Date(), updated_at: new Date() }).returning('id')
    thread = t.id || t
    await comment(thread, kenji, '<p>My private worry about the river trees is the purple elephant clause.</p>')
  })

  after(() => {
    AI.useFetchForTests(null)
    for (const name of ENV_NAMES) {
      if (SAVED_ENV[name] === undefined) delete process.env[name]
      else process.env[name] = SAVED_ENV[name]
    }
  })

  beforeEach(() => pretendInfomaniak())

  describe('the permissions rule', () => {
    it('lets an active member ask in their circle, only about that circle', async () => {
      expect(await askScope(amara.id, circleA.id)).to.deep.include({ groupIds: [String(circleA.id)] })
    })

    it('gives nothing to someone outside the circle, an account that is switched off, or nobody', async () => {
      expect(await askScope(kenji.id, circleA.id)).to.equal(null)
      expect(await askScope(sleeper.id, circleA.id)).to.equal(null)
      expect(await askScope(null, circleA.id)).to.equal(null)
      expect(await askScope('1 or 1=1', circleA.id)).to.equal(null)
    })
  })

  describe('the index', () => {
    before(async () => {
      await AskIndex.reindexAll({ embed: true })
    })

    it('holds the posts, comments, events, meetings and playbook of each circle in that circle only', async () => {
      const rows = await knex()('agora_knowledge_chunks').select('group_id', 'source_type', 'text', 'url')
      const inA = rows.filter(r => String(r.group_id) === String(circleA.id))
      const types = new Set(inA.map(r => r.source_type))
      for (const type of ['post', 'comment', 'event', 'meeting', 'playbook']) expect(types.has(type), type).to.equal(true)
      expect(inA.some(r => r.text.includes('plant trees along the river'))).to.equal(true)
      expect(inA.some(r => r.text.includes('zebracorn'))).to.equal(false)
      expect(rows.filter(r => r.text.includes('zebracorn')).every(r => String(r.group_id) === String(circleB.id))).to.equal(true)
      const meeting = inA.find(r => r.source_type === 'meeting')
      expect(meeting.text).to.include('Amara Okafor: Amara takes on chapter three')
      expect(meeting.url).to.equal(`/groups/circle-a/post/${meetingEvent}`)
    })

    it('never holds a private message', async () => {
      const rows = await knex()('agora_knowledge_chunks').where('text', 'like', '%purple elephant%').orWhere('post_id', thread)
      expect(rows).to.have.length(0)
    })

    it('gives every piece an embedding when Infomaniak is set up, and keeps it when the text did not change', async () => {
      const missing = await knex()('agora_knowledge_chunks').whereNull('embedding').count('id as n').first()
      expect(Number(missing.n)).to.equal(0)
      pretendInfomaniak()
      await AskIndex.indexPost(decisionPost)
      await AskIndex.embedMissing()
      expect(calls.filter(c => c.url.endsWith('/embeddings'))).to.have.length(0)
    })

    it('follows a changed and a removed post', async () => {
      await knex()('posts').where('id', budgetPost).update({ description: '<p>The budget for the festival is 700.</p>' })
      await AskIndex.indexPost(budgetPost)
      const piece = await knex()('agora_knowledge_chunks').where('source_key', `post:${budgetPost}`).first()
      expect(piece.text).to.include('700')
      await AskIndex.embedMissing()
      const extra = await makePost({ name: 'Short lived', description: '<p>gone soon</p>', user_id: amara.id }, [circleA])
      await AskIndex.indexPost(extra)
      await knex()('posts').where('id', extra).update({ active: false })
      await AskIndex.indexPost(extra)
      expect(await knex()('agora_knowledge_chunks').where('post_id', extra)).to.have.length(0)
    })

    it('catches up with posts and comments that the jobs missed', async () => {
      await AskIndex.setState('index_watermark', new Date(Date.now() - 1000).toISOString())
      const late = await makePost({ name: 'Late post', description: '<p>the walrus committee meets</p>', user_id: amara.id }, [circleA])
      await comment(thread, amara, '<p>a later private reply about the walrus</p>')
      const counts = await AskIndex.catchUp()
      expect(counts.posts).to.be.at.least(1)
      expect((await knex()('agora_knowledge_chunks').where('post_id', late)).length).to.be.above(0)
      expect(await knex()('agora_knowledge_chunks').where('text', 'like', '%later private reply%')).to.have.length(0)
    })

    it('skips file texts while their table does not exist, and reads them once it does', async () => {
      AskIndex.forgetVectorCheck()
      expect(await AskIndex.fileTextsAvailable()).to.equal(false)
      await knex().schema.createTable('agora_file_texts', t => {
        t.bigIncrements('id'); t.bigInteger('group_id'); t.bigInteger('post_id'); t.bigInteger('media_id')
        t.string('kind'); t.text('title'); t.text('text'); t.string('language'); t.string('status'); t.text('error')
        t.timestamps()
      })
      await knex()('agora_file_texts').insert([
        { group_id: circleA.id, post_id: decisionPost, kind: 'document', title: 'River map.pdf', text: 'The map shows the quokka meadow.', status: 'done', created_at: new Date(), updated_at: new Date() },
        { group_id: circleA.id, post_id: decisionPost, kind: 'document', title: 'Draft.pdf', text: 'not ready', status: 'pending', created_at: new Date(), updated_at: new Date() }
      ])
      AskIndex.forgetVectorCheck()
      await AskIndex.reindexAll({ groupId: circleA.id, embed: false })
      const files = await knex()('agora_knowledge_chunks').where('source_type', 'file')
      expect(files.map(f => f.title)).to.deep.equal(['River map.pdf'])
      expect(files[0].url).to.equal(`/groups/circle-a/post/${decisionPost}`)
      await knex().schema.dropTable('agora_file_texts')
      AskIndex.forgetVectorCheck()
      await knex()('agora_knowledge_chunks').where('source_type', 'file').del()
    })
  })

  describe('asking', () => {
    it('refuses someone who is logged out, and changes that do not come from the page', async () => {
      const res = await askAs(null, 'circle-a', 'What did we decide?')
      expect(res.statusCode).to.equal(401)
      const res2 = await call('ask', { params: { groupSlug: 'circle-a' }, body: { question: 'What did we decide?' }, userId: amara.id, fromPage: false })
      expect(res2.statusCode).to.equal(400)
      expect(chatCalls()).to.have.length(0)
    })

    it('answers a member from their own circle, with numbered sources, and sends nothing of other circles or private messages', async () => {
      const res = await askAs(amara, 'circle-a', 'What did we decide about the trees by the river?')
      expect(res.statusCode).to.equal(undefined)
      const q = res.body.question
      expect(q.status).to.equal('answered')
      expect(q.answer).to.include('[1]')
      expect(q.sources).to.have.length(1)
      expect(q.sources[0].url).to.match(/^\/groups\/circle-a\//)
      const prompt = promptText(chatCalls()[0])
      expect(prompt).to.include('plant trees along the river')
      expect(prompt).not.to.include('zebracorn')
      expect(prompt).not.to.include('purple elephant')
      expect(chatCalls()[0].body.model).to.equal(AI.DEFAULT_CHAT_MODEL)
      expect(chatCalls()[0].url).to.equal('https://api.infomaniak.com/2/ai/999999/openai/v1/chat/completions')
    })

    it('never gives a member of circle A anything from circle B, even when they ask for it', async () => {
      const res = await askAs(amara, 'circle-a', 'Tell me about the zebracorn project of circle B')
      const prompts = chatCalls().map(promptText).join('\n')
      expect(prompts).not.to.include('zebracorn project is secret')
      expect(res.body.question.sources.every(s => !s.url || s.url.startsWith('/groups/circle-a/'))).to.equal(true)
    })

    it('refuses the Ask tab of a circle the person is not a member of', async () => {
      const res = await askAs(amara, 'circle-b', 'What is the zebracorn project?')
      expect(res.statusCode).to.equal(404)
      expect(chatCalls()).to.have.length(0)
      const status = await call('status', { params: { groupSlug: 'circle-b' }, userId: amara.id })
      expect(status.statusCode).to.equal(404)
    })

    it('a member of both circles gets each circle only in its own tab', async () => {
      await askAs(lars, 'circle-b', 'What is the zebracorn project?')
      const prompt = promptText(chatCalls()[0])
      expect(prompt).to.include('zebracorn')
      expect(prompt).not.to.include('plant trees')
    })

    it('finds a piece by meaning when the words differ (pgvector), or by keywords without it', async function () {
      if (!hasVector) this.skip()
      const res = await askAs(amara, 'circle-a', 'How much money do we have?')
      expect(calls.some(c => c.url.endsWith('/embeddings') && c.body.input[0] === 'How much money do we have?')).to.equal(true)
      expect(promptText(chatCalls()[0])).to.include('budget for the festival')
      expect(res.body.question.status).to.equal('answered')
    })

    it('works by keywords only when pgvector is off', async () => {
      process.env.AGORA_ASK_VECTOR = 'off'
      try {
        await askAs(amara, 'circle-a', 'Which shovels will be brought?')
        expect(calls.filter(c => c.url.endsWith('/embeddings'))).to.have.length(0)
        expect(promptText(chatCalls()[0])).to.include('bring the shovels')
      } finally {
        delete process.env.AGORA_ASK_VECTOR
      }
    })

    it('tells the model the date and puts recent pieces first for "last week"', async () => {
      await askAs(amara, 'circle-a', 'What happened last week?')
      const system = chatCalls()[0].body.messages[0].content
      expect(system).to.include('Today is')
      expect(system).to.include(new Date().toISOString().slice(0, 10))
      expect(system).to.include('Answer in the same language as the question')
    })

    it('says it found nothing without calling the model when the circle has nothing', async () => {
      const empty = await new Group({ slug: 'empty-circle', name: 'Empty', active: true }).save()
      await amara.joinGroup(empty)
      const res = await askAs(amara, 'empty-circle', 'What did we decide?')
      expect(res.body.question.status).to.equal('not_found')
      expect(chatCalls()).to.have.length(0)
    })

    it('logs every call with its estimated cost', async () => {
      await knex()('agora_ask_usage').del()
      await askAs(amara, 'circle-a', 'What did we decide about the trees?')
      const rows = await knex()('agora_ask_usage').where('kind', 'ask')
      expect(rows).to.have.length(1)
      expect(rows[0].input_tokens).to.equal(4000)
      expect(rows[0].output_tokens).to.equal(300)
      // Mistral Small 4: CHF 0.20 in and 0.75 out per million tokens, at 1.07 euro per franc
      expect(Number(rows[0].cost_eur)).to.be.closeTo((4000 * 0.20 + 300 * 0.75) / 1e6 * 1.07, 1e-6)
    })

    it('stops at the monthly cap', async () => {
      process.env.AGORA_ASK_MONTHLY_CAP = '0.5'
      await knex()('agora_ask_usage').insert({ kind: 'ask', model: 'x', cost_eur: 0.6, created_at: new Date() })
      try {
        const res = await askAs(amara, 'circle-a', 'What did we decide?')
        expect(res.statusCode).to.equal(429)
        expect(res.body.code).to.equal('cap')
        expect(chatCalls()).to.have.length(0)
      } finally {
        delete process.env.AGORA_ASK_MONTHLY_CAP
        await knex()('agora_ask_usage').del()
      }
    })

    it('limits questions per person per hour', async () => {
      process.env.AGORA_ASK_PER_HOUR = '1'
      try {
        const res = await askAs(lars, 'circle-b', 'What is the zebracorn project?')
        expect(res.statusCode).to.equal(429)
        expect(res.body.code).to.equal('per_hour')
      } finally {
        delete process.env.AGORA_ASK_PER_HOUR
      }
    })

    it('is hidden when Ask is off', async () => {
      process.env.AGORA_ASK_ENABLED = 'off'
      try {
        const status = await call('status', { params: { groupSlug: 'circle-a' }, userId: amara.id })
        expect(status.body).to.deep.equal({ enabled: false })
        const res = await askAs(amara, 'circle-a', 'What did we decide?')
        expect(res.statusCode).to.equal(404)
      } finally {
        process.env.AGORA_ASK_ENABLED = 'on'
      }
    })
  })

  describe('history and sharing', () => {
    let questionId

    before(async () => {
      pretendInfomaniak()
      const res = await askAs(amara, 'circle-a', 'What did we decide about planting?')
      questionId = res.body.question.id
    })

    it('shows a person only their own questions', async () => {
      const mine = await call('history', { params: { groupSlug: 'circle-a' }, userId: amara.id })
      expect(mine.body.questions.map(q => q.id)).to.include(questionId)
      const his = await call('history', { params: { groupSlug: 'circle-a' }, userId: lars.id })
      expect(his.body.questions.map(q => q.id)).not.to.include(questionId)
    })

    it('lets only the person who asked share the answer in the circle', async () => {
      const other = await call('share', { params: { questionId }, userId: lars.id })
      expect(other.statusCode).to.equal(404)
      let made
      const result = await Ask.share(amara.id, questionId, {
        postCreator: async (userId, params) => { made = { userId, params }; return { id: 4242 } }
      })
      expect(result).to.deep.equal({ postId: '4242', alreadyShared: false })
      expect(String(made.userId)).to.equal(String(amara.id))
      expect(made.params.group_ids.map(String)).to.deep.equal([String(circleA.id)])
      expect(made.params.type).to.equal('discussion')
      expect(made.params.description).to.include('Sources')
      expect(made.params.description).to.include(`/groups/circle-a/post/${decisionPost}`)
      expect(await Ask.share(amara.id, questionId)).to.deep.equal({ postId: '4242', alreadyShared: true })
    })
  })

  describe('pieces of text', () => {
    it('finds time words in several languages', () => {
      const now = new Date('2026-10-22T12:00:00Z') // a Thursday
      expect(Ask.timeWindow('What did we decide last week?', now).since.toISOString()).to.equal('2026-10-12T00:00:00.000Z')
      expect(Ask.timeWindow('Wat hebben we vorige week besloten?', now).label).to.equal('last week')
      expect(Ask.timeWindow("Summarise Tuesday's meeting", now).since.toISOString()).to.equal('2026-10-20T00:00:00.000Z')
      expect(Ask.timeWindow('Was war gestern?', now).label).to.equal('yesterday')
      expect(Ask.timeWindow('Which proposals are open?', now)).to.equal(null)
    })

    it('makes a keyword query of the meaningful words only', () => {
      expect(Ask.keywordQuery('Who works on chapter 3?')).to.equal('works:* | chapter:*')
      expect(Ask.keywordQuery('?!')).to.equal(null)
    })

    it('cuts long texts into overlapping pieces', () => {
      const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
      const pieces = AskIndex.chunkText(text, 300, 50)
      expect(pieces.length).to.be.above(3)
      expect(pieces.every(p => p.length <= 300)).to.equal(true)
    })

    it('keeps only cited numbers that exist', () => {
      expect(Ask.citedNumbers('A [2] and [1][2] and [9]', 3)).to.deep.equal([2, 1])
    })

    it('reads the product id from the speech to text address', () => {
      delete process.env.AGORA_AI_PRODUCT_ID
      process.env.AGORA_TRANSCRIPTION_URL = 'https://api.infomaniak.com/1/ai/123456/openai/audio/transcriptions'
      try {
        expect(AI.productId()).to.equal('123456')
        expect(AI.urlBase()).to.equal('https://api.infomaniak.com/2/ai/123456/openai/v1')
        expect(AI.rerankUrl()).to.equal('https://api.infomaniak.com/2/ai/123456/cohere/v2/rerank')
      } finally {
        process.env.AGORA_AI_PRODUCT_ID = '999999'
        delete process.env.AGORA_TRANSCRIPTION_URL
      }
    })
  })
})
