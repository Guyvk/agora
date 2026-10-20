/**
 * Agora: who runs Agora.
 *
 * Two settings in apps/backend/.env name people by user id or by email address,
 * separated by commas, for example "1,guy@example.org":
 *
 *   AGORA_ADMINS            Agora admins: they open the admin dashboard at /admin,
 *                           and they also run the Help desk
 *   AGORA_HELPDESK_ADMINS   people who run only the Help desk
 *
 * Someone in either list must have an active account. An email address only
 * counts when the account has confirmed it, so nobody becomes an admin by
 * signing up with an address that is in the list. Ids are the surest.
 */

const knex = () => bookshelf.knex

/** The entries of one setting: trimmed, in small letters, empty ones left out. */
function listFrom (value) {
  return String(value || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

function agoraAdminList () {
  return listFrom(process.env.AGORA_ADMINS)
}

/** Help desk admins are the people in either list. */
function helpDeskAdminList () {
  return [...new Set([...listFrom(process.env.AGORA_HELPDESK_ADMINS), ...agoraAdminList()])]
}

/** True when this user is named in the list, by id or by a confirmed address, and the account is active. */
async function isListed (userId, list) {
  if (!userId || list.length === 0) return false
  if (!/^\d+$/.test(String(userId))) return false
  const user = await knex()('users').where({ id: userId }).first('id', 'email', 'active', 'email_validated')
  if (!user || user.active !== true) return false
  if (list.includes(String(user.id))) return true
  return Boolean(user.email_validated && user.email && list.includes(String(user.email).toLowerCase()))
}

/** An Agora admin: may open the admin dashboard. */
function isAgoraAdmin (userId) {
  return isListed(userId, agoraAdminList())
}

/**
 * The same check as isAgoraAdmin, as a database query that can sit inside
 * another query (for example "where exists (...)"), for places that build a
 * query without waiting for an answer, such as the GraphQL person filter.
 * It finds one row when this user is an Agora admin and none otherwise.
 * Returns null when nobody can be an admin for this user id, so callers can
 * leave the condition out.
 */
function agoraAdminQuery (userId) {
  const list = agoraAdminList()
  if (!userId || list.length === 0) return null
  if (!/^\d+$/.test(String(userId))) return null
  const ids = list.filter(entry => /^\d+$/.test(entry))
  const emails = list.filter(entry => !/^\d+$/.test(entry))
  return knex()('users as agora_admin')
    .select(knex().raw('1'))
    .where('agora_admin.id', userId)
    .where('agora_admin.active', true)
    .where(q => {
      q.whereRaw('false')
      if (ids.length > 0) q.orWhereIn('agora_admin.id', ids)
      if (emails.length > 0) {
        q.orWhere(q2 => q2.where('agora_admin.email_validated', true).whereIn(knex().raw('lower(agora_admin.email)'), emails))
      }
    })
}

/** A Help desk admin: in AGORA_HELPDESK_ADMINS or in AGORA_ADMINS. */
function isHelpDeskAdmin (userId) {
  return isListed(userId, helpDeskAdminList())
}

module.exports = {
  listFrom,
  agoraAdminList,
  helpDeskAdminList,
  isAgoraAdmin,
  agoraAdminQuery,
  isHelpDeskAdmin
}
