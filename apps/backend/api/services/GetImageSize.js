import fs from 'fs'
import imageSize from 'image-size'
import request from 'request'
import * as diskUploads from '../../lib/agora/diskUploads'

module.exports = function (imageUrl) {
  // Agora: our own uploads are only served to people who are logged in, so the
  // server would be refused when it fetches one. It reads the file from disk instead.
  const key = diskUploads.inUse() ? diskUploads.keyFromUrl(imageUrl) : null
  if (key) {
    return Promise.resolve()
      .then(() => fs.promises.readFile(diskUploads.filePath(key)))
      .then(body => imageSize(body))
      .catch(err => Promise.reject('Get Image Size on ' + imageUrl + ' failed: ' + err.message))
  }

  return new Promise((resolve, reject) => {
    request(imageUrl, {encoding: null}, (error, resp, body) => {
      if (error) return reject(error)

      if (resp.statusCode !== 200) {
        return reject('Get Image Size on ' + imageUrl + ' failed with status code: ' + resp.statusCode)
      }
      resolve(imageSize(resp.body, 'binary'))
    })
  })
}
