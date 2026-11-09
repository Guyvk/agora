/* eslint-env mocha */
/**
 * Agora: the Build page, see lib/agora/buildBoard.js and AgoraBuildController.js.
 * GitHub is a pretend fetch. These checks need a database, and empty it first:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/buildBoard.test.js
 */
import AgoraBuildController from '../../../api/controllers/AgoraBuildController'
import Build from '../../../lib/agora/buildBoard'
import AdminDashboard from '../../../lib/agora/adminDashboard'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

const DAY = 24 * 3600 * 1000
const ago = days => new Date(Date.now() - days * DAY).toISOString()

describe('Agora Build page', () => {
  let amara, dan, admin, circle, other
  let realFetch, calls, github, savedEnv
  const helpIds = {}

  const knex = () => bookshelf.knex

  function item (id, number, status, extra = {}) {
    return {
      id,
      updatedAt: extra.updatedAt || ago(1),
      status: status ? { name: status } : null,
      owner: { name: 'Nana' },
      circle: { name: 'Tech Support' },
      content: {
        number, title: `Card ${number}`, body: extra.body || '', state: 'OPEN', closedAt: null, url: `https://github.com/Guyvk/agora/issues/${number}`,
        closedByPullRequestsReferences: { nodes: extra.prs || [] }
      }
    }
  }

  function projectData () {
    return {
      data: {
        user: {
          projectV2: {
            id: 'P1',
            url: 'u',
            field: { id: 'F1', options: [{ id: 'o1', name: 'To do' }, { id: 'o2', name: 'Doing' }, { id: 'o3', name: 'In review' }, { id: 'o4', name: 'Live' }] },
            items: {
              nodes: [
                item('I1', 1, 'To do', { body: `Help desk #${helpIds['Mentioned one']} is about this` }),
                item('I2', 2, 'Doing'),
                item('I3', 3, 'In review', { prs: [{ number: 30, state: 'MERGED', isDraft: false, url: 'x' }] }),
                item('I4', 4, 'Live', { updatedAt: ago(2) }),
                item('I5', 5, 'Live', { updatedAt: ago(1) }),
                item('I6', 6, 'Live', { updatedAt: ago(20) }),
                item('I7', 7, 'Doing', { prs: [{ number: 31, state: 'OPEN', isDraft: true, url: 'y' }] })
              ]
            }
          }
        }
      }
    }
  }

  function call (action, { userId, query = {}, body, fromPage = true } = {}) {
    const req = factories.mock.request()
    req.query = query
    req.body = body
    req.headers = fromPage ? { 'x-agora': '1' } : {}
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.set = () => {}
    return AgoraBuildController[action](req, res).then(() => res)
  }

  before(async () => {
    await setup.clearDb()
    amara = await new User({ name: 'Amara', email: 'amara@build.test', active: true }).save()
    dan = await new User({ name: 'Dan', email: 'dan@build.test', active: true }).save()
    admin = await new User({ name: 'Admin', email: 'admin@build.test', active: true }).save()
    circle = await new Group({ slug: 'tech-support', name: 'Tech Support' }).save()
    other = await new Group({ slug: 'care', name: 'Care' }).save()
    await amara.joinGroup(circle)
    await dan.joinGroup(other)
    await admin.joinGroup(other)
    for (const [title, status, type] of [['Login is slow', 'new', 'fault'], ['Wish for dark mode', 'looking', 'wish'], ['Mentioned one', 'new', 'fault'], ['Done one', 'fixed', 'fault']]) {
      const [row] = await knex()('agora_help_requests').insert({ user_id: amara.id, title, status, type }).returning('id')
      helpIds[title] = String(row.id !== undefined ? row.id : row)
    }
  })

  beforeEach(() => {
    savedEnv = { c: process.env.AGORA_BUILD_CIRCLE, t: process.env.AGORA_GITHUB_BOARD_TOKEN }
    process.env.AGORA_BUILD_CIRCLE = 'tech-support'
    process.env.AGORA_GITHUB_BOARD_TOKEN = 'pretend-token'
    Build.resetCache()
    calls = []
    github = { down: false, moveFails: false }
    realFetch = global.fetch
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body)
      calls.push({ url, headers: options.headers, body })
      if (github.down) return { ok: false, status: 502, json: async () => ({}) }
      if (body.query.includes('updateProjectV2ItemFieldValue')) {
        if (github.moveFails) return { ok: true, status: 200, json: async () => ({ errors: [{ message: 'no' }] }) }
        return { ok: true, status: 200, json: async () => ({ data: {} }) }
      }
      return { ok: true, status: 200, json: async () => projectData() }
    }
  })

  afterEach(() => {
    global.fetch = realFetch
    const restore = (name, v) => { if (v === undefined) delete process.env[name]; else process.env[name] = v }
    restore('AGORA_BUILD_CIRCLE', savedEnv.c)
    restore('AGORA_GITHUB_BOARD_TOKEN', savedEnv.t)
  })

  const reads = () => calls.filter(c => c.body.query.includes('projectV2(number'))

  it('shows the four columns with owner, circle and pull request badges', async () => {
    const res = await call('board', { userId: amara.id })
    res.statusCode.should.equal(200)
    const board = res.body
    board.configured.should.equal(true)
    board.columns.map(c => c.name).should.deepEqual(['To do', 'Doing', 'In review', 'Live'])
    board.columns[0].cards.map(c => c.number).should.deepEqual([1])
    board.columns[1].cards.map(c => c.number).should.deepEqual([2, 7])
    board.columns[1].cards[1].prs[0].state.should.equal('draft')
    board.columns[0].cards[0].owner.should.equal('Nana')
    board.columns[0].cards[0].circle.should.equal('Tech Support')
    const review = board.columns[2].cards[0]
    review.prs[0].state.should.equal('merged')
    review.mergedGoesLive.should.equal(true)
  })

  it('lists what went live in the last 14 days, newest first', async () => {
    const res = await call('board', { userId: amara.id })
    res.body.wentLive.map(c => c.number).should.deepEqual([5, 4])
  })

  it('lists new Help desk requests that no card mentions', async () => {
    const res = await call('board', { userId: amara.id })
    res.body.helpDesk.map(r => r.id).sort().should.deepEqual([helpIds['Login is slow'], helpIds['Wish for dark mode']].sort())
  })

  it('shows only number, type and date of a Help desk request, never its text', async () => {
    const res = await call('board', { userId: amara.id })
    res.body.helpDesk.forEach(r => Object.keys(r).sort().should.deepEqual(['createdAt', 'id', 'type']))
    JSON.stringify(res.body.helpDesk).should.not.containEql('Login is slow')
  })

  it('tells the page whether the person may open the Help desk', async () => {
    let res = await call('board', { userId: amara.id })
    res.body.canOpenHelpDesk.should.equal(false)
    process.env.AGORA_HELPDESK_ADMINS = String(amara.id)
    try {
      res = await call('board', { userId: amara.id })
      res.body.canOpenHelpDesk.should.equal(true)
    } finally {
      delete process.env.AGORA_HELPDESK_ADMINS
    }
  })

  it('keeps one copy for 5 minutes and limits forced refreshes to one a minute', async () => {
    await call('board', { userId: amara.id })
    await call('board', { userId: amara.id })
    reads().length.should.equal(1)
    await call('board', { userId: amara.id, query: { refresh: '1' } })
    reads().length.should.equal(2)
    await call('board', { userId: amara.id, query: { refresh: '1' } })
    reads().length.should.equal(2)
  })

  it('says the board is not connected without a token, and never calls GitHub', async () => {
    delete process.env.AGORA_GITHUB_BOARD_TOKEN
    const res = await call('board', { userId: amara.id })
    res.statusCode.should.equal(200)
    res.body.configured.should.equal(false)
    res.body.boardUrl.should.match(/github\.com/)
    calls.length.should.equal(0)
  })

  it('answers 502 when GitHub is down and there is no copy', async () => {
    github.down = true
    const res = await call('board', { userId: amara.id })
    res.statusCode.should.equal(502)
  })

  it('shows the last copy with a warning when GitHub goes down', async () => {
    await call('board', { userId: amara.id })
    github.down = true
    const res = await call('board', { userId: amara.id, query: { refresh: '1' } })
    res.statusCode.should.equal(200)
    res.body.warning.should.match(/GitHub/)
    res.body.columns[0].cards.length.should.equal(1)
  })

  it('never puts the token in an answer', async () => {
    const res = await call('board', { userId: amara.id })
    JSON.stringify(res.body).should.not.containEql('pretend-token')
  })

  it('answers 401 when logged out', async () => {
    for (const action of ['board', 'access']) {
      (await call(action)).statusCode.should.equal(401)
    }
    ;(await call('move', { body: { itemId: 'I1', status: 'Doing' } })).statusCode.should.equal(401)
  })

  it('answers 403 to someone who is not in the Build circle, and to nobody when no circle is set', async () => {
    ;(await call('board', { userId: dan.id })).statusCode.should.equal(403)
    ;(await call('move', { userId: dan.id, body: { itemId: 'I1', status: 'Doing' } })).statusCode.should.equal(403)
    delete process.env.AGORA_BUILD_CIRCLE
    ;(await call('board', { userId: amara.id })).statusCode.should.equal(403)
    const access = await call('access', { userId: amara.id })
    access.body.allowed.should.equal(false)
  })

  it('does not let Agora admins in unless they are in the circle', async () => {
    process.env.AGORA_ADMINS = String(admin.id)
    try {
      ;(await call('board', { userId: admin.id })).statusCode.should.equal(403)
    } finally {
      delete process.env.AGORA_ADMINS
    }
  })

  it('tells members whether they may see the page', async () => {
    const res = await call('access', { userId: amara.id })
    res.body.should.deepEqual({ allowed: true, circle: 'tech-support' })
  })

  it('moves a card with the right mutation, then reads the board again', async () => {
    await call('board', { userId: amara.id })
    const res = await call('move', { userId: amara.id, body: { itemId: 'I2', status: 'In review' } })
    res.statusCode.should.equal(200)
    const mutation = calls.find(c => c.body.query.includes('updateProjectV2ItemFieldValue'))
    mutation.body.variables.should.deepEqual({ project: 'P1', item: 'I2', field: 'F1', option: 'o3' })
    mutation.headers.Authorization.should.equal('Bearer pretend-token')
    reads().length.should.equal(2)
  })

  it('refuses a move from outside the page, an unknown column and an unknown card', async () => {
    ;(await call('move', { userId: amara.id, fromPage: false, body: { itemId: 'I2', status: 'Doing' } })).statusCode.should.equal(400)
    ;(await call('move', { userId: amara.id, body: { itemId: 'I2', status: 'Nowhere' } })).statusCode.should.equal(400)
    ;(await call('move', { userId: amara.id, body: { itemId: 'NOPE', status: 'Doing' } })).statusCode.should.equal(404)
    calls.filter(c => c.body.query.includes('updateProjectV2ItemFieldValue')).length.should.equal(0)
  })

  it('answers 502 when GitHub refuses the move', async () => {
    github.moveFails = true
    const res = await call('move', { userId: amara.id, body: { itemId: 'I2', status: 'Doing' } })
    res.statusCode.should.equal(502)
  })

  it('tells Agora admins in the admin area when the page is off', async () => {
    process.env.AGORA_ADMINS = String(admin.id)
    try {
      delete process.env.AGORA_BUILD_CIRCLE
      let system = await AdminDashboard.system(admin.id)
      system.services.buildPage.should.deepEqual({ circle: null, connected: true })
      process.env.AGORA_BUILD_CIRCLE = 'tech-support'
      system = await AdminDashboard.system(admin.id)
      system.services.buildPage.circle.should.equal('tech-support')
    } finally {
      delete process.env.AGORA_ADMINS
    }
  })
})
