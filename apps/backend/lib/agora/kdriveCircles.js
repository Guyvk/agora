/**
 * Agora: each circle's folder in kDrive, and who may do what in it.
 *
 * - Agora keeps its folders in one top folder, AGORA_KDRIVE_ROOT_FOLDER_ID,
 *   which must be set (kDrive is not used without it).
 * - Each circle gets a folder in it, called "<circle name> (<circle address>)",
 *   made the first time a member opens the circle's Files page or a meeting's
 *   minutes are saved. Its number is kept in agora_kdrive_folders, so renaming
 *   the circle or the folder changes nothing.
 * - A space (a smaller group inside a circle) gets its own folder inside its
 *   circle's folder. Members of the circle do not see it there, and cannot
 *   open it from the circle's Files page: only members of the space reach it,
 *   from the space's own Files page.
 * - Members of a circle (active members, checked by the controller on every
 *   call) see its folder and everything in it, open folders, download, add
 *   files and make folders.
 * - Renaming and deleting is for the member who added the file or folder in
 *   Agora, and for the circle's stewards (Administration or Manage Content, as
 *   for moderating posts). Deleting moves it to kDrive's bin. Nobody renames
 *   or deletes the circle's own folder or its "Minutes" folder from Agora, and
 *   no other folder at the top of the circle's folder may be called Minutes.
 * - Members can also add a link to a Google Doc, Sheet, Slides, Form or Drive
 *   file or folder (lib/agora/googleLinks.js). It is kept in agora_kdrive_links,
 *   not in kDrive, and listed in the folder it was added in, with the files.
 *   Its number on the page is "link-<number>". Renaming (the title) and
 *   deleting follow the same rule as for files; deleting really removes it.
 * - Agora never shows, changes or hands out anything outside the circle's
 *   folder. Every file or folder asked for is checked by walking up its
 *   parent folders to the circle's folder.
 *
 * All calls to kDrive go through lib/agora/kdrive.js.
 */
const Kdrive = require('./kdrive')
const GoogleLinks = require('./googleLinks')

const { KdriveError, NOT_HERE } = Kdrive
const MAX_DEPTH = 30
// Only the list of a folder uses cached details; every check before a
// download, upload, rename or delete walks up the folders afresh.
const INFO_SECONDS = 60
const MINUTES_FOLDER = 'Minutes'

const infoCache = new Map()
const making = new Map()

/** For tests: forgets what was looked up. */
function forget () {
  infoCache.clear()
  making.clear()
}

function knex () {
  return bookshelf.knex
}

/**
 * A name kDrive and people can live with: no control characters or slashes,
 * spaces tidied, at most 240 bytes (kDrive allows 255). Null when nothing is left.
 */
function cleanName (value) {
  let name = String(value || '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    // Invisible and direction-changing characters, which can make a name look
    // like another. U+200C and U+200D stay: Hindi and emoji need them.
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  while (Buffer.byteLength(name, 'utf8') > 240) name = name.slice(0, -1)
  name = name.trim()
  return name && name !== '.' && name !== '..' ? name : null
}

/** The folder name of a circle or space: its name and its address, which is unique. */
function folderNameFor (group) {
  return cleanName(`${group.get('name') || 'Circle'} (${group.get('slug')})`) || `Circle ${group.id}`
}

function isUsable (info) {
  return Boolean(info) && !['trashed', 'trash_inherited'].includes(info.status)
}

/** Details of a file or folder; folders on the way up are cached for a minute. */
async function info (id, { fresh = false } = {}) {
  const key = String(id)
  const hit = infoCache.get(key)
  if (!fresh && hit && hit.until > Date.now()) return hit.value
  const value = await Kdrive.fileInfo(key)
  infoCache.set(key, { value, until: Date.now() + INFO_SECONDS * 1000 })
  return value
}

function dropInfo (id) {
  infoCache.delete(String(id))
}

/** Finds or makes a folder with this name in parent. Two programs doing this at once end up with the same folder. */
async function folderIn (parentId, name) {
  const existing = await Kdrive.childByName(parentId, name)
  if (existing && existing.type === 'dir' && isUsable(existing)) return existing
  try {
    return await Kdrive.createDirectory(parentId, name)
  } catch (err) {
    if (err.code !== 'conflict') throw err
    const now = await Kdrive.childByName(parentId, name)
    if (now && now.type === 'dir' && isUsable(now)) return now
    throw err
  }
}

/**
 * The folder that holds Agora's circle folders: AGORA_KDRIVE_ROOT_FOLDER_ID.
 * It is required, so Guy decides who else can open it in kDrive; Agora never
 * looks for or makes a top folder itself.
 */
async function agoraFolderId () {
  const set = Kdrive.rootFolderSetting()
  if (!set) throw new KdriveError('not_configured', 'kDrive is not connected to Agora yet.')
  return set
}

/** True for the name kept for the circle's minutes, in any capitals. */
function isMinutesName (name) {
  return String(cleanName(name) || '').replace(/[\u200c\u200d]/g, '').toLowerCase() === MINUTES_FOLDER.toLowerCase()
}

/** Members add nothing to the folder Agora keeps the minutes in. */
function refuseMinutesFolder (row, folder) {
  if (row && row.minutes_folder_id && String(row.minutes_folder_id) === String(folder.id)) {
    throw new KdriveError('not_allowed', 'The Minutes folder is only for the meeting minutes, which Agora saves there itself.')
  }
}

async function folderRow (groupId) {
  return knex()('agora_kdrive_folders').where({ group_id: groupId }).first()
}

/** The folders of all other circles and spaces, which are never shown or opened from this one. */
async function otherCircleFolders (groupId) {
  const rows = await knex()('agora_kdrive_folders').whereNot({ group_id: groupId }).select('folder_id')
  return new Set(rows.map(r => String(r.folder_id)))
}

/** The circle a space belongs to, or null for a circle. */
async function parentCircle (group) {
  const parentId = group.get('parent_id')
  if (group.get('type') !== 'space' || !parentId) return null
  return Group.where({ id: parentId }).fetch()
}

/**
 * The kDrive folder of a circle or space, made the first time. A folder that
 * was deleted in kDrive is made again (its files stay in kDrive's bin).
 */
async function circleFolderId (group, depth = 0) {
  const row = await folderRow(group.id)
  if (row) {
    try {
      const found = await info(row.folder_id)
      if (found.type === 'dir' && isUsable(found)) return String(row.folder_id)
    } catch (err) {
      if (err.code !== 'not_found') throw err
    }
    dropInfo(row.folder_id)
    sails.log.warn(`Agora kDrive: the folder of group ${group.id} is gone or in the bin; making a new one`)
  }
  const key = String(group.id)
  if (!making.has(key)) {
    const job = (async () => {
      const parent = depth < 5 ? await parentCircle(group) : null
      const parentFolder = parent ? await circleFolderId(parent, depth + 1) : await agoraFolderId()
      const folder = await folderIn(parentFolder, folderNameFor(group))
      const now = new Date()
      await knex()('agora_kdrive_folders')
        .insert({ group_id: group.id, folder_id: folder.id, created_at: now, updated_at: now })
        .onConflict('group_id')
        .merge({ folder_id: folder.id, minutes_folder_id: null, updated_at: now })
      sails.log.info(`Agora kDrive: made or found the folder of group ${group.id}`)
      return String(folder.id)
    })()
    making.set(key, job)
    job.finally(() => making.delete(key)).catch(() => {})
  }
  return making.get(key)
}

/**
 * A file or folder inside the circle's folder. Walks up its parent folders to
 * the circle's folder; refuses anything elsewhere, in the bin, or inside the
 * folder of another circle or space. Throws not_found otherwise, with one
 * message for all of these, so the answer tells nothing about what is there.
 */
async function itemInCircle (group, circleFolder, id, { type, cached = false } = {}) {
  const itemId = Kdrive.idFrom(id)
  if (!itemId || itemId === String(circleFolder)) throw new KdriveError('not_found', NOT_HERE)
  const others = await otherCircleFolders(group.id)
  let item
  try {
    item = await info(itemId, { fresh: true })
  } catch (err) {
    if (err.code === 'not_found' || err.code === 'bad_request') throw new KdriveError('not_found', NOT_HERE)
    throw err
  }
  if (!isUsable(item) || (type && item.type !== type) || others.has(itemId)) throw new KdriveError('not_found', NOT_HERE)
  let current = item.parent_id
  for (let depth = 0; depth < MAX_DEPTH && current; depth++) {
    if (String(current) === String(circleFolder)) return item
    if (others.has(String(current))) break
    const parent = await info(current, { fresh: !cached })
    if (!isUsable(parent)) break
    current = parent.parent_id
  }
  throw new KdriveError('not_found', NOT_HERE)
}

/** The circle's folder, or a folder inside it. cached: only for showing a list. */
async function folderInCircle (group, folderId, { cached = false } = {}) {
  const circleFolder = await circleFolderId(group)
  if (!folderId || String(folderId) === circleFolder) {
    return { circleFolder, folder: await info(circleFolder, { fresh: !cached }), isCircleFolder: true }
  }
  return { circleFolder, folder: await itemInCircle(group, circleFolder, folderId, { type: 'dir', cached }), isCircleFolder: false }
}

async function isSteward (userId, group) {
  if (!userId) return false
  const { RESP_ADMINISTRATION, RESP_MANAGE_CONTENT } = Responsibility.constants
  const responsibilities = await Responsibility.fetchForUserAndGroupAsStrings(userId, group.id)
  return responsibilities.includes(RESP_ADMINISTRATION) || responsibilities.includes(RESP_MANAGE_CONTENT)
}

async function remember (fileId, group, userId, kind) {
  await knex()('agora_kdrive_items')
    .insert({ file_id: fileId, group_id: group.id, user_id: userId || null, kind, created_at: new Date() })
    .onConflict('file_id')
    .merge({ group_id: group.id, user_id: userId || null, kind })
}

function asIso (seconds) {
  const n = Number(seconds)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null
}

/** One file or folder as the Files page shows it. */
function toItem (f, added, userId, steward) {
  const mine = Boolean(added && userId && String(added.user_id) === String(userId))
  return {
    id: String(f.id),
    name: f.name,
    kind: f.type === 'dir' ? 'folder' : 'file',
    size: f.type === 'dir' ? null : (Number.isFinite(Number(f.size)) ? Number(f.size) : null),
    mimeType: f.type === 'dir' ? null : (f.mime_type || null),
    changedAt: asIso(f.last_modified_at) || asIso(f.added_at),
    addedBy: added ? added.name || null : null,
    canChange: steward || mine
  }
}

function byFolderThenName (a, b) {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

const LINK_PREFIX = 'link-'
const MAX_LINKS = 1000

/** The number of a link from its id on the page ("link-12"), or null when it is not one. */
function linkNumber (id) {
  const m = /^link-([1-9]\d{0,15})$/.exec(String(id === undefined || id === null ? '' : id))
  return m ? m[1] : null
}

/** One link as the Files page shows it. folderId null: the circle's own folder. */
function toLinkItem (row, userId, steward) {
  const mine = Boolean(row.user_id && userId && String(row.user_id) === String(userId))
  return {
    id: `${LINK_PREFIX}${row.id}`,
    name: row.title,
    kind: 'link',
    service: row.kind,
    url: row.url,
    size: null,
    mimeType: null,
    changedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    addedBy: row.user_name || null,
    canChange: steward || mine
  }
}

async function linksIn (group, folderId, userId, steward) {
  const query = knex()('agora_kdrive_links')
    .leftJoin('users', 'users.id', 'agora_kdrive_links.user_id')
    .where('agora_kdrive_links.group_id', group.id)
  if (folderId) query.where('agora_kdrive_links.folder_id', folderId)
  else query.whereNull('agora_kdrive_links.folder_id')
  const rows = await query.select('agora_kdrive_links.*', 'users.name as user_name')
  return rows.map(row => toLinkItem(row, userId, steward))
}

/**
 * What the circle's Files page shows: a folder (the circle's own, or one
 * inside it) and what is in it.
 */
async function list (group, folderId, userId) {
  const { folder, isCircleFolder } = await folderInCircle(group, folderId, { cached: true })
  const others = await otherCircleFolders(group.id)
  const children = (await Kdrive.listFolder(folder.id)).filter(f => isUsable(f) && !others.has(String(f.id)))
  const ids = children.map(f => f.id)
  const added = ids.length
    ? await knex()('agora_kdrive_items')
      .leftJoin('users', 'users.id', 'agora_kdrive_items.user_id')
      .whereIn('agora_kdrive_items.file_id', ids)
      .select('agora_kdrive_items.file_id', 'agora_kdrive_items.user_id', 'users.name')
    : []
  const byId = new Map(added.map(row => [String(row.file_id), row]))
  const steward = await isSteward(userId, group)
  const row = await folderRow(group.id)
  // The Minutes folder shows no Rename or Delete for anyone (changeable() refuses it too).
  const kept = f => isCircleFolder && f.type === 'dir' &&
    ((row && String(row.minutes_folder_id) === String(f.id)) || isMinutesName(f.name))
  const links = await linksIn(group, isCircleFolder ? null : folder.id, userId, steward)
  return {
    folder: { id: String(folder.id), name: isCircleFolder ? group.get('name') : folder.name, isCircleFolder },
    items: children.map(f => {
      const item = toItem(f, byId.get(String(f.id)), userId, steward)
      if (kept(f)) item.canChange = false
      return item
    }).concat(links).sort(byFolderThenName),
    isSteward: steward
  }
}

/** Adds a file to the circle's folder, or a folder inside it. stream carries exactly size bytes. */
async function addFile (group, { folderId, userId, name, size, stream }) {
  const fileName = cleanName(name)
  if (!fileName) throw new KdriveError('bad_request', 'The file needs a name.')
  if (!Number.isSafeInteger(size) || size <= 0) throw new KdriveError('bad_request', 'The file is empty.')
  if (size > Kdrive.maxUploadBytes()) throw new KdriveError('too_large', `The file is larger than ${Math.round(Kdrive.maxUploadBytes() / 1048576)} MB.`)
  const { folder, isCircleFolder } = await folderInCircle(group, folderId)
  if (isCircleFolder && isMinutesName(fileName)) throw minutesKept()
  refuseMinutesFolder(await folderRow(group.id), folder)
  const file = await Kdrive.upload({ folderId: folder.id, name: fileName, size, stream })
  if (file && file.id) await remember(file.id, group, userId, 'file')
  const user = userId ? await User.find(userId) : null
  return toItem(file || { name: fileName }, { user_id: userId, name: user ? user.get('name') : null }, userId, false)
}

async function makeFolder (group, { folderId, userId, name }) {
  const folderName = cleanName(name)
  if (!folderName) throw new KdriveError('bad_request', 'The folder needs a name.')
  const { folder, isCircleFolder } = await folderInCircle(group, folderId)
  if (isCircleFolder && isMinutesName(folderName)) throw minutesKept()
  refuseMinutesFolder(await folderRow(group.id), folder)
  const made = await Kdrive.createDirectory(folder.id, folderName)
  await remember(made.id, group, userId, 'dir')
  const user = userId ? await User.find(userId) : null
  return toItem(made, { user_id: userId, name: user ? user.get('name') : null }, userId, false)
}

/**
 * Adds a link to a Google document to the circle's folder, or a folder inside
 * it. The address is checked and cleaned (lib/agora/googleLinks.js); nobody is
 * contacted. The title is optional: without one, the kind of document is used.
 */
async function addLink (group, { folderId, userId, url, title }) {
  const checked = GoogleLinks.parse(url)
  const given = String(title === undefined || title === null ? '' : title).trim()
  const linkTitle = cleanName(given) || checked.defaultTitle
  if (given && !cleanName(given)) throw new KdriveError('bad_request', 'The title is empty.')
  const { folder, isCircleFolder } = await folderInCircle(group, folderId)
  refuseMinutesFolder(await folderRow(group.id), folder)
  const [{ count }] = await knex()('agora_kdrive_links').where({ group_id: group.id }).count('id as count')
  if (Number(count) >= MAX_LINKS) throw new KdriveError('bad_request', 'This circle has reached the limit of links. Remove some first.')
  const now = new Date()
  const [row] = await knex()('agora_kdrive_links')
    .insert({
      group_id: group.id,
      folder_id: isCircleFolder ? null : folder.id,
      user_id: userId || null,
      kind: checked.kind,
      title: linkTitle,
      url: checked.url,
      created_at: now,
      updated_at: now
    })
    .returning('*')
  const user = userId ? await User.find(userId) : null
  return toLinkItem({ ...row, user_name: user ? user.get('name') : null }, userId, false)
}

/** Checks that this member may change this link; answers its row. Same rule as for files. */
async function changeableLink (group, number, userId) {
  const row = await knex()('agora_kdrive_links').where({ id: number, group_id: group.id }).first()
  if (!row) throw new KdriveError('not_found', NOT_HERE)
  if (await isSteward(userId, group)) return row
  if (row.user_id && userId && String(row.user_id) === String(userId)) return row
  throw new KdriveError('not_allowed', 'Only the member who added this, and the stewards of the circle, can change or delete it.')
}

function minutesKept () {
  return new KdriveError('bad_request', 'The name Minutes is kept for the meeting minutes. Choose another name.')
}

/**
 * Checks that this member may rename or delete this item; answers the item
 * and the circle's folder. The circle's "Minutes" folder (the one Agora uses,
 * or any folder of that name at the top of the circle's folder) is never
 * changed from Agora: the same answer as for something outside the circle.
 */
async function changeable (group, itemId, userId) {
  const circleFolder = await circleFolderId(group)
  const item = await itemInCircle(group, circleFolder, itemId)
  const row = await folderRow(group.id)
  const atTop = String(item.parent_id) === String(circleFolder)
  if ((row && row.minutes_folder_id && String(row.minutes_folder_id) === String(item.id)) ||
      (atTop && item.type === 'dir' && isMinutesName(item.name))) {
    throw new KdriveError('not_found', NOT_HERE)
  }
  item.atTop = atTop
  if (await isSteward(userId, group)) return item
  const added = await knex()('agora_kdrive_items').where({ file_id: item.id }).first('user_id')
  if (added && userId && String(added.user_id) === String(userId)) return item
  throw new KdriveError('not_allowed', 'Only the member who added this, and the stewards of the circle, can change or delete it.')
}

async function renameItem (group, { itemId, userId, name }) {
  const newName = cleanName(name)
  if (!newName) throw new KdriveError('bad_request', 'The new name is empty.')
  const linkId = linkNumber(itemId)
  if (linkId) {
    const row = await changeableLink(group, linkId, userId)
    await knex()('agora_kdrive_links').where({ id: row.id }).update({ title: newName, updated_at: new Date() })
    return { id: `${LINK_PREFIX}${row.id}`, name: newName }
  }
  const item = await changeable(group, itemId, userId)
  if (item.atTop && isMinutesName(newName)) throw minutesKept()
  await Kdrive.rename(item.id, newName)
  dropInfo(item.id)
  return { id: String(item.id), name: newName }
}

async function deleteItem (group, { itemId, userId }) {
  const linkId = linkNumber(itemId)
  if (linkId) {
    const row = await changeableLink(group, linkId, userId)
    await knex()('agora_kdrive_links').where({ id: row.id }).del()
    return { id: `${LINK_PREFIX}${row.id}` }
  }
  const item = await changeable(group, itemId, userId)
  await Kdrive.trash(item.id)
  dropInfo(item.id)
  await knex()('agora_kdrive_items').where({ file_id: item.id }).del()
  return { id: String(item.id) }
}

/** A file of the circle, opened for download: { item, stream }. */
async function openFile (group, itemId) {
  const circleFolder = await circleFolderId(group)
  const item = await itemInCircle(group, circleFolder, itemId, { type: 'file' })
  return { item, stream: await Kdrive.openDownload(item.id) }
}

/** The circle's "Minutes" folder, made the first time. */
async function minutesFolderId (group) {
  const circleFolder = await circleFolderId(group)
  const row = await folderRow(group.id)
  if (row && row.minutes_folder_id) {
    try {
      const found = await info(row.minutes_folder_id, { fresh: true })
      if (found.type === 'dir' && isUsable(found) && String(found.parent_id) === circleFolder) return String(row.minutes_folder_id)
    } catch (err) {
      if (err.code !== 'not_found') throw err
    }
  }
  let folder
  try {
    folder = await folderIn(circleFolder, MINUTES_FOLDER)
  } catch (err) {
    // The name is taken by something that is not a folder (a file put there
    // in kDrive itself): use a second name instead of failing every time.
    if (err.code !== 'conflict') throw err
    sails.log.warn(`Agora kDrive: "${MINUTES_FOLDER}" in the folder of group ${group.id} is not a folder; using "${MINUTES_FOLDER} (Agora)"`)
    folder = await folderIn(circleFolder, `${MINUTES_FOLDER} (Agora)`)
  }
  // A folder that was already there now belongs to the circle, not to the member who made it.
  await knex()('agora_kdrive_items').where({ file_id: folder.id }).del()
  await knex()('agora_kdrive_folders').where({ group_id: group.id }).update({ minutes_folder_id: folder.id, updated_at: new Date() })
  return String(folder.id)
}

/** Saves a meeting's minutes as a Markdown file in the circle's "Minutes" folder. */
async function saveMinutes (group, { fileName, markdown }) {
  const name = cleanName(fileName) || 'Minutes.md'
  const contents = Buffer.from(String(markdown), 'utf8')
  const folderId = await minutesFolderId(group)
  return Kdrive.upload({ folderId, name, size: contents.length, stream: contents })
}

module.exports = {
  isConfigured: Kdrive.isConfigured,
  maxUploadBytes: Kdrive.maxUploadBytes,
  cleanName,
  folderNameFor,
  agoraFolderId,
  circleFolderId,
  list,
  addFile,
  makeFolder,
  addLink,
  renameItem,
  deleteItem,
  openFile,
  saveMinutes,
  isSteward,
  forget,
  KdriveError,
  MINUTES_FOLDER
}
