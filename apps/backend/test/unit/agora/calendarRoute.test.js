/* eslint-env mocha */
/**
 * Agora: the calendar feed address, through the real Sails router.
 *
 * `/noo/agora/calendar/<secret>.ics` once got a 404 before it reached the
 * controller: Sails skips routes that end in a :param when the last part looks
 * like a file name (`skipAssets`). This starts a small Sails with only the
 * real route from config/routes.js and the real controller, and asks it for
 * the address. It needs no database: the token lookup is stubbed.
 *
 *   cd apps/backend
 *   yarn test test/unit/agora/calendarRoute.test.js
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'chai'
import Calendar from '../../../lib/agora/calendar'

const Sails = require('sails').constructor
const rootPath = file => path.resolve(__dirname, '../../..', file)

const TOKEN = 'a'.repeat(43)
const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'
const WRONG_TEXT = 'This calendar link does not work (any more). Make a new one on the Calendar page in Agora.'

describe('Agora calendar feed route', () => {
  let app, dir
  const saved = {}

  let address
  const get = async url => {
    const res = await fetch(address + url)
    return { status: res.status, headers: { 'content-type': res.headers.get('content-type') }, body: await res.text() }
  }

  before(function (done) {
    this.timeout(60000)
    saved.userForToken = Calendar.userForToken
    saved.feedFor = Calendar.feedFor
    Calendar.userForToken = async token => token === TOKEN ? '42' : null
    Calendar.feedFor = async userId => userId === '42' ? ICS : ''

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-router-'))
    fs.mkdirSync(path.join(dir, 'api/controllers'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'api/controllers/AgoraCalendarController.js'),
      `module.exports = require(${JSON.stringify(rootPath('api/controllers/AgoraCalendarController'))})`
    )
    const routes = require(rootPath('config/routes')).routes
    const FEED_KEY = Object.keys(routes).find(key => /^GET\s+\/noo\/agora\/calendar\/:file$/.test(key))
    expect(FEED_KEY, 'the feed route is in config/routes.js').to.be.a('string')

    app = new Sails()
    app.lift({
      appPath: dir,
      globals: false,
      log: { level: 'error' },
      hooks: { sockets: false, views: false, orm: false, grunt: false, session: false, policies: false, blueprints: false, pubsub: false, i18n: false, security: false, services: false, helpers: false, cors: false },
      port: 0,
      hostname: '127.0.0.1',
      routes: { [FEED_KEY]: routes[FEED_KEY] }
    }, err => {
      if (err) return done(err)
      address = `http://127.0.0.1:${app.hooks.http.server.address().port}`
      done()
    })
  })

  after(done => {
    Calendar.userForToken = saved.userForToken
    Calendar.feedFor = saved.feedFor
    fs.rmSync(dir, { recursive: true, force: true })
    app.lower(() => done())
  })

  it('answers a good <secret>.ics with the calendar', async () => {
    const res = await get(`/noo/agora/calendar/${TOKEN}.ics`)
    expect(res.status).to.equal(200)
    expect(res.headers['content-type']).to.match(/^text\/calendar/)
    expect(res.body).to.equal(ICS)
  })

  it('answers a wrong <secret>.ics with the controller\'s plain text 404', async () => {
    const res = await get(`/noo/agora/calendar/${'b'.repeat(43)}.ics`)
    expect(res.status).to.equal(404)
    expect(res.headers['content-type']).to.match(/^text\/plain/)
    expect(res.body).to.equal(WRONG_TEXT)
  })

  it('does not accept the secret without .ics', async () => {
    const res = await get(`/noo/agora/calendar/${TOKEN}`)
    expect(res.status).to.equal(404)
    expect(res.body).to.equal(WRONG_TEXT)
  })
})
