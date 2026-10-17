/**
 * Agora: which Google Drive folder belongs to which circle (table
 * agora_drive_folders). Only scripts/agora-drive-link.js changes it, run by an
 * administrator; nothing in the website can.
 */

function table () {
  return bookshelf.knex('agora_drive_folders')
}

/** The Drive folder id linked to a circle, or null. */
async function folderFor (groupId) {
  const row = await table().where({ group_id: groupId }).first('folder_id')
  return row ? row.folder_id : null
}

/** Links a circle to a folder, replacing an earlier link. */
async function link (groupId, folderId, linkedBy) {
  const now = new Date()
  await table()
    .insert({ group_id: groupId, folder_id: folderId, linked_by: linkedBy || null, created_at: now, updated_at: now })
    .onConflict('group_id')
    .merge({ folder_id: folderId, linked_by: linkedBy || null, updated_at: now })
}

async function unlink (groupId) {
  return table().where({ group_id: groupId }).del()
}

/** Every link, with the circle's address and name. */
async function all () {
  return table()
    .join('groups', 'groups.id', 'agora_drive_folders.group_id')
    .select('groups.slug', 'groups.name', 'agora_drive_folders.folder_id')
    .orderBy('groups.name')
}

module.exports = { folderFor, link, unlink, all }
