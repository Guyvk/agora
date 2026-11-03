/* eslint-env mocha */
/**
 * Agora: a profile location typed without picking a suggestion still gets
 * coordinates, so the person shows up on the map (User.geocodeLocation).
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/userLocation.test.js
 */
const nock = require('nock')
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

// Shaped like a Mapbox key, which the Mapbox library checks; nock answers for it
const FAKE_TOKEN = 'pk.eyJ1IjoiYWdvcmEtdGVzdCIsImEiOiJ0ZXN0In0.test'

const amsterdam = {
  type: 'FeatureCollection',
  features: [{
    id: 'place.123',
    type: 'Feature',
    place_type: ['place'],
    text: 'Amsterdam',
    properties: {},
    place_name: 'Amsterdam, North Holland, Netherlands',
    center: [4.9, 52.378],
    geometry: { type: 'Point', coordinates: [4.9, 52.378] },
    context: [
      { id: 'region.1', text: 'North Holland' },
      { id: 'country.1', text: 'Netherlands', short_code: 'nl' }
    ]
  }]
}

describe('Agora profile location on the map', () => {
  let user, oldPin, originalClassMethod, originalToken, queued

  before(async () => {
    await setup.clearDb()
    originalClassMethod = Queue.classMethod
    originalToken = process.env.MAPBOX_TOKEN
  })

  beforeEach(async () => {
    oldPin = await Location.create({ full_text: 'Ericeira, Lisbon, Portugal', center: { lng: -9.41, lat: 38.96 } })
    user = await factories.user({ location: 'Ericeira, Lisbon, Portugal', location_id: oldPin.id }).save()
    queued = []
    Queue.classMethod = (model, method, data) => { queued.push({ model, method, data }); return Promise.resolve() }
  })

  afterEach(() => {
    Queue.classMethod = originalClassMethod
    nock.cleanAll()
  })

  after(() => {
    if (originalToken === undefined) delete process.env.MAPBOX_TOKEN
    else process.env.MAPBOX_TOKEN = originalToken
  })

  const geocodeJobs = () => queued.filter(j => j.model === 'User' && j.method === 'geocodeLocation')

  it('drops the old pin and looks up a typed location', async () => {
    await user.validateAndSave(null, { location: 'Amsterdam', location_id: null })
    await user.refresh()
    expect(user.get('location')).to.equal('Amsterdam')
    expect(user.get('location_id')).to.equal(null)
    expect(geocodeJobs()).to.deep.equal([{ model: 'User', method: 'geocodeLocation', data: { userId: user.id } }])
  })

  it('keeps a picked suggestion and looks nothing up', async () => {
    const picked = await Location.create({ full_text: 'Amsterdam, North Holland, Netherlands', center: { lng: 4.9, lat: 52.378 } })
    await user.validateAndSave(null, { location: 'Amsterdam, North Holland, Netherlands', location_id: picked.id })
    await user.refresh()
    expect(String(user.get('location_id'))).to.equal(String(picked.id))
    expect(geocodeJobs()).to.have.length(0)
  })

  it('leaves the pin alone when the location is not changed', async () => {
    await user.validateAndSave(null, { tagline: 'Hello' })
    await user.refresh()
    expect(String(user.get('location_id'))).to.equal(String(oldPin.id))
    expect(geocodeJobs()).to.have.length(0)
  })

  it('clears the pin and looks nothing up when the location is emptied', async () => {
    await user.validateAndSave(null, { location: '' })
    await user.refresh()
    expect(user.get('location_id')).to.equal(null)
    expect(geocodeJobs()).to.have.length(0)
  })

  it('geocodeLocation saves the Mapbox match as the pin', async () => {
    process.env.MAPBOX_TOKEN = FAKE_TOKEN
    await user.save({ location: 'Amsterdam', location_id: null }, { patch: true })
    nock('https://api.mapbox.com').get(/geocoding\/v5\/mapbox\.places\/Amsterdam\.json/).reply(200, amsterdam)

    await User.geocodeLocation({ userId: user.id })
    await user.refresh({ withRelated: 'locationObject' })
    const loc = user.relations.locationObject
    expect(loc.get('full_text')).to.equal('Amsterdam, North Holland, Netherlands')
    expect(loc.get('center')).to.deep.include({ lng: 4.9, lat: 52.378 })
  })

  it('geocodeLocation leaves the person off the map when nothing matches', async () => {
    process.env.MAPBOX_TOKEN = FAKE_TOKEN
    await user.save({ location: 'nowhere at all', location_id: null }, { patch: true })
    nock('https://api.mapbox.com').get(/geocoding/).reply(200, { type: 'FeatureCollection', features: [] })

    await User.geocodeLocation({ userId: user.id })
    await user.refresh()
    expect(user.get('location_id')).to.equal(null)
  })
})
