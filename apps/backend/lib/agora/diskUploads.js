/**
 * Agora: uploads kept on Agora's own disk instead of in Amazon S3.
 *
 * Hylo keeps profile pictures, banners, attachments and calendar files in an
 * S3 bucket. Agora runs on one server without S3, so when S3 is not set up
 * (no AWS_S3_BUCKET or no AWS_ACCESS_KEY_ID) the storage functions in
 * lib/uploader/storage.js hand over to the functions here.
 *
 * Files go into one folder (AGORA_UPLOADS_DIR), under the same paths Hylo
 * would use in S3 (UPLOADER_PATH_PREFIX/user/<id>/<type>/<id>/<name>). They are
 * served by `serveUploads` at /noo/uploads/<that path>, which goes to the
 * backend both on the server (Caddy sends /noo to it) and on a Mac (the web
 * app passes /noo on). Like Hylo's S3 files, anyone with the address can open
 * a file: the addresses are hard to guess, but they are not secret.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { PassThrough } from 'stream'
import send from 'send'

export const ROUTE = '/noo/uploads'

// Types a browser may show inline. Everything else is offered as a download,
// so an uploaded web page or SVG never runs as part of Agora's own site.
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+)$/

/** True when uploads go to disk: S3 is used only when its bucket and key are both set. */
export function inUse () {
  return !(process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID)
}

/**
 * The folder that holds the uploads: AGORA_UPLOADS_DIR, or else
 * /var/lib/agora/uploads on the server (outside the code, so updates never
 * touch it and the nightly backup finds it) and apps/backend/.agora-uploads
 * on a Mac (ignored by git).
 */
export function uploadsDir () {
  const fallback = process.env.NODE_ENV === 'production'
    ? '/var/lib/agora/uploads'
    : path.join(__dirname, '../../.agora-uploads')
  return path.resolve(process.env.AGORA_UPLOADS_DIR || fallback)
}

/** The address the files are served at, without a slash at the end. */
export function baseUrl () {
  const configured = (process.env.AGORA_UPLOADS_URL || '').replace(/\/+$/, '')
  return configured || `${process.env.PROTOCOL}://${process.env.DOMAIN}${ROUTE}`
}

/** Where calendar files and other stored files can be found: S3 when it is used, this server otherwise. */
export function contentUrl () {
  return inUse() ? baseUrl() : process.env.AWS_S3_CONTENT_URL
}

/**
 * The file on disk for a storage key such as "evo-uploads/user/1/userAvatar/1/a.png".
 * Refuses anything that could point outside the uploads folder.
 */
export function filePath (key) {
  if (typeof key !== 'string' || !key || key.includes('\0') || key.includes('\\')) {
    throw new Error('Validation error: Agora uploads: invalid file path')
  }
  const parts = key.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('Validation error: Agora uploads: invalid file path')
  }
  const root = uploadsDir()
  const full = path.resolve(root, ...parts)
  if (!full.startsWith(root + path.sep)) {
    throw new Error('Validation error: Agora uploads: invalid file path')
  }
  return full
}

/** The public address of a storage key. */
export function urlFor (key) {
  return `${baseUrl()}/${key.split('/').map(encodeURIComponent).join('/')}`
}

/** The storage key of one of our own addresses, or null for any other address. */
export function keyFromUrl (url) {
  if (typeof url !== 'string') return null
  const prefix = baseUrl() + '/'
  if (!url.startsWith(prefix)) return null
  try {
    return url.slice(prefix.length).split(/[?#]/)[0].split('/').map(decodeURIComponent).join('/')
  } catch (err) {
    return null
  }
}

function tempPathFor (target) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomBytes(6).toString('hex')}.part`)
}

/**
 * A stream that writes one upload to disk. It behaves like Hylo's S3 stream:
 * 'finish' fires only once the file is in place, `stream.url` is then its
 * address, and 'progress' listeners get { loaded } as bytes arrive.
 * The file is written under a hidden temporary name and then renamed, so a
 * half-written file is never served and a new avatar replaces the old one at once.
 */
export function createStream (key) {
  const target = filePath(key)
  const temp = tempPathFor(target)
  const wrapper = new PassThrough()
  const finishCallbacks = []
  const progressCallbacks = []
  let loaded = 0

  const realOn = wrapper.on.bind(wrapper)
  wrapper.on = function (eventName, callback) {
    if (eventName === 'finish') {
      finishCallbacks.push(callback)
      return wrapper
    }
    if (eventName === 'progress') {
      progressCallbacks.push(callback)
      return wrapper
    }
    return realOn(eventName, callback)
  }

  const fail = err => {
    fs.unlink(temp, () => {})
    wrapper.emit('error', err)
  }

  fs.mkdir(path.dirname(target), { recursive: true }, err => {
    if (err) return fail(err)
    const out = fs.createWriteStream(temp, { flags: 'wx', mode: 0o640 })
    out.on('error', fail)
    out.on('close', () => {
      if (out.errored) return
      fs.rename(temp, target, err => {
        if (err) return fail(err)
        wrapper.url = urlFor(key)
        finishCallbacks.forEach(fn => fn())
      })
    })
    wrapper.on('data', chunk => {
      loaded += chunk.length
      progressCallbacks.forEach(fn => fn({ loaded }))
    })
    wrapper.pipe(out)
  })

  wrapper.key = key
  return wrapper
}

/** Writes a text (such as a calendar file) to disk. Resolves with its address, like Hylo's writeStringToS3. */
export async function writeString (content, key) {
  const target = filePath(key)
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  const temp = tempPathFor(target)
  try {
    await fs.promises.writeFile(temp, content, { flag: 'wx', mode: 0o640 })
    await fs.promises.rename(temp, target)
  } catch (err) {
    await fs.promises.unlink(temp).catch(() => {})
    throw err
  }
  return { url: urlFor(key) }
}

/** Deletes one stored file. A file that is already gone is fine. */
export async function remove (key) {
  try {
    await fs.promises.unlink(filePath(key))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return {}
}

/** Deletes the files behind a list of addresses. Addresses that are not ours are left alone. */
export function removeUrls (urls = []) {
  const keys = urls.map(keyFromUrl).filter(Boolean)
  return Promise.all(keys.map(key => remove(key).catch(err => {
    console.error('Agora uploads: could not delete', key, err.message)
  })))
}

/**
 * Express middleware: serves the uploads folder at /noo/uploads/...
 * Only GET and HEAD, never a folder listing, never hidden or half-written
 * files, never anything outside the folder (the `send` library refuses "..").
 */
export function serveUploads (req, res, next) {
  const url = req.url || ''
  if (url !== ROUTE && !url.startsWith(ROUTE + '/')) return next()
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    return res.end()
  }

  const notFound = () => {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not found')
  }

  const relative = url.slice(ROUTE.length).split('?')[0]
  if (!relative || relative === '/') return notFound()

  send(req, relative, {
    root: uploadsDir(),
    dotfiles: 'deny',
    index: false,
    maxAge: 5 * 60 * 1000
  })
    .on('directory', notFound)
    .on('error', err => {
      res.statusCode = err.status === 403 || err.status === 400 ? err.status : 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(res.statusCode === 404 ? 'Not found' : 'Not allowed')
    })
    .on('headers', (res, filePath) => {
      const type = send.mime.lookup(filePath)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox")
      res.setHeader('Content-Disposition', INLINE_TYPES.test(type) ? 'inline' : 'attachment')
    })
    .pipe(res)
}
