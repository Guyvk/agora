require('../../setup')
const factories = require('../../setup/factories')
const defaultAvatarUrl = 'http://hylo-app.s3.amazonaws.com/misc/default_group_avatar.png'

describe('AssetManagement', () => {
  var group, origBucket, origKey, origSecret

  before(() => {
    origBucket = process.env.AWS_S3_BUCKET
    // Agora: without a bucket, files go to Agora's own disk, so "misconfigured"
    // here means S3 half set up: a bucket and key id, but no secret key
    origKey = process.env.AWS_ACCESS_KEY_ID
    origSecret = process.env.AWS_SECRET_ACCESS_KEY
    process.env.AWS_S3_BUCKET = 'agora-test-bucket'
    process.env.AWS_ACCESS_KEY_ID = 'made-up-key-id'
    process.env.AWS_SECRET_ACCESS_KEY = ''
    group = factories.group()
    return group.save({avatar_url: defaultAvatarUrl})
  })

  after(() => {
    process.env.AWS_S3_BUCKET = origBucket
    process.env.AWS_ACCESS_KEY_ID = origKey // Agora
    process.env.AWS_SECRET_ACCESS_KEY = origSecret // Agora
  })

  describe('copyAsset', () => {
    it('throws an error if misconfigured', function () {
      const promise = AssetManagement.copyAsset(group, 'group', 'avatar_url')
      return expect(promise).to.eventually.be.rejected
    })
  })

  describe('resizeAsset', () => {
    it('throws an error if misconfigured', function () {
      const promise = AssetManagement.resizeAsset(group, 'avatar_url', {width: 200, height: 200})
      return expect(promise).to.eventually.be.rejected
    })
  })
})
