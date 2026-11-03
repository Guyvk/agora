import Promise from 'bluebird'
import fs from 'fs'
import request from 'request'
import sharp from 'sharp'
import { createS3StorageStream, safeBasename } from '../../lib/uploader/storage'
import * as diskUploads from '../../lib/agora/diskUploads'

module.exports = {
  copyAsset: function (instance, type, attr) {
    const sourceUrl = instance.get(attr)
    const filename = safeBasename(sourceUrl)
    .replace(/((_\d+)?(\.\w{2,4}))?$/, `_${Date.now()}$3`)

    return runPipeline(sourceUrl, filename, type, instance.id)
    .then(url => instance.save({[attr]: url}, {patch: true}))
  },

  resizeAsset: function (instance, fromAttr, toAttr, settings = {}) {
    const { width, height, type, transacting } = settings
    const sourceUrl = instance.get(fromAttr)
    const filename = safeBasename(sourceUrl)
    .replace(/(\.\w{2,4})?$/, `_${width}x${height}$1`)

    return runPipeline(sourceUrl, filename, type, instance.id, stream =>
      stream.pipe(sharp().resize(width, height)))
    .then(url => instance.save({[toAttr]: url}, {patch: true, transacting}))
  }
}

function runPipeline (url, filename, type, id, pipeFn) {
  return new Promise((resolve, reject) => {
    sails.log.info('from: ' + url)

    // Agora: our own uploads are only served to people who are logged in, so read them from disk
    const key = diskUploads.inUse() ? diskUploads.keyFromUrl(url) : null
    let stream = key
      ? fs.createReadStream(diskUploads.filePath(key))
      : request.get({url, encoding: null})
    if (key) stream.on('error', reject)
    if (pipeFn) stream = pipeFn(stream)
    stream = stream.pipe(createS3StorageStream(type, id, {filename}))

    stream.on('finish', () => {
      sails.log.info('to:   ' + stream.url)
      resolve(stream.url)
    })

    stream.on('error', reject)
  })
}
