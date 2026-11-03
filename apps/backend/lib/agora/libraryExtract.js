/**
 * Agora: reads the text out of the files in a circle's library.
 *
 * Runs in the worker (see AgoraLibrary.extractPost), never while a member waits.
 * It uses well-known programs that come with Ubuntu, installed by
 * agora/vps/setup-server.sh and agora/vps/update.sh:
 *
 *   pdftotext (poppler-utils)  PDF
 *   unzip                      Word (.docx), OpenDocument (.odt, .ods, .odp) and
 *                              PowerPoint (.pptx): these are zip files with XML inside
 *   ffprobe, ffmpeg            the length of a recording, and cutting it into
 *                              pieces for speech to text
 *
 * Plain text, Markdown, CSV and web pages are read directly. Old Word files
 * (.doc), spreadsheets in Excel format and other kinds are not read (yet).
 *
 * Pictures: only their size in pixels is stored now. Reading text in a picture
 * (OCR) or describing it is a later step; its text row stays "pending".
 *
 * Recordings are sent to the speech to text service that the meeting room uses
 * (api/services/Transcription.js, AGORA_TRANSCRIPTION_URL/KEY/MODEL). That
 * service takes at most 25 MB per request, so ffmpeg first turns the sound into
 * pieces of 10 minutes of mono MP3 at 48 kbit/s, about 3.6 MB each.
 *
 * Every program gets the file's path as an argument, never through a shell, and
 * has a time limit and an output limit, because files come from members.
 */
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

export const PIECE_SECONDS = 600
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024
const OUTPUT_LIMIT = 64 * 1024 * 1024
const TEXT_FILE_LIMIT = 20 * 1024 * 1024

export class ExtractError extends Error {
  constructor (message, status = 'failed') {
    super(message)
    this.status = status
  }
}

function defaultRunner (command, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: OUTPUT_LIMIT, encoding: 'buffer', windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') {
          return reject(new ExtractError(`The program "${command}" is not installed on this server. Run agora/vps/update.sh, which installs it.`))
        }
        if (err.killed) return reject(new ExtractError(`Reading the file took too long (${command}).`))
        if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new ExtractError('The file holds more text than Agora reads at once.', 'too_big'))
        const detail = String(stderr || '').trim().split('\n').slice(-1)[0]
        return reject(new ExtractError(`${command} could not read the file${detail ? `: ${detail.slice(0, 200)}` : '.'}`))
      }
      resolve({ stdout, stderr })
    })
  })
}

let runner = defaultRunner

/** For tests: replaces the programs with a stand-in. null puts the real ones back. */
export function setRunner (fn) {
  runner = fn || defaultRunner
}

const run = (command, args, options) => runner(command, args, options)

// ---- Which reader fits ----

const EXT_TYPES = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.docm': 'docx',
  '.odt': 'odf',
  '.ods': 'odf',
  '.odp': 'odf',
  '.pptx': 'pptx',
  '.txt': 'text',
  '.md': 'text',
  '.markdown': 'text',
  '.csv': 'text',
  '.tsv': 'text',
  '.json': 'text',
  '.srt': 'text',
  '.vtt': 'text',
  '.html': 'html',
  '.htm': 'html'
}

const MIME_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odf',
  'application/vnd.oasis.opendocument.spreadsheet': 'odf',
  'application/vnd.oasis.opendocument.presentation': 'odf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
  'text/html': 'html'
}

/** The reader for a document, or null when Agora cannot read its text. */
export function documentType (fileName, mimeType) {
  const ext = path.extname(String(fileName || '')).toLowerCase()
  if (EXT_TYPES[ext]) return EXT_TYPES[ext]
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase()
  return MIME_TYPES[type] || null
}

// ---- XML inside Office and OpenDocument files ----

function decodeEntities (text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function safeCodePoint (n) {
  try {
    return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : ''
  } catch (e) {
    return ''
  }
}

function tidy (text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Word's document.xml as plain text: one paragraph per line. */
export function docxXmlToText (xml) {
  return tidy(decodeEntities(String(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<[^>]+>/g, '')))
}

/** OpenDocument's content.xml as plain text. */
export function odfXmlToText (xml) {
  return tidy(decodeEntities(String(xml)
    .replace(/<office:annotation\b[\s\S]*?<\/office:annotation>/g, '')
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<text:line-break\/>/g, '\n')
    .replace(/<text:s\/>/g, ' ')
    .replace(/<text:s text:c="(\d+)"\/>/g, (_, n) => ' '.repeat(Math.min(Number(n), 50)))
    .replace(/<\/(text:p|text:h)>/g, '\n')
    .replace(/<\/table:table-cell>/g, '\t')
    .replace(/<\/table:table-row>/g, '\n')
    .replace(/<[^>]+>/g, '')))
}

/** One PowerPoint slide as plain text. */
export function slideXmlToText (xml) {
  return tidy(decodeEntities(String(xml)
    .replace(/<a:br\b[^>]*\/>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<[^>]+>/g, '')))
}

/** A web page as plain text. Scripts and styles are left out. */
export function htmlToText (html) {
  return tidy(decodeEntities(String(html)
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, '')))
}

async function unzipEntry (file, entry) {
  const { stdout } = await run('unzip', ['-p', file, entry], { timeout: 60000 })
  return stdout.toString('utf8')
}

/**
 * The text of a document.
 * @returns {Promise<string>}
 */
export async function documentText (file, type) {
  switch (type) {
    case 'pdf': {
      const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', '-q', file, '-'], { timeout: 180000 })
      return tidy(stdout.toString('utf8').replace(/\f/g, '\n\n'))
    }
    case 'docx':
      return docxXmlToText(await unzipEntry(file, 'word/document.xml'))
    case 'odf':
      return odfXmlToText(await unzipEntry(file, 'content.xml'))
    case 'pptx': {
      const { stdout } = await run('unzip', ['-Z1', file], { timeout: 60000 })
      const slides = stdout.toString('utf8').split('\n')
        .map(line => line.trim())
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]))
      const parts = []
      for (const [i, name] of slides.entries()) {
        const text = slideXmlToText(await unzipEntry(file, name))
        if (text) parts.push(`Slide ${i + 1}\n${text}`)
      }
      return parts.join('\n\n')
    }
    case 'text':
    case 'html': {
      const stat = await fs.promises.stat(file)
      if (stat.size > TEXT_FILE_LIMIT) throw new ExtractError(`The file is larger than ${TEXT_FILE_LIMIT / 1048576} MB of text.`, 'too_big')
      const raw = (await fs.promises.readFile(file)).toString('utf8').replace(/^\uFEFF/, '')
      return type === 'html' ? htmlToText(raw) : tidy(raw)
    }
    default:
      throw new ExtractError('Agora cannot read the text of this kind of file yet.')
  }
}

// ---- Pictures ----

/** The size of a picture in pixels, or nulls when it cannot be read. */
export async function imageSize (file) {
  try {
    const sharp = require('sharp')
    const meta = await sharp(file, { failOn: 'none', limitInputPixels: 268402689 }).metadata()
    return { width: meta.width || null, height: meta.height || null }
  } catch (err) {
    return { width: null, height: null }
  }
}

// ---- Recordings ----

/** The length of a recording in seconds, or null. */
export async function mediaSeconds (file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: 60000 })
    const seconds = parseFloat(stdout.toString('utf8').trim())
    return Number.isFinite(seconds) ? seconds : null
  } catch (err) {
    if (err instanceof ExtractError && /not installed/.test(err.message)) throw err
    return null
  }
}

/** Cuts the sound of a recording (or a video) into MP3 pieces of PIECE_SECONDS. Resolves with their paths, in order. */
export async function splitAudio (file, outDir) {
  await run('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k',
    '-f', 'segment', '-segment_time', String(PIECE_SECONDS), '-reset_timestamps', '1',
    path.join(outDir, 'piece-%03d.mp3')
  ], { timeout: 60 * 60 * 1000 })
  const pieces = (await fs.promises.readdir(outDir))
    .filter(name => /^piece-\d{3}\.mp3$/.test(name))
    .sort()
    .map(name => path.join(outDir, name))
  if (!pieces.length) throw new ExtractError('No sound was found in this file.')
  return pieces
}

function clock (seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * The words spoken in a recording. Each piece of 10 minutes starts with its
 * time in the recording, such as [10:00].
 * @param {string} file       the recording on this server
 * @param {string} workDir    an empty folder for the pieces
 * @param {object} transcription  api/services/Transcription.js (or a stand-in)
 */
export async function transcribeRecording (file, workDir, transcription) {
  const pieces = await splitAudio(file, workDir)
  const parts = []
  for (const [i, piece] of pieces.entries()) {
    const audio = await fs.promises.readFile(piece)
    if (audio.length > MAX_REQUEST_BYTES) throw new ExtractError('A piece of the recording is larger than the 25 MB that speech to text accepts.')
    const text = await transcription.transcribe({ audio, mimeType: 'audio/mpeg', timeoutMs: 10 * 60 * 1000 })
    if (text) parts.push(`[${clock(i * PIECE_SECONDS)}] ${text}`)
    await fs.promises.unlink(piece).catch(() => {})
  }
  return parts.join('\n\n')
}

export default {
  PIECE_SECONDS,
  MAX_REQUEST_BYTES,
  ExtractError,
  setRunner,
  documentType,
  documentText,
  docxXmlToText,
  odfXmlToText,
  slideXmlToText,
  htmlToText,
  imageSize,
  mediaSeconds,
  splitAudio,
  transcribeRecording
}
