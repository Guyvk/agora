/**
 * Agora: the library of a circle, on its Resources tab.
 *
 * Every library item is a normal Hylo "resource" post in the circle, so it also
 * shows in the circle's stream and can be commented on. Agora adds:
 *
 *   - files of up to 500 MB (sound and video) or 100 MB (everything else),
 *     kept on Agora's disk or in S3 object storage (lib/agora/libraryStorage.js)
 *     and handed out to members of the circle only;
 *   - the kind of item: document, image, audio, video, meeting notes or link;
 *   - the text of each file, read by the worker (lib/agora/libraryExtract.js)
 *     and kept in agora_file_texts (lib/agora/fileTexts.js), for search and AI;
 *   - meeting notes filed by themselves when a meeting ends (fileMeeting).
 *
 * Resource posts made with Hylo's own post editor are in the library too, with
 * their normal attachments; their text is read as well when the attachment is
 * kept on Agora's own disk.
 *
 * Who may do what: only active members of the circle can list, search, open,
 * download or add. Every function here that takes a userId checks it.
 *
 * Adding a file, from the browser's side (AgoraLibraryController):
 *   1. startUpload  -> how to send it:
 *        chunks     pieces of CHUNK_BYTES to Agora (disk, or S3 through Agora)
 *        single     one PUT to a signed S3 address
 *        multipart  parts to signed S3 addresses (partUrls), for big files
 *   2. the pieces or parts
 *   3. finishUpload -> the file is checked and "stored"
 *   4. createItem   -> the post, its attachments and the text job
 */
import path from 'path'
import os from 'os'
import fs from 'fs'
import createPost from '../../api/models/post/createPost'
import Storage from './libraryStorage'
import Extract, { ExtractError } from './libraryExtract'
import FileTexts from './fileTexts'
import * as diskUploads from './diskUploads'

export const KINDS = ['document', 'image', 'audio', 'video', 'meeting', 'link', 'other']
export const CHUNK_BYTES = 8 * 1024 * 1024
export const SINGLE_PUT_LIMIT = 32 * 1024 * 1024
export const MIN_PART_BYTES = 16 * 1024 * 1024
const MAX_PARTS = 9000
const MAX_FILES_PER_ITEM = 20
const PAGE_SIZE = 30
// A text job that is "pending" for longer than this is thought to have died and may start again.
const PENDING_STALE_MS = 2 * 60 * 60 * 1000

export class LibraryError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.status = status
  }
}

const knex = () => bookshelf.knex

const mb = value => Math.round(value / 1048576)

function megabytes (name, fallback) {
  const value = Number(process.env[name])
  return (Number.isFinite(value) && value > 0 ? value : fallback) * 1048576
}

/** The largest file of a kind, in bytes. Settings: AGORA_LIBRARY_MAX_MEDIA_MB, AGORA_LIBRARY_MAX_DOCUMENT_MB. */
export function maxBytesFor (kind) {
  return kind === 'audio' || kind === 'video'
    ? megabytes('AGORA_LIBRARY_MAX_MEDIA_MB', 500)
    : megabytes('AGORA_LIBRARY_MAX_DOCUMENT_MB', 100)
}

/** The longest recording that is sent to speech to text, in minutes. Setting: AGORA_LIBRARY_MAX_TRANSCRIBE_MINUTES. */
export function maxTranscribeMinutes () {
  const value = Number(process.env.AGORA_LIBRARY_MAX_TRANSCRIBE_MINUTES)
  return Number.isFinite(value) && value > 0 ? value : 240
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|wma|amr)$/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mpe?g|3gp)$/i
const DOCUMENT_EXT = /\.(pdf|docx?|docm|odt|ods|odp|rtf|txt|md|markdown|csv|tsv|json|pptx?|xlsx?|epub|html?|srt|vtt|pages|key|numbers)$/i

/** The kind of a file from its name and type. */
export function kindFor (fileName, mimeType) {
  const name = String(fileName || '')
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase()
  if (IMAGE_EXT.test(name) || type.startsWith('image/')) return 'image'
  if (AUDIO_EXT.test(name) || type.startsWith('audio/')) return 'audio'
  if (VIDEO_EXT.test(name) || type.startsWith('video/')) return 'video'
  if (DOCUMENT_EXT.test(name) || type.startsWith('text/') || type === 'application/pdf' || /officedocument|opendocument|msword/.test(type)) return 'document'
  return 'other'
}

/** The kind of row in agora_file_texts for a file kind. */
function textKindFor (kind) {
  if (kind === 'image') return 'image'
  if (kind === 'audio' || kind === 'video') return 'audio'
  return 'document'
}

function siteUrl (pathname) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}${pathname}`
}

/** The members-only address of a library file. This address goes into Hylo's media table. */
export function fileUrl (file) {
  return siteUrl(`/noo/agora/library/file/${file.id}/${encodeURIComponent(Storage.safeFileName(file.file_name))}`)
}

const FILE_URL_PATTERN = /\/noo\/agora\/library\/file\/(\d+)(\/|$)/

/** The library file id in one of our addresses, or null. */
export function fileIdFromUrl (url) {
  const match = String(url || '').match(FILE_URL_PATTERN)
  return match ? match[1] : null
}

export async function isMember (userId, groupId) {
  return Boolean(userId && groupId) && GroupMembership.hasActiveMembership(userId, groupId)
}

async function assertMember (userId, groupId) {
  if (!(await isMember(userId, groupId))) throw new LibraryError('Only members of this circle can use its library.', 403)
}

function cleanSize (size) {
  const n = Number(size)
  return Number.isSafeInteger(n) && n > 0 ? n : NaN
}

function cleanMime (mimeType) {
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type.slice(0, 255) : 'application/octet-stream'
}

function partSizeFor (size) {
  return Math.max(MIN_PART_BYTES, Math.ceil(size / MAX_PARTS))
}

function publicUpload (file) {
  const plan = { id: String(file.id), mode: file.upload_mode, size: Number(file.size_bytes), kind: file.kind }
  if (file.upload_mode === 'chunks') {
    plan.chunkSize = CHUNK_BYTES
    plan.chunkCount = Math.ceil(Number(file.size_bytes) / CHUNK_BYTES)
  }
  if (file.upload_mode === 'multipart') {
    plan.partSize = partSizeFor(Number(file.size_bytes))
    plan.partCount = Math.ceil(Number(file.size_bytes) / plan.partSize)
  }
  return plan
}

// ---- Uploads ----

/**
 * Starts adding one file. Answers how the browser should send it.
 */
export async function startUpload ({ userId, groupId, fileName, mimeType, size }) {
  await assertMember(userId, groupId)
  const name = String(fileName || '').trim()
  if (!name) throw new LibraryError('The file has no name.')
  const bytes = cleanSize(size)
  if (!bytes) throw new LibraryError('The file is empty, or its size is not a whole number of bytes.')
  const type = cleanMime(mimeType)
  const kind = kindFor(name, type)
  const limit = maxBytesFor(kind)
  if (bytes > limit) {
    throw new LibraryError(kind === 'audio' || kind === 'video'
      ? `Recordings and videos can be up to ${mb(limit)} MB. This one is ${mb(bytes)} MB.`
      : `Files can be up to ${mb(limit)} MB. This one is ${mb(bytes)} MB.`, 413)
  }

  const storage = Storage.backend()
  const key = Storage.makeKey(groupId, name)
  let mode = 'chunks'
  let uploadId = null
  if (storage === 's3') {
    if (Storage.directUploads() && bytes <= SINGLE_PUT_LIMIT) mode = 'single'
    else {
      mode = Storage.directUploads() ? 'multipart' : 'chunks'
      uploadId = await Storage.startMultipart(key, type)
    }
  }

  const now = new Date()
  const [file] = await knex()('agora_library_files').insert({
    group_id: groupId,
    uploaded_by_id: userId,
    kind,
    file_name: name.slice(0, 255),
    mime_type: type,
    size_bytes: bytes,
    storage,
    storage_key: key,
    status: 'uploading',
    upload_mode: mode,
    s3_upload_id: uploadId,
    parts: storage === 's3' && mode === 'chunks' ? JSON.stringify([]) : null,
    created_at: now,
    updated_at: now
  }).returning('*')

  const plan = publicUpload(file)
  if (mode === 'single') {
    plan.url = await Storage.presignPut(key, type)
    plan.headers = { 'Content-Type': type }
  }
  return plan
}

/** The upload of one member, still under way. */
async function uploadingFile (userId, fileId) {
  const file = await knex()('agora_library_files').where({ id: Number(fileId) || 0 }).first()
  if (!file || String(file.uploaded_by_id) !== String(userId)) throw new LibraryError('This upload does not exist.', 404)
  await assertMember(userId, file.group_id)
  if (file.status !== 'uploading') throw new LibraryError('This file has already arrived.', 409)
  return file
}

/** One piece of a file sent through Agora. index starts at 0. */
export async function uploadChunk ({ userId, fileId, index, buffer }) {
  const file = await uploadingFile(userId, fileId)
  if (file.upload_mode !== 'chunks') throw new LibraryError('This file is not sent in pieces through Agora.', 409)
  const size = Number(file.size_bytes)
  const count = Math.ceil(size / CHUNK_BYTES)
  const i = Number(index)
  if (!Number.isInteger(i) || i < 0 || i >= count) throw new LibraryError('This piece is not part of the file.')
  const expected = i === count - 1 ? size - i * CHUNK_BYTES : CHUNK_BYTES
  if (!Buffer.isBuffer(buffer) || buffer.length !== expected) {
    throw new LibraryError(`This piece should be ${expected} bytes.`)
  }

  if (file.storage === 'disk') {
    await Storage.writeDiskChunk(file.storage_key, i * CHUNK_BYTES, buffer)
  } else {
    const etag = await Storage.relayPart(file.storage_key, file.s3_upload_id, i + 1, buffer)
    await bookshelf.transaction(async trx => {
      const row = await trx('agora_library_files').where({ id: file.id }).forUpdate().first()
      const parts = (row.parts || []).filter(p => Number(p.PartNumber) !== i + 1)
      parts.push({ PartNumber: i + 1, ETag: etag })
      await trx('agora_library_files').where({ id: file.id }).update({ parts: JSON.stringify(parts), updated_at: new Date() })
    })
  }
  return { received: i }
}

/** Signed addresses for parts of a big file the browser sends to S3 itself. */
export async function partUrls ({ userId, fileId, partNumbers }) {
  const file = await uploadingFile(userId, fileId)
  if (file.upload_mode !== 'multipart') throw new LibraryError('This file is not sent in parts.', 409)
  const { partCount } = publicUpload(file)
  const numbers = [...new Set((Array.isArray(partNumbers) ? partNumbers : [partNumbers]).map(Number))]
  if (!numbers.length || numbers.length > 100 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > partCount)) {
    throw new LibraryError('These parts are not part of the file.')
  }
  const urls = {}
  for (const n of numbers) urls[n] = await Storage.presignPart(file.storage_key, file.s3_upload_id, n)
  return { urls }
}

/**
 * The browser could not send the file to S3 itself (for example because the
 * storage does not allow this website): from now on it goes through Agora in pieces.
 */
export async function switchToRelay ({ userId, fileId }) {
  const file = await uploadingFile(userId, fileId)
  if (file.storage !== 's3') throw new LibraryError('This file already goes through Agora.', 409)
  if (file.s3_upload_id) await Storage.abortMultipart(file.storage_key, file.s3_upload_id).catch(() => {})
  const uploadId = await Storage.startMultipart(file.storage_key, file.mime_type)
  const [row] = await knex()('agora_library_files').where({ id: file.id })
    .update({ upload_mode: 'chunks', s3_upload_id: uploadId, parts: JSON.stringify([]), updated_at: new Date() })
    .returning('*')
  return publicUpload(row)
}

/** All of the file was sent: it is checked and kept. parts: [{ partNumber, etag }] for multipart. */
export async function finishUpload ({ userId, fileId, parts }) {
  const file = await uploadingFile(userId, fileId)
  const size = Number(file.size_bytes)
  try {
    if (file.storage === 'disk') {
      await Storage.finishDiskFile(file.storage_key, size)
    } else {
      if (file.upload_mode === 'multipart' || file.upload_mode === 'chunks') {
        const count = file.upload_mode === 'multipart' ? publicUpload(file).partCount : Math.ceil(size / CHUNK_BYTES)
        const list = file.upload_mode === 'multipart'
          ? (Array.isArray(parts) ? parts : []).map(p => ({ PartNumber: Number(p.partNumber || p.PartNumber), ETag: String(p.etag || p.ETag || '') }))
          : (file.parts || [])
        list.sort((a, b) => a.PartNumber - b.PartNumber)
        const complete = list.length === count && list.every((p, i) => p.PartNumber === i + 1 && p.ETag)
        if (!complete) throw new LibraryError('Some parts of the file are missing. Try again.', 409)
        await Storage.completeMultipart(file.storage_key, file.s3_upload_id, list)
      }
      const stored = await Storage.s3Size(file.storage_key)
      if (stored !== size) throw new LibraryError(`The file arrived with ${stored || 0} of its ${size} bytes.`, 409)
    }
  } catch (err) {
    if (err instanceof LibraryError) throw err
    throw new LibraryError(err.message, 409)
  }
  await knex()('agora_library_files').where({ id: file.id }).update({ status: 'stored', parts: null, updated_at: new Date() })
  return { id: String(file.id), stored: true }
}

/** Removes uploads that never finished, after a day. For the daily cron job. */
export async function cleanUnfinishedUploads ({ olderThanHours = 24 } = {}) {
  const cutoff = new Date(Date.now() - olderThanHours * 3600000)
  const rows = await knex()('agora_library_files')
    .whereIn('status', ['uploading', 'stored'])
    .whereNull('post_id')
    .where('updated_at', '<', cutoff)
  for (const file of rows) {
    try {
      if (file.storage === 's3' && file.s3_upload_id && file.status === 'uploading') await Storage.abortMultipart(file.storage_key, file.s3_upload_id).catch(() => {})
      await Storage.remove(file.storage, file.storage_key)
    } catch (err) {
      sails.log.warn(`Agora library: could not remove unfinished upload ${file.id}: ${err.message}`)
    }
    await knex()('agora_library_files').where({ id: file.id }).del()
  }
  return rows.length
}

// ---- Items ----

function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function paragraphs (text) {
  return String(text || '').trim().split(/\n{2,}/).filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
}

/** Tags as Hylo topics: lower case, no spaces, 2 to 40 characters, at most 10. */
export function cleanTags (tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',')
  const clean = list
    .map(t => String(t || '').trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter(t => t.length >= 2 && t.length <= 40)
  return [...new Set(clean)].slice(0, 10)
}

function cleanLink (link) {
  const value = String(link || '').trim()
  if (!value) return null
  let url
  try {
    url = new URL(value)
  } catch (e) {
    throw new LibraryError('The link is not a web address. It should start with https://')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new LibraryError('The link should start with https://')
  return url.toString().slice(0, 2000)
}

/** The kind of a new item: what its files are, or a link. */
function itemKindFor (files, link) {
  if (!files.length) return link ? 'link' : 'other'
  const kinds = [...new Set(files.map(f => f.kind))]
  if (kinds.length === 1) return kinds[0]
  for (const k of ['document', 'audio', 'video', 'image']) if (kinds.includes(k)) return k
  return 'other'
}

/** Puts files into the media table of a post and links them to the item. */
async function attachFiles ({ files, item, postId, trx }) {
  for (const [i, file] of files.entries()) {
    const [media] = await trx('media').insert({
      post_id: postId,
      type: file.kind === 'image' ? 'image' : 'file',
      url: fileUrl(file),
      name: file.file_name,
      width: file.width || null,
      height: file.height || null,
      position: i,
      created_at: new Date()
    }).returning('id')
    await trx('agora_library_files').where({ id: file.id }).update({
      item_id: item.id,
      post_id: postId,
      media_id: media.id || media,
      status: 'attached',
      updated_at: new Date()
    })
  }
}

/**
 * Adds an item to a circle's library: a resource post with the files attached.
 * @returns {Promise<object>} the item, as getItem gives it
 */
export async function createItem ({ userId, groupId, title, description, tags, fileIds = [], link }) {
  await assertMember(userId, groupId)
  const ids = [...new Set((Array.isArray(fileIds) ? fileIds : [fileIds]).filter(Boolean).map(Number))]
  if (ids.length > MAX_FILES_PER_ITEM) throw new LibraryError(`One item can hold up to ${MAX_FILES_PER_ITEM} files.`)
  const linkUrl = cleanLink(link)
  const files = ids.length
    ? await knex()('agora_library_files').whereIn('id', ids).where({ group_id: groupId, uploaded_by_id: userId, status: 'stored' }).orderBy('id')
    : []
  if (files.length !== ids.length) throw new LibraryError('One of the files has not arrived, or belongs to someone else.', 409)
  if (!files.length && !linkUrl) throw new LibraryError('Add a file or a link.')
  const name = String(title || '').trim() || (files[0] ? files[0].file_name : linkUrl)
  const kind = itemKindFor(files, linkUrl)

  let body = paragraphs(description)
  if (linkUrl) body += `<p><a href="${escapeHtml(linkUrl)}">${escapeHtml(linkUrl)}</a></p>`

  const post = await createPost(userId, {
    name: name.slice(0, 200),
    description: body,
    type: Post.Type.RESOURCE,
    group_ids: [groupId],
    topicNames: cleanTags(tags),
    skip_link_preview: !linkUrl,
    agoraLibrary: true // Agora: the library queues its own text job (see createPost.js)
  })

  await bookshelf.transaction(async trx => {
    const now = new Date()
    const [item] = await trx('agora_library_items').insert({
      group_id: groupId,
      post_id: post.id,
      kind,
      link_url: linkUrl,
      created_by_id: userId,
      created_at: now,
      updated_at: now
    }).returning('*')
    await attachFiles({ files, item, postId: post.id, trx })
  })

  if (files.length) await Queue.classMethod('AgoraLibrary', 'extractPost', { postId: post.id }, 1000)
  return getItem({ userId, groupId, postId: post.id })
}

// ---- Reading the library ----

/** "%" and "_" mean something in LIKE; this makes them plain characters. */
function likePattern (text) {
  return `%${String(text).replace(/[\\%_]/g, c => `\\${c}`)}%`
}

// The kind of every resource post: the library's own record, or else what its attachments look like.
const KIND_SQL = `coalesce(li.kind,
  case
    when exists (select 1 from media m where m.post_id = p.id and m.type = 'image') then 'image'
    when exists (select 1 from media m where m.post_id = p.id and m.type in ('file', 'gdoc')) then 'document'
    when exists (select 1 from media m where m.post_id = p.id and m.type = 'video') then 'video'
    when p.link_preview_id is not null then 'link'
    else 'other'
  end)`

function baseQuery (groupId) {
  return knex()('posts as p')
    .join('groups_posts as gp', function () { this.on('gp.post_id', 'p.id').andOn('gp.group_id', knex().raw('?', [groupId])) })
    .leftJoin('agora_library_items as li', 'li.post_id', 'p.id')
    .leftJoin('users as u', 'u.id', 'p.user_id')
    .where('p.type', Post.Type.RESOURCE)
    .where('p.active', true)
}

/**
 * A page of a circle's library, newest first.
 * search looks in titles, descriptions, file names, tags and the text read from files.
 */
export async function listItems ({ userId, groupId, search, kind, tag, offset = 0, limit = PAGE_SIZE }) {
  await assertMember(userId, groupId)
  const term = String(search || '').trim().slice(0, 200)
  const kindFilter = KINDS.includes(kind) ? kind : null
  const tagFilter = tag ? cleanTags([tag])[0] : null
  const max = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 100)
  const start = Math.max(Number(offset) || 0, 0)

  const q = baseQuery(groupId)
    .select(
      'p.id', 'p.name', 'p.description', 'p.created_at', 'p.tag_names', 'p.user_id',
      'u.name as user_name', 'u.avatar_url as user_avatar',
      'li.link_url', 'li.meeting_session_id',
      knex().raw(`${KIND_SQL} as kind`)
    )
  if (term) {
    const like = likePattern(term)
    q.where(w => {
      w.where('p.name', 'ilike', like)
        .orWhere('p.description', 'ilike', like)
        .orWhereRaw('exists (select 1 from agora_file_texts t where t.post_id = p.id and t.text ilike ?)', [like])
        .orWhereRaw('exists (select 1 from media m where m.post_id = p.id and m.name ilike ?)', [like])
        .orWhereRaw('? = any(p.tag_names)', [term.toLowerCase().replace(/^#/, '')])
    })
  }
  if (tagFilter) q.whereRaw('? = any(p.tag_names)', [tagFilter])
  if (kindFilter) q.whereRaw(`${KIND_SQL} = ?`, [kindFilter])

  const rows = await q.orderBy('p.created_at', 'desc').orderBy('p.id', 'desc').offset(start).limit(max + 1)
  const page = rows.slice(0, max)
  const postIds = page.map(r => r.id)

  const [files, media, texts, snippets] = await Promise.all([
    postIds.length ? knex()('agora_library_files').whereIn('post_id', postIds).orderBy('id') : [],
    postIds.length ? knex()('media').whereIn('post_id', postIds).whereIn('type', ['image', 'file', 'video', 'gdoc']).orderBy('position') : [],
    postIds.length ? knex()('agora_file_texts').whereIn('post_id', postIds).select('post_id', 'media_id', 'kind', 'status', 'error', knex().raw('length(text) as length')) : [],
    term && postIds.length
      ? knex()('agora_file_texts').whereIn('post_id', postIds).where('text', 'ilike', likePattern(term))
        .select('post_id', knex().raw('substring(text from greatest(strpos(lower(text), lower(?)) - 80, 1) for 220) as snippet', [term]))
      : []
  ])

  const items = page.map(row => itemSummary(row, { files, media, texts, snippets }))
  return { items, hasMore: rows.length > max, offset: start }
}

function textState (texts) {
  if (!texts.length) return null
  if (texts.some(t => t.status === 'done' && Number(t.length) > 0)) return 'done'
  if (texts.some(t => t.status === 'pending' && t.kind !== 'image')) return 'pending'
  if (texts.some(t => t.status === 'failed')) return 'failed'
  if (texts.some(t => t.status === 'too_big')) return 'too_big'
  return texts.every(t => t.kind === 'image') ? null : 'empty'
}

function itemSummary (row, { files, media, texts, snippets }) {
  const ownFiles = files.filter(f => String(f.post_id) === String(row.id))
  const ownMedia = media.filter(m => String(m.post_id) === String(row.id))
  const ownTexts = texts.filter(t => String(t.post_id) === String(row.id))
  const snippet = snippets.find(s => String(s.post_id) === String(row.id))
  return {
    id: String(row.id),
    title: row.name,
    kind: row.kind,
    description: row.description ? htmlToPlain(row.description).slice(0, 300) : '',
    tags: row.tag_names || [],
    createdAt: row.created_at,
    addedBy: { id: String(row.user_id), name: row.user_name, avatarUrl: row.user_avatar || null },
    link: row.link_url || null,
    meeting: Boolean(row.meeting_session_id),
    fileCount: ownMedia.length,
    size: ownFiles.reduce((sum, f) => sum + Number(f.size_bytes || 0), 0) || null,
    textStatus: textState(ownTexts),
    snippet: snippet ? snippet.snippet.replace(/\s+/g, ' ').trim() : null
  }
}

function htmlToPlain (html) {
  return Extract.htmlToText(html)
}

/** One library item with its files and the text read from them. */
export async function getItem ({ userId, groupId, postId }) {
  await assertMember(userId, groupId)
  const row = await baseQuery(groupId)
    .where('p.id', Number(postId) || 0)
    .select('p.id', 'p.name', 'p.description', 'p.created_at', 'p.tag_names', 'p.user_id',
      'u.name as user_name', 'u.avatar_url as user_avatar', 'li.link_url', 'li.meeting_session_id',
      knex().raw(`${KIND_SQL} as kind`))
    .first()
  if (!row) throw new LibraryError('This item is not in the library of this circle.', 404)

  const [files, media, texts] = await Promise.all([
    knex()('agora_library_files').where({ post_id: row.id }).orderBy('id'),
    knex()('media').where({ post_id: row.id }).whereIn('type', ['image', 'file', 'video', 'gdoc']).orderBy('position'),
    FileTexts.listForPost(row.id)
  ])
  const summary = itemSummary(row, { files, media, texts: texts.map(t => ({ ...t, length: (t.text || '').length })), snippets: [] })

  const fileList = media.map(m => {
    const own = files.find(f => String(f.media_id) === String(m.id))
    const name = m.name || decodeURIComponent(String(m.url || '').split('/').pop() || 'file')
    return {
      mediaId: String(m.id),
      name,
      url: m.url,
      kind: own ? own.kind : (m.type === 'image' ? 'image' : kindFor(name, '')),
      mimeType: own ? own.mime_type : null,
      size: own ? Number(own.size_bytes) : null,
      width: (own && own.width) || m.width || null,
      height: (own && own.height) || m.height || null,
      durationSeconds: own ? own.duration_seconds : null
    }
  })

  const SHOW_CHARS = 200000
  const textList = texts.map(t => ({
    id: String(t.id),
    mediaId: t.media_id ? String(t.media_id) : null,
    kind: t.kind,
    title: t.title,
    status: t.status,
    error: t.error,
    language: t.language,
    text: (t.text || '').slice(0, SHOW_CHARS),
    cut: (t.text || '').length > SHOW_CHARS
  }))

  return {
    ...summary,
    descriptionHtml: row.description || '',
    postUrl: `/post/${row.id}`,
    files: fileList,
    texts: textList
  }
}

/**
 * The file behind one members-only address, when this person may open it.
 * @returns {Promise<object>} the agora_library_files row
 */
export async function fileForDownload ({ userId, fileId }) {
  const file = await knex()('agora_library_files as f')
    .join('posts as p', 'p.id', 'f.post_id')
    .where('f.id', Number(fileId) || 0)
    .where('f.status', 'attached')
    .where('p.active', true)
    .first('f.*')
  if (!file) throw new LibraryError('This file does not exist.', 404)
  await assertMember(userId, file.group_id)
  return file
}

// ---- Reading text (the worker) ----

async function withTempDir (fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agora-library-'))
  try {
    return await fn(dir)
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** True when this file's text has already been read, or is being read right now. */
async function alreadyRead ({ postId, mediaId, kind, force }) {
  if (force) return false
  const existing = await FileTexts.findText({ postId, mediaId, kind })
  if (!existing) return false
  if (existing.status === 'pending') {
    return kind !== 'image' && Date.now() - new Date(existing.updated_at).getTime() < PENDING_STALE_MS
  }
  return existing.status === 'done' || existing.status === 'too_big'
}

/**
 * Reads the text of one file at `localPath` and saves it.
 * source: { groupId, postId, mediaId, kind, title, fileName, mimeType, libraryFileId }
 */
async function readOne (source, localPath, workDir) {
  const { groupId, postId, mediaId, kind, title } = source
  const textKind = textKindFor(kind)
  const save = fields => FileTexts.saveText({ groupId, postId, mediaId, kind: textKind, title, ...fields })

  if (kind === 'image') {
    const { width, height } = await Extract.imageSize(localPath)
    if (source.libraryFileId) await knex()('agora_library_files').where({ id: source.libraryFileId }).update({ width, height, updated_at: new Date() })
    if (mediaId && width && height) await knex()('media').where({ id: mediaId }).update({ width, height })
    // Reading text in pictures (OCR) or describing them is a later step.
    return save({ status: 'pending', text: '' })
  }

  if (kind === 'audio' || kind === 'video') {
    const seconds = await Extract.mediaSeconds(localPath)
    if (seconds && source.libraryFileId) {
      await knex()('agora_library_files').where({ id: source.libraryFileId }).update({ duration_seconds: Math.round(seconds), updated_at: new Date() })
    }
    if (seconds && seconds > maxTranscribeMinutes() * 60) {
      return save({ status: 'too_big', error: `The recording is ${Math.round(seconds / 60)} minutes long. Agora turns up to ${maxTranscribeMinutes()} minutes into text (AGORA_LIBRARY_MAX_TRANSCRIBE_MINUTES).` })
    }
    if (!Transcription.isConfigured()) {
      return save({ status: 'failed', error: 'Speech to text is not connected yet (AGORA_TRANSCRIPTION_URL and KEY). Once it is, run scripts/agora-library-backfill.js --apply.' })
    }
    await save({ status: 'pending' })
    const text = await Extract.transcribeRecording(localPath, workDir, Transcription)
    return save({ status: 'done', text, language: process.env.AGORA_TRANSCRIPTION_LANGUAGE || null })
  }

  const type = Extract.documentType(source.fileName, source.mimeType)
  if (!type) {
    return save({ status: 'failed', error: 'Agora cannot read the text of this kind of file yet.' })
  }
  await save({ status: 'pending' })
  const text = await Extract.documentText(localPath, type)
  return save({ status: 'done', text })
}

async function readSafely (source, copyTo) {
  return withTempDir(async dir => {
    try {
      const local = path.join(dir, `file${path.extname(Storage.safeFileName(source.fileName)).slice(0, 12)}`)
      await copyTo(local)
      const work = path.join(dir, 'work')
      await fs.promises.mkdir(work)
      return await readOne(source, local, work)
    } catch (err) {
      const status = err instanceof ExtractError ? err.status : 'failed'
      if (!(err instanceof ExtractError)) sails.log.error(`Agora library: reading post ${source.postId} media ${source.mediaId}: ${err.message}`)
      return FileTexts.saveText({
        groupId: source.groupId,
        postId: source.postId,
        mediaId: source.mediaId,
        kind: textKindFor(source.kind),
        title: source.title,
        status,
        error: err.message || 'The file could not be read.'
      })
    }
  })
}

/**
 * Worker job: reads the text of every file of one library item that has not
 * been read yet. Never throws for a file that cannot be read: that is saved as
 * "failed" with the reason, so the job is not tried again and nothing is paid twice.
 */
export async function extractPost ({ postId, force = false }) {
  const post = await knex()('posts').where({ id: postId }).first('id', 'name', 'type', 'active')
  if (!post || !post.active || post.type !== Post.Type.RESOURCE) return { read: 0 }
  const item = await knex()('agora_library_items').where({ post_id: postId }).first()
  const groupId = item ? item.group_id : (await knex()('groups_posts').where({ post_id: postId }).orderBy('id').first('group_id') || {}).group_id
  if (!groupId) return { read: 0 }

  const files = await knex()('agora_library_files').where({ post_id: postId, status: 'attached' }).orderBy('id')
  const media = await knex()('media').where({ post_id: postId }).whereIn('type', ['image', 'file']).orderBy('position')
  let read = 0

  for (const m of media) {
    const own = files.find(f => String(f.media_id) === String(m.id)) ||
      files.find(f => String(f.id) === String(fileIdFromUrl(m.url)))
    const fileName = own ? own.file_name : (m.name || decodeURIComponent(String(m.url || '').split('/').pop() || 'file'))
    const kind = own ? own.kind : (m.type === 'image' ? 'image' : kindFor(fileName, ''))
    if (item && item.kind === 'meeting') continue // its text is saved when it is filed
    const source = {
      groupId,
      postId,
      mediaId: m.id,
      kind,
      title: fileName,
      fileName,
      mimeType: own ? own.mime_type : null,
      libraryFileId: own ? own.id : null
    }
    if (await alreadyRead({ postId, mediaId: m.id, kind: textKindFor(kind), force })) continue

    if (own) {
      await readSafely(source, target => Storage.copyToFile(own.storage, own.storage_key, target))
      read++
      continue
    }
    // An attachment made with Hylo's own button, kept on Agora's own disk.
    const key = diskUploads.keyFromUrl(m.url)
    if (key && diskUploads.inUse()) {
      await readSafely(source, target => fs.promises.copyFile(diskUploads.filePath(key), target))
      read++
    }
  }
  return { read }
}

// ---- Meeting notes ----

function minutesAsText (minutes) {
  if (!minutes) return ''
  const lines = []
  if (minutes.summary) lines.push('Summary', minutes.summary, '')
  if (minutes.decisions && minutes.decisions.length) lines.push('Decisions', ...minutes.decisions.map(d => `- ${d}`), '')
  if (minutes.actions && minutes.actions.length) {
    lines.push('Actions', ...minutes.actions.map(a => `- ${(a && a.who) || ''}: ${(a && a.what) || ''}${a && a.due ? ` (by ${a.due})` : ''}`), '')
  }
  if (minutes.open_questions && minutes.open_questions.length) lines.push('Open questions', ...minutes.open_questions.map(q => `- ${q}`), '')
  if (minutes.topics && minutes.topics.length) {
    lines.push('What was discussed')
    for (const t of minutes.topics) {
      lines.push(`${(t && t.title) || ''}`)
      for (const p of (t && Array.isArray(t.points) ? t.points : [])) lines.push(`- ${p}`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

/**
 * Files the notes of a meeting that has ended in the library of each circle of
 * its event: a resource post "Meeting notes: <event> (<date>)" with the
 * transcript (and the minutes, when the assistant wrote them) as text files,
 * and the full text saved for search and AI. Does nothing for a meeting that
 * was filed before.
 *
 * @returns {Promise<Array>} the posts made
 */
export async function fileMeeting ({ sessionId, title, date, attendees = [], lines = [], startedAt, minutes = null, minutesText: givenMinutesText = '', minutesPostId = null, assistantId, groupIds }) {
  const already = await knex()('agora_library_items').where({ meeting_session_id: sessionId }).first('id')
  if (already) return []
  if (!lines.length) return []

  const transcript = MeetingMinutes.transcriptAsText(lines, startedAt)
  const heading = `Meeting: ${title}\nDate: ${date}\nPresent: ${attendees.join(', ') || 'unknown'}`
  const minutesText = minutesAsText(minutes) || String(givenMinutesText || '').trim()
  const fullText = [heading, minutesText ? `Minutes (written by the Agora assistant)\n\n${minutesText}` : null, `Transcript\n\n${transcript}`]
    .filter(Boolean).join('\n\n')
  const itemTitle = `Meeting notes: ${title} (${date})`
  const storage = Storage.backend()
  const made = []

  for (const groupId of groupIds) {
    const parts = [`<p>${escapeHtml(`The notes of the meeting "${title}" on ${date}, filed by the Agora assistant.`)}</p>`]
    if (attendees.length) parts.push(`<p>${escapeHtml(`Present: ${attendees.join(', ')}`)}</p>`)
    if (minutes && minutes.summary) parts.push(`<p>${escapeHtml(minutes.summary)}</p>`)
    if (minutesPostId) parts.push(`<p><a href="${escapeHtml(siteUrl(`/post/${minutesPostId}`))}">${escapeHtml('The minutes, with comments')}</a></p>`)

    const post = await createPost(assistantId, {
      name: itemTitle.slice(0, 200),
      description: parts.join(''),
      type: Post.Type.RESOURCE,
      group_ids: [groupId],
      topicNames: ['minutes', 'meeting-notes'],
      skip_link_preview: true,
      agoraLibrary: true
    })

    const fileRows = []
    const toStore = [{ name: `Transcript ${date}.txt`, text: `${heading}\n\n${transcript}\n` }]
    if (minutesText) toStore.push({ name: `Minutes ${date}.txt`, text: `${heading}\n\n${minutesText}\n` })
    for (const f of toStore) {
      const buffer = Buffer.from(f.text, 'utf8')
      const key = Storage.makeKey(groupId, f.name)
      await Storage.writeBuffer(storage, key, buffer, 'text/plain; charset=utf-8')
      const now = new Date()
      const [row] = await knex()('agora_library_files').insert({
        group_id: groupId,
        uploaded_by_id: assistantId,
        kind: 'document',
        file_name: f.name,
        mime_type: 'text/plain',
        size_bytes: buffer.length,
        storage,
        storage_key: key,
        status: 'stored',
        created_at: now,
        updated_at: now
      }).returning('*')
      fileRows.push(row)
    }

    let transcriptMediaId = null
    await bookshelf.transaction(async trx => {
      const now = new Date()
      const [item] = await trx('agora_library_items').insert({
        group_id: groupId,
        post_id: post.id,
        kind: 'meeting',
        meeting_session_id: sessionId,
        created_by_id: assistantId,
        created_at: now,
        updated_at: now
      }).returning('*')
      await attachFiles({ files: fileRows, item, postId: post.id, trx })
    })
    const transcriptRow = await knex()('agora_library_files').where({ id: fileRows[0].id }).first('media_id')
    transcriptMediaId = transcriptRow && transcriptRow.media_id

    await FileTexts.saveText({
      groupId,
      postId: post.id,
      mediaId: transcriptMediaId,
      kind: 'meeting',
      title: itemTitle,
      text: fullText,
      language: process.env.AGORA_TRANSCRIPTION_LANGUAGE || null,
      status: 'done'
    })
    made.push(post)
  }
  return made
}

// ---- Catching up (scripts/agora-library-backfill.js) ----

/**
 * The minutes part of a minutes post written before the library existed: its
 * text up to "Who was there" (the transcript itself comes from the meeting).
 */
function minutesFromPost (html) {
  const text = Extract.htmlToText(html || '')
  const cut = text.search(/\n?Who was there\n/)
  const part = (cut >= 0 ? text.slice(0, cut) : text).trim()
  return /is not connected yet|could not write a summary/.test(part) ? '' : part
}

/**
 * What is missing from the libraries: meetings that ended before meeting notes
 * were filed, and resource attachments whose text was not read (or failed).
 * With apply: files those meetings and reads those texts, one after another.
 * @returns {Promise<{ meetings: Array, posts: Array }>}
 */
export async function backfill ({ apply = false, log = () => {} } = {}) {
  const sessions = await knex()('meeting_sessions as s')
    .leftJoin('agora_library_items as li', 'li.meeting_session_id', 's.id')
    .whereNull('li.id')
    .where('s.status', 'closed')
    .whereNotNull('s.minutes_post_id')
    .orderBy('s.id')
    .select('s.id', 's.post_id', 's.started_at', 's.minutes_post_id')

  const meetings = []
  for (const s of sessions) {
    const event = await knex()('posts').where({ id: s.post_id }).first('id', 'name')
    const groupIds = (await knex()('groups_posts').where({ post_id: s.post_id }).select('group_id')).map(r => r.group_id)
    const lines = await MeetingSession.lines(s.id)
    const title = (event && event.name) || 'Meeting'
    const date = new Date(s.started_at).toISOString().slice(0, 10)
    meetings.push({ sessionId: s.id, title, date, lines: lines.length, groups: groupIds.length })
    log(`Meeting ${s.id} "${title}" (${date}): ${lines.length} transcript lines, ${groupIds.length} circle(s)${lines.length ? '' : ', nothing to file'}`)
    if (!apply || !lines.length || !groupIds.length) continue
    const attendees = (await knex()('meeting_participants as mp').join('users as u', 'u.id', 'mp.user_id')
      .where('mp.session_id', s.id).orderBy('mp.joined_at').select('u.name')).map(r => r.name)
    const minutesPost = await knex()('posts').where({ id: s.minutes_post_id }).first('description')
    const assistant = await MeetingSession.assistantUser()
    await fileMeeting({
      sessionId: s.id,
      title,
      date,
      attendees,
      lines,
      startedAt: s.started_at,
      minutesText: minutesFromPost(minutesPost && minutesPost.description),
      minutesPostId: s.minutes_post_id,
      assistantId: assistant.id,
      groupIds
    })
    log('  filed')
  }

  const unread = await knex()('posts as p')
    .join('media as m', 'm.post_id', 'p.id')
    .leftJoin('agora_library_items as li', 'li.post_id', 'p.id')
    .where('p.type', Post.Type.RESOURCE)
    .where('p.active', true)
    .whereIn('m.type', ['image', 'file'])
    .where(q => q.whereNull('li.kind').orWhereNot('li.kind', 'meeting'))
    .whereNotExists(function () {
      this.select(knex().raw(1)).from('agora_file_texts as t')
        .whereRaw('t.media_id = m.id')
        // Pictures stay "pending" until reading them (OCR) is built: their size is all there is now.
        .where(q => q.whereIn('t.status', ['done', 'too_big']).orWhere('t.kind', 'image'))
    })
    .groupBy('p.id', 'p.name')
    .orderBy('p.id')
    .select('p.id', 'p.name', knex().raw('count(m.id) as files'))

  const posts = []
  for (const p of unread) {
    posts.push({ postId: p.id, title: p.name, files: Number(p.files) })
    log(`Resource ${p.id} "${p.name}": ${p.files} file(s) without text`)
    if (!apply) continue
    const result = await extractPost({ postId: p.id })
    log(`  read ${result.read}`)
  }
  return { meetings, posts }
}

export const _private = { publicUpload, partSizeFor, minutesAsText, likePattern, itemKindFor }

export default {
  KINDS,
  CHUNK_BYTES,
  SINGLE_PUT_LIMIT,
  LibraryError,
  maxBytesFor,
  maxTranscribeMinutes,
  kindFor,
  fileUrl,
  fileIdFromUrl,
  isMember,
  startUpload,
  uploadChunk,
  partUrls,
  switchToRelay,
  finishUpload,
  cleanUnfinishedUploads,
  cleanTags,
  createItem,
  listItems,
  getItem,
  fileForDownload,
  extractPost,
  fileMeeting,
  backfill
}
