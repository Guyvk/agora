/* eslint-env mocha */
/**
 * Agora: uploads need the session. Sails skips the session for any path that
 * looks like a file, which made every picture at /noo/uploads answer 401
 * "Log in first", also for people who were logged in (the diskUploads tests
 * fake the session, so they did not see it).
 */
const { session } = require('../../../config/session')

const LOOKS_LIKE_ASSET_RX = /^[^?]*\/[^?\/]+\.[^?\/]+(\?.*)?$/ // eslint-disable-line no-useless-escape
const req = path => ({ path, _sails: { LOOKS_LIKE_ASSET_RX } })

describe('Agora: session for uploads', () => {
  it('keeps the session for an uploaded picture', () => {
    expect(session.isSessionDisabled(req('/noo/uploads/evo-uploads/user/1/userAvatar/1/me.jpg'))).to.equal(false)
  })

  it('still skips the session for other files, as Sails does', () => {
    expect(session.isSessionDisabled(req('/favicon.png'))).to.equal(true)
    expect(session.isSessionDisabled(req('/assets/app.js'))).to.equal(true)
  })

  it('keeps the session for the API', () => {
    expect(session.isSessionDisabled(req('/noo/graphql'))).to.equal(false)
  })
})
