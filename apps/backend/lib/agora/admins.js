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
 *
 * Next to the settings, an Agora admin can give someone a role on the Accounts
 * tab of the admin area: 'admin' or 'helpdesk', kept in the table agora_roles
 * (one row per person, see migrations/20261020120000_add_agora_roles.js).
 * A person is an Agora admin when AGORA_ADMINS names them OR they have the
 * role 'admin'; a Help desk admin when either setting names them OR they have
 * either role. The account must be active in every case. The settings stay
 * the fallback: the admin area cannot change or remove what they say, so the
 * people they name can never be locked out.
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
  return isListed(userId, agoraAdminList()).then(listed => listed || hasRole(userId, ['admin']))
}

/** A Help desk admin: in AGORA_HELPDESK_ADMINS or in AGORA_ADMINS. */
function isHelpDeskAdmin (userId) {
  return isListed(userId, helpDeskAdminList()).then(listed => listed || hasRole(userId, ROLES))
}

/* ----------------------------------------------------------------------- */
/* Roles given in the admin area (the table agora_roles)                    */
/* ----------------------------------------------------------------------- */

/** The roles the table can hold. Without a row, someone is a member. */
const ROLES = ['admin', 'helpdesk']
/** What the Accounts tab can choose. */
const ROLE_CHOICES = ['member', 'helpdesk', 'admin']

class RoleError extends Error {
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

/** Before `yarn migrate` the table is missing: then nobody has a role from it, and the settings still work. */
function noTableYet (err) {
  return Boolean(err && err.code === '42P01')
}

/** The roles of these users from the table, as { userId: 'admin' | 'helpdesk' }. */
async function rolesOf (userIds) {
  const ids = (userIds || []).map(String).filter(value => /^\d{1,18}$/.test(value))
  if (ids.length === 0) return {}
  try {
    const rows = await knex()('agora_roles').whereIn('user_id', ids).select('user_id', 'role')
    return Object.fromEntries(rows.filter(r => ROLES.includes(r.role)).map(r => [String(r.user_id), r.role]))
  } catch (err) {
    if (noTableYet(err)) return {}
    throw err
  }
}

/** True when this active account has one of these roles in the table. */
async function hasRole (userId, roles) {
  if (!userId || !/^\d{1,18}$/.test(String(userId))) return false
  const role = (await rolesOf([userId]))[String(userId)]
  if (!role || !roles.includes(role)) return false
  const user = await knex()('users').where({ id: userId }).first('active')
  return Boolean(user && user.active === true)
}

/** True when a setting names this user row (id, email, email_validated), by id or by a confirmed address. */
function listedRow (row, list) {
  return list.includes(String(row.id)) || Boolean(row.email_validated && row.email && list.includes(String(row.email).toLowerCase()))
}

/**
 * The role the server settings give this user row: 'admin' (AGORA_ADMINS),
 * 'helpdesk' (only AGORA_HELPDESK_ADMINS) or null. Not checked against
 * "active" here: the admin area may not change these people either way.
 */
function serverRoleOf (row) {
  if (listedRow(row, agoraAdminList())) return 'admin'
  if (listedRow(row, listFrom(process.env.AGORA_HELPDESK_ADMINS))) return 'helpdesk'
  return null
}

/**
 * An Agora admin changes someone's role: 'member' (no role), 'helpdesk' or
 * 'admin'. The rules are checked here on the server, whatever the page sends:
 *   - only an Agora admin may change roles; anyone else is told the page does not exist;
 *   - nobody changes their own role, so nobody removes or lowers their own admin role;
 *   - people named in the server settings cannot be changed here;
 *   - a role can only be given to an account that is switched on.
 * Every change is written to agora_role_changes, which the Activity log shows.
 * Returns { from, to, user }.
 */
async function changeRole (byUserId, rawAccountId, rawRole, { now = new Date() } = {}) {
  if (!(await isAgoraAdmin(byUserId))) throw new RoleError(404, 'This page does not exist.')
  const role = String(rawRole || '').trim().toLowerCase()
  if (!ROLE_CHOICES.includes(role)) throw new RoleError(400, 'That role is not valid.')
  const accountId = String(rawAccountId || '')
  if (!/^\d{1,18}$/.test(accountId)) throw new RoleError(404, 'This account does not exist.')
  const user = await knex()('users').where({ id: accountId }).first('id', 'name', 'email', 'active', 'email_validated')
  if (!user) throw new RoleError(404, 'This account does not exist.')
  if (String(user.id) === String(byUserId)) throw new RoleError(409, 'You cannot change your own role. Ask another admin.')
  if (serverRoleOf(user)) throw new RoleError(409, 'This role is set on the server (AGORA_ADMINS or AGORA_HELPDESK_ADMINS), so it cannot be changed here.')
  if (role !== 'member' && user.active !== true) throw new RoleError(409, 'Only an account that is switched on can get a role.')

  return knex().transaction(async trx => {
    const current = await trx('agora_roles').where({ user_id: user.id }).forUpdate().first('id', 'role')
    const from = current && ROLES.includes(current.role) ? current.role : 'member'
    if (from === role) throw new RoleError(409, 'This account already has that role.')
    if (role === 'member') {
      await trx('agora_roles').where({ user_id: user.id }).del()
    } else if (current) {
      await trx('agora_roles').where({ id: current.id }).update({ role, granted_by_id: byUserId, created_at: now })
    } else {
      await trx('agora_roles').insert({ user_id: user.id, role, granted_by_id: byUserId, created_at: now })
    }
    await trx('agora_role_changes').insert({ user_id: user.id, changed_by_id: byUserId, from_role: from, to_role: role, created_at: now })
    return { from, to: role, user: { id: String(user.id), name: user.name, email: user.email } }
  })
}

module.exports = {
  ROLES,
  ROLE_CHOICES,
  RoleError,
  rolesOf,
  serverRoleOf,
  changeRole,
  listFrom,
  agoraAdminList,
  helpDeskAdminList,
  isAgoraAdmin,
  isHelpDeskAdmin
}
