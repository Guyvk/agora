/**
 * Agora: where the files of a circle's library are kept.
 *
 * Two places, chosen with AGORA_FILE_STORAGE:
 *
 *   disk  (the default) a folder on Agora's own server, AGORA_LIBRARY_DIR. When
 *         that is empty: the hidden folder ".library" inside the uploads folder
 *         (/var/lib/agora/uploads/.library on the server), so the nightly backup
 *         copies it without any change. The public address /noo/uploads never
 *         serves it: it refuses every hidden folder (lib/agora/diskUploads.js).
 *   s3    object storage that speaks Amazon's S3 language, such as Infomaniak's
 *         (Swiss, part of the same Public Cloud project). Settings:
 *           AGORA_S3_ENDPOINT    default https://s3.pub2.infomaniak.cloud
 *           AGORA_S3_REGION      default us-east-1 (Infomaniak accepts it)
 *           AGORA_S3_BUCKET      default agora-files (the nightly backup uses its own,
 *                                agora-backups; one pair of keys can serve both)
 *           AGORA_S3_ACCESS_KEY, AGORA_S3_SECRET_KEY   the two keys, no default
 *         Without both keys Agora uses the disk, so it works before S3 is set up.
 *
 * Files are never public. The bucket stays private: a member's browser gets a
 * short-lived signed address for one file (PUT to send it, GET to fetch it),
 * and only after Agora has checked that they are a member of the circle.
 *
 * Profile pictures, banners and post attachments made with Hylo's own buttons
 * do not come here; they stay where lib/agora/diskUploads.js keeps them.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import aws from 'aws-sdk'
import sanitize from 'sanitize-filename'
import send from 'send'
import { uploadsDir } from './diskUploads'

export const DEFAULT_S3_ENDPOINT = 'https://s3.pub2.infomaniak.cloud'
export const DEFAULT_S3_REGION = 'us-east-1'
export const DEFAULT_S3_BUCKET = 'agora-files'

// How long a signed address works.
export const PUT_EXPIRES_SECONDS = 60 * 60
export const GET_EXPIRES_SECONDS = 5 * 60

// Types a browser may show inside the page. Everything else is a download, so
// an uploaded web page or SVG drawing never runs as part of Agora.
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/[\w.+-]+|application\/pdf|text\/plain)$/

let s3Client = null
let bucketReady = null

/** For tests: a stand-in for the S3 client. null puts the real one back. */
export function setS3Client (client) {
  s3Client = client
  bucketReady = null
}

export function s3Settings () {
  return {
    endpoint: process.env.AGORA_S3_ENDPOINT || DEFAULT_S3_ENDPOINT,
    region: process.env.AGORA_S3_REGION || DEFAULT_S3_REGION,
    bucket: process.env.AGORA_S3_BUCKET || DEFAULT_S3_BUCKET,
    accessKeyId: process.env.AGORA_S3_ACCESS_KEY || '',
    secretAccessKey: process.env.AGORA_S3_SECRET_KEY || ''
  }
}

/** 's3' when AGORA_FILE_STORAGE=s3 and both keys are set, else 'disk'. */
export function backend () {
  if (String(process.env.AGORA_FILE_STORAGE || 'disk').trim().toLowerCase() !== 's3') return 'disk'
  const { accessKeyId, secretAccessKey } = s3Settings()
  return accessKeyId && secretAccessKey ? 's3' : 'disk'
}

/** True when the browser sends files to S3 itself. AGORA_S3_DIRECT_UPLOAD=off sends them through Agora. */
export function directUploads () {
  return backend() === 's3' && String(process.env.AGORA_S3_DIRECT_UPLOAD || 'on').trim().toLowerCase() !== 'off'
}

function s3 () {
  if (s3Client) return s3Client
  const { endpoint, region, accessKeyId, secretAccessKey } = s3Settings()
  return new aws.S3({
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4'
  })
}

const bucket = () => s3Settings().bucket

/**
 * Makes the bucket (Infomaniak calls it a container) the first time it is
 * needed, private: no public access is ever set on it. Checked once per run.
 */
export function ensureBucket () {
  if (!bucketReady) {
    const name = bucket()
    bucketReady = (async () => {
      try {
        await s3().headBucket({ Bucket: name }).promise()
      } catch (err) {
        if (!(err.code === 'NotFound' || err.code === 'NoSuchBucket' || err.statusCode === 404)) throw err
        await s3().createBucket({ Bucket: name, ACL: 'private' }).promise()
      }
    })().catch(err => {
      bucketReady = null
      throw err
    })
  }
  return bucketReady
}

/** The folder that holds library files kept on disk. */
export function libraryDir () {
  return path.resolve(process.env.AGORA_LIBRARY_DIR || path.join(uploadsDir(), '.library'))
}

/** A file name that is safe in a path and in an address. Keeps the extension. */
export function safeFileName (name) {
  let clean = sanitize(String(name || '').normalize('NFC')).replace(/\s+/g, '-').replace(/^[.-]+/, '')
  if (!clean) clean = 'file'
  if (clean.length > 120) {
    const ext = path.extname(clean).slice(0, 12)
    clean = clean.slice(0, 120 - ext.length) + ext
  }
  return clean
}

/** A new storage key: library/<circle>/<year-month>/<random>/<name>. */
export function makeKey (groupId, fileName) {
  const month = new Date().toISOString().slice(0, 7)
  return `library/${Number(groupId)}/${month}/${crypto.randomBytes(12).toString('hex')}/${safeFileName(fileName)}`
}

/** The file on disk for a storage key. Refuses anything that could point outside the library folder. */
export function diskPath (key) {
  if (typeof key !== 'string' || !key || key.includes('\0') || key.includes('\\')) {
    throw new Error('Agora library: invalid file path')
  }
  const parts = key.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('Agora library: invalid file path')
  }
  const root = libraryDir()
  const full = path.resolve(root, ...parts)
  if (!full.startsWith(root + path.sep)) throw new Error('Agora library: invalid file path')
  return full
}

const partPath = key => `${diskPath(key)}.part`

// ---- Sending a file in pieces through Agora (disk, and S3 when the browser cannot reach it) ----

/** Writes one piece of a file that arrives in pieces, at its place in the file. A piece sent again overwrites itself. */
export async function writeDiskChunk (key, offset, buffer) {
  const target = partPath(key)
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  let handle
  try {
    handle = await fs.promises.open(target, 'r+')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    handle = await fs.promises.open(target, 'w', 0o640)
  }
  try {
    await handle.write(buffer, 0, buffer.length, offset)
  } finally {
    await handle.close()
  }
}

/** All pieces are in: checks the size and puts the file in place. Resolves with the size on disk. */
export async function finishDiskFile (key, size) {
  const temp = partPath(key)
  const stat = await fs.promises.stat(temp).catch(() => null)
  if (!stat) throw new Error('No part of the file arrived.')
  if (stat.size !== size) throw new Error(`The file arrived with ${stat.size} of its ${size} bytes.`)
  await fs.promises.rename(temp, diskPath(key))
  return stat.size
}

// ---- S3 ----

/** A signed address the browser sends the whole file to with PUT. */
export async function presignPut (key, mimeType) {
  await ensureBucket()
  return s3().getSignedUrlPromise('putObject', {
    Bucket: bucket(),
    Key: key,
    ContentType: mimeType || 'application/octet-stream',
    Expires: PUT_EXPIRES_SECONDS
  })
}

/** Starts an upload in parts (for big files). Resolves with its UploadId. */
export async function startMultipart (key, mimeType) {
  await ensureBucket()
  const result = await s3().createMultipartUpload({
    Bucket: bucket(),
    Key: key,
    ContentType: mimeType || 'application/octet-stream'
  }).promise()
  return result.UploadId
}

/** A signed address for one part of an upload in parts. */
export function presignPart (key, uploadId, partNumber) {
  return s3().getSignedUrlPromise('uploadPart', {
    Bucket: bucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Expires: PUT_EXPIRES_SECONDS
  })
}

/** Agora's server sends one part itself. Resolves with the part's ETag. */
export async function relayPart (key, uploadId, partNumber, buffer) {
  const result = await s3().uploadPart({
    Bucket: bucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: buffer
  }).promise()
  return result.ETag
}

export function completeMultipart (key, uploadId, parts) {
  return s3().completeMultipartUpload({
    Bucket: bucket(),
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.map(p => ({ PartNumber: Number(p.PartNumber), ETag: p.ETag })) }
  }).promise()
}

export function abortMultipart (key, uploadId) {
  return s3().abortMultipartUpload({ Bucket: bucket(), Key: key, UploadId: uploadId }).promise()
}

/** The size of a stored object in bytes, or null when it is not there. */
export async function s3Size (key) {
  try {
    const head = await s3().headObject({ Bucket: bucket(), Key: key }).promise()
    return Number(head.ContentLength)
  } catch (err) {
    if (err.code === 'NotFound' || err.statusCode === 404) return null
    throw err
  }
}

// ---- For both ----

/** True when a browser may show this type inside the page. */
export function showsInline (mimeType) {
  return INLINE_TYPES.test(String(mimeType || '').split(';')[0].trim().toLowerCase())
}

function contentDisposition (inline, fileName) {
  const name = safeFileName(fileName)
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** The type and disposition a file is handed out with. Unsafe types become plain downloads. */
export function deliveryFor ({ mimeType, fileName, download = false }) {
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase()
  const inline = !download && showsInline(type)
  return {
    contentType: inline ? type : 'application/octet-stream',
    disposition: contentDisposition(inline, fileName)
  }
}

/** Stores a whole file that Agora made itself, such as a meeting transcript. */
export async function writeBuffer (storage, key, buffer, mimeType) {
  if (storage === 's3') {
    await ensureBucket()
    await s3().putObject({ Bucket: bucket(), Key: key, Body: buffer, ContentType: mimeType || 'application/octet-stream' }).promise()
    return
  }
  const target = diskPath(key)
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${crypto.randomBytes(6).toString('hex')}.part`
  await fs.promises.writeFile(temp, buffer, { flag: 'wx', mode: 0o640 })
  await fs.promises.rename(temp, target)
}

/** Copies a stored file to a file on this server, for reading its text. */
export async function copyToFile (storage, key, target) {
  if (storage === 's3') {
    const stream = s3().getObject({ Bucket: bucket(), Key: key }).createReadStream()
    await pipeline(stream, fs.createWriteStream(target, { mode: 0o600 }))
    return target
  }
  await fs.promises.copyFile(diskPath(key), target)
  return target
}

/** Deletes a stored file. A file that is already gone is fine. */
export async function remove (storage, key) {
  if (storage === 's3') {
    await s3().deleteObject({ Bucket: bucket(), Key: key }).promise()
    return
  }
  for (const target of [diskPath(key), partPath(key)]) {
    await fs.promises.unlink(target).catch(err => { if (err.code !== 'ENOENT') throw err })
  }
}

/** A signed address that fetches one S3 file for a few minutes, with a safe type. */
export function presignGet (key, { mimeType, fileName, download = false }) {
  const { contentType, disposition } = deliveryFor({ mimeType, fileName, download })
  return s3().getSignedUrlPromise('getObject', {
    Bucket: bucket(),
    Key: key,
    Expires: GET_EXPIRES_SECONDS,
    ResponseContentType: contentType,
    ResponseContentDisposition: disposition
  })
}

/**
 * Hands out a file kept on disk, with a safe type. Supports ranges, so sound
 * and video can be wound forward. The caller has checked that the person may see it.
 */
export function serveDisk (req, res, key, { mimeType, fileName, download = false }) {
  const { contentType, disposition } = deliveryFor({ mimeType, fileName, download })
  let full
  try {
    full = diskPath(key)
  } catch (err) {
    return res.status(404).send({ error: 'This file does not exist.' })
  }
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', disposition)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=300')
  // A PDF needs the browser's own viewer, which a sandbox would block. Everything else is sandboxed.
  if (contentType !== 'application/pdf') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox")
  }
  send(req, path.relative(libraryDir(), full), { root: libraryDir(), dotfiles: 'deny', index: false, cacheControl: false })
    .on('error', err => {
      res.statusCode = err.status === 416 ? 416 : 404
      res.removeHeader && res.removeHeader('Content-Disposition')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(res.statusCode === 404 ? 'Not found' : 'Range not satisfiable')
    })
    .pipe(res)
}

/**
 * Tries the object storage once: makes the bucket when it is missing, then
 * writes, reads back and deletes a small test file. Used by
 * scripts/agora-library-check.js. Never says anything about the keys.
 * @returns {Promise<Array<{ step: string, ok: boolean, error?: string }>>}
 */
export async function checkS3 () {
  const key = `check/${crypto.randomBytes(8).toString('hex')}.txt`
  const body = Buffer.from(`Agora storage check ${new Date().toISOString()}`)
  const steps = [
    ['bucket', () => ensureBucket()],
    ['write', () => s3().putObject({ Bucket: bucket(), Key: key, Body: body, ContentType: 'text/plain' }).promise()],
    ['read', async () => {
      const got = await s3().getObject({ Bucket: bucket(), Key: key }).promise()
      if (!Buffer.from(got.Body).equals(body)) throw new Error('what came back differs from what was written')
    }],
    ['delete', () => s3().deleteObject({ Bucket: bucket(), Key: key }).promise()]
  ]
  const results = []
  for (const [step, fn] of steps) {
    try {
      await fn()
      results.push({ step, ok: true })
    } catch (err) {
      results.push({ step, ok: false, error: String(err.code || err.message || 'error').slice(0, 100) })
      break
    }
  }
  return results
}

export default {
  checkS3,
  DEFAULT_S3_ENDPOINT,
  DEFAULT_S3_REGION,
  DEFAULT_S3_BUCKET,
  setS3Client,
  s3Settings,
  ensureBucket,
  backend,
  directUploads,
  libraryDir,
  safeFileName,
  makeKey,
  diskPath,
  writeDiskChunk,
  finishDiskFile,
  presignPut,
  startMultipart,
  presignPart,
  relayPart,
  completeMultipart,
  abortMultipart,
  s3Size,
  showsInline,
  deliveryFor,
  writeBuffer,
  copyToFile,
  remove,
  presignGet,
  serveDisk
}
