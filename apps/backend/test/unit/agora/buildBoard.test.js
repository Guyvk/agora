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
      status: status ? { name: status, updatedAt: extra.statusAt || ago(1) } : null,
      owner: { name: 'Nana' },
      circle: { name: 'Tech Support' },
      content: {
        number, title: `Card ${number}`, body: extra.body || '', state: 'OPEN', closedAt: null, url: `https://github.com/Guyvk/agora/issues/${number}`,
        closedByPullRequestsReferences: { nodes: extra.prs || [] }
      }
    }
  }

  function projectData (after) {
    const all = projectNodes()
    const nodes = github.twoPages ? (after ? all.slice(4) : all.slice(0, 4)) : all
    const pageInfo = { hasNextPage: Boolean(github.twoPages && !after), endCursor: github.twoPages && !after ? 'C1' : null }
    return projectPage(nodes, pageInfo)
  }

  function projectPage (nodes, pageInfo) {
    return {
      data: {
        user: {
          projectV2: {
            id: 'P1',
            url: 'u',
            field: { id: 'F1', options: [{ id: 'o1', name: 'To do' }, { id: 'o2', name: 'Doing' }, { id: 'o3', name: 'In review' }, { id: 'o4', name: 'Live' }] },
            items: { nodes, pageInfo }
          }
        }
      }
    }
  }

  function projectNodes () {
    return [
      item('I1', 1, 'To do', { body: `Help desk #${helpIds['Mentioned one']} is about this` }),
      item('I2', 2, 'Doing'),
      item('I3', 3, 'In review', { prs: [{ number: 30, state: 'MERGED', isDraft: false, url: 'x' }] }),
      item('I4', 4, 'Live', { statusAt: ago(2) }),
      item('I5', 5, 'Live', { statusAt: ago(1) }),
      item('I6', 6, 'Live', { statusAt: ago(20), updatedAt: ago(1) }),
      item('I7', 7, 'Doing', { prs: [{ number: 31, state: 'OPEN', isDraft: true, url: 'y' }] })
    ]
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
      calls.push({ url, headers: options.headers, body, signal: options.signal })
      if (github.down) return { ok: false, status: 502, json: async () => ({}) }
      if (body.query.includes('updateProjectV2ItemFieldValue')) {
        if (github.moveFails) return { ok: true, status: 200, json: async () => ({ errors: [{ message: 'no' }] }) }
        return { ok: true, status: 200, json: async () => ({ data: {} }) }
      }
      return { ok: true, status: 200, json: async () => projectData(body.variables.after) }
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
    expect(res.statusCode).to.equal(undefined) // res.ok does not set a status in the mock
    const board = res.body
    expect(board.configured).to.equal(true)
    expect(board.columns.map(c => c.name)).to.deep.equal(['To do', 'Doing', 'In review', 'Live'])
    expect(board.columns[0].cards.map(c => c.number)).to.deep.equal([1])
    expect(board.columns[1].cards.map(c => c.number)).to.deep.equal([2, 7])
    expect(board.columns[1].cards[1].prs[0].state).to.equal('draft')
    expect(board.columns[0].cards[0].owner).to.equal('Nana')
    expect(board.columns[0].cards[0].circle).to.equal('Tech Support')
    const review = board.columns[2].cards[0]
    expect(review.prs[0].state).to.equal('merged')
    expect(review.mergedGoesLive).to.equal(true)
  })

  it('lists what went live in the last 14 days, newest first', async () => {
    const res = await call('board', { userId: amara.id })
    expect(res.body.wentLive.map(c => c.number)).to.deep.equal([5, 4])
  })

  it('lists new Help desk requests that no card mentions', async () => {
    const res = await call('board', { userId: amara.id })
    expect(res.body.helpDesk.map(r => r.id).sort()).to.deep.equal([helpIds['Login is slow'], helpIds['Wish for dark mode']].sort())
  })

  it('shows only number, type and date of a Help desk request, never its text', async () => {
    const res = await call('board', { userId: amara.id })
    res.body.helpDesk.forEach(r => expect(Object.keys(r).sort()).to.deep.equal(['createdAt', 'id', 'type']))
    expect(JSON.stringify(res.body.helpDesk)).to.not.include('Login is slow')
  })

  it('tells the page whether the person may open the Help desk', async () => {
    let res = await call('board', { userId: amara.id })
    expect(res.body.canOpenHelpDesk).to.equal(false)
    process.env.AGORA_HELPDESK_ADMINS = String(amara.id)
    try {
      res = await call('board', { userId: amara.id })
      expect(res.body.canOpenHelpDesk).to.equal(true)
    } finally {
      delete process.env.AGORA_HELPDESK_ADMINS
    }
  })

  it('keeps one copy for 5 minutes and limits forced refreshes to one a minute', async () => {
    await call('board', { userId: amara.id })
    await call('board', { userId: amara.id })
    expect(reads().length).to.equal(1)
    await call('board', { userId: amara.id, query: { refresh: '1' } })
    expect(reads().length).to.equal(2)
    await call('board', { userId: amara.id, query: { refresh: '1' } })
    expect(reads().length).to.equal(2)
  })

  it('says the board is not connected without a token, and never calls GitHub', async () => {
    delete process.env.AGORA_GITHUB_BOARD_TOKEN
    const res = await call('board', { userId: amara.id })
    expect(res.statusCode).to.equal(undefined) // res.ok does not set a status in the mock
    expect(res.body.configured).to.equal(false)
    expect(res.body.boardUrl).to.match(/github\.com/)
    expect(calls.length).to.equal(0)
  })

  it('answers 502 when GitHub is down and there is no copy', async () => {
    github.down = true
    const res = await call('board', { userId: amara.id })
    expect(res.statusCode).to.equal(502)
    expect(JSON.stringify(res.body)).to.not.include('pretend-token')
  })

  it('reads every page of the board', async () => {
    github.twoPages = true
    const res = await call('board', { userId: amara.id })
    expect(reads().length).to.equal(2)
    expect(reads()[1].body.variables.after).to.equal('C1')
    expect(res.body.columns.reduce((n, c) => n + c.cards.length, 0)).to.equal(7)
  })

  it('gives every GitHub call a time limit', async () => {
    await call('board', { userId: amara.id })
    expect(calls[0].signal).to.not.equal(undefined)
  })

  it('leaves GitHub alone for 30 seconds after a failed read', async () => {
    github.down = true
    await call('board', { userId: amara.id })
    expect(calls.length).to.equal(1)
    const again = await call('board', { userId: amara.id })
    expect(again.statusCode).to.equal(502)
    expect(calls.length).to.equal(1)
    // with a copy: the old copy and the warning, still no new call
    Build.resetCache()
    github.down = false
    await call('board', { userId: amara.id })
    github.down = true
    await call('board', { userId: amara.id, query: { refresh: '1' } })
    const callsBefore = calls.length
    const res = await call('board', { userId: amara.id, query: { refresh: '1' } })
    expect(calls.length).to.equal(callsBefore)
    // the copy is under 5 minutes old, so it is shown as it is
    expect(res.body.columns[0].cards.length).to.equal(1)
  })

  it('shares one read between parallel page loads', async () => {
    await Promise.all([call('board', { userId: amara.id }), call('board', { userId: amara.id }), call('board', { userId: amara.id })])
    expect(reads().length).to.equal(1)
  })

  it('dates what went live by when the Status changed, not by the card\'s own updatedAt', async () => {
    const res = await call('board', { userId: amara.id })
    // card 6 was touched yesterday but moved to Live 20 days ago
    expect(res.body.wentLive.map(c => c.number)).to.not.include(6)
    expect(res.body.wentLive[0].date).to.be.a('string')
  })

  it('shows the last copy with a warning when GitHub goes down', async () => {
    await call('board', { userId: amara.id })
    github.down = true
    const res = await call('board', { userId: amara.id, query: { refresh: '1' } })
    expect(res.statusCode).to.equal(undefined) // res.ok does not set a status in the mock
    expect(res.body.warning).to.match(/GitHub/)
    expect(res.body.columns[0].cards.length).to.equal(1)
  })

  it('never puts the token in an answer', async () => {
    const res = await call('board', { userId: amara.id })
    expect(JSON.stringify(res.body)).to.not.include('pretend-token')
  })

  it('answers 401 when logged out', async () => {
    for (const action of ['board', 'access']) {
      expect((await call(action)).statusCode).to.equal(401)
    }
    expect((await call('move', { body: { itemId: 'I1', status: 'Doing' } })).statusCode).to.equal(401)
  })

  it('answers 403 to someone who is not in the Build circle, and to nobody when no circle is set', async () => {
    expect((await call('board', { userId: dan.id })).statusCode).to.equal(403)
    expect((await call('move', { userId: dan.id, body: { itemId: 'I1', status: 'Doing' } })).statusCode).to.equal(403)
    delete process.env.AGORA_BUILD_CIRCLE
    expect((await call('board', { userId: amara.id })).statusCode).to.equal(403)
    const access = await call('access', { userId: amara.id })
    expect(access.body.allowed).to.equal(false)
  })

  it('does not let Agora admins in unless they are in the circle', async () => {
    process.env.AGORA_ADMINS = String(admin.id)
    try {
      expect((await call('board', { userId: admin.id })).statusCode).to.equal(403)
    } finally {
      delete process.env.AGORA_ADMINS
    }
  })

  it('tells members whether they may see the page', async () => {
    const res = await call('access', { userId: amara.id })
    expect(res.body).to.deep.equal({ allowed: true, circle: 'tech-support' })
  })

  it('moves a card with the right mutation, then reads the board again', async () => {
    await call('board', { userId: amara.id })
    const res = await call('move', { userId: amara.id, body: { itemId: 'I2', status: 'In review' } })
    expect(res.statusCode).to.equal(undefined) // res.ok does not set a status in the mock
    const mutation = calls.find(c => c.body.query.includes('updateProjectV2ItemFieldValue'))
    expect(mutation.body.variables).to.deep.equal({ project: 'P1', item: 'I2', field: 'F1', option: 'o3' })
    expect(mutation.headers.Authorization).to.equal('Bearer pretend-token')
    expect(reads().length).to.equal(2)
  })

  it('refuses a move from outside the page, an unknown column and an unknown card', async () => {
    expect((await call('move', { userId: amara.id, fromPage: false, body: { itemId: 'I2', status: 'Doing' } })).statusCode).to.equal(400)
    expect((await call('move', { userId: amara.id, body: { itemId: 'I2', status: 'Nowhere' } })).statusCode).to.equal(400)
    expect((await call('move', { userId: amara.id, body: { itemId: 'NOPE', status: 'Doing' } })).statusCode).to.equal(404)
    expect(calls.filter(c => c.body.query.includes('updateProjectV2ItemFieldValue')).length).to.equal(0)
  })

  it('answers 502 when GitHub refuses the move', async () => {
    github.moveFails = true
    const res = await call('move', { userId: amara.id, body: { itemId: 'I2', status: 'Doing' } })
    expect(res.statusCode).to.equal(502)
  })

  it('tells Agora admins in the admin area when the page is off', async () => {
    process.env.AGORA_ADMINS = String(admin.id)
    try {
      delete process.env.AGORA_BUILD_CIRCLE
      let system = await AdminDashboard.system(admin.id)
      expect(system.services.buildPage).to.deep.equal({ circle: null, connected: true })
      process.env.AGORA_BUILD_CIRCLE = 'tech-support'
      system = await AdminDashboard.system(admin.id)
      expect(system.services.buildPage.circle).to.equal('tech-support')
    } finally {
      delete process.env.AGORA_ADMINS
    }
  })
})
