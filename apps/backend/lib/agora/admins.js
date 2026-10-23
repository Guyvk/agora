/**
 * Agora: who runs Agora.
 *
 * Two settings in apps/backend/.env name people by user id (the account's
 * number), separated by commas, for example "1,7":
 *
 *   AGORA_ADMINS            Agora admins: they open the admin dashboard at /admin,
 *                           and they also run the Help desk
 *   AGORA_HELPDESK_ADMINS   people who run only the Help desk
 *
 * Someone in either list must have an active account. Only ids count, never
 * email addresses: Hylo lets a logged-in person change their email address
 * without confirming the new one again, so an address in the list could be
 * taken over by anyone who types it into their account settings. An entry
 * that is not a number is ignored, and the log says so once.
 */

const knex = () => bookshelf.knex

/** The entries of one setting: trimmed, in small letters, empty ones left out. */
function listFrom (value) {
  return String(value || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

const warned = new Set()

/**
 * Keeps only the ids of a setting. Other entries (email addresses, nonsense)
 * are ignored, and the log says so once per entry.
 */
function idsOnly (name, entries) {
  const ids = []
  for (const entry of entries) {
    if (/^\d+$/.test(entry)) {
      ids.push(entry)
    } else if (!warned.has(`${name}:${entry}`)) {
      warned.add(`${name}:${entry}`)
      const message = `Agora: ${name} entry "${entry}" ignored: use the account's number`
      if (typeof sails !== 'undefined' && sails.log) sails.log.warn(message)
      else console.warn(message)
    }
  }
  return ids
}

function agoraAdminList () {
  return idsOnly('AGORA_ADMINS', listFrom(process.env.AGORA_ADMINS))
}

/** Help desk admins are the people in either list. */
function helpDeskAdminList () {
  return [...new Set([...idsOnly('AGORA_HELPDESK_ADMINS', listFrom(process.env.AGORA_HELPDESK_ADMINS)), ...agoraAdminList()])]
}

/** True when this user is named in the list (by id) and the account is active. */
async function isListed (userId, list) {
  if (!userId || list.length === 0) return false
  if (!/^\d+$/.test(String(userId))) return false
  if (!list.includes(String(userId))) return false
  const user = await knex()('users').where({ id: userId }).first('id', 'active')
  return Boolean(user && user.active === true)
}

/** An Agora admin: may open the admin dashboard. */
function isAgoraAdmin (userId) {
  return isListed(userId, agoraAdminList())
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
  isHelpDeskAdmin
}
