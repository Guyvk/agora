/**
 * Agora: the admin area, for the people who run Agora (AGORA_ADMINS, see
 * admins.js). The page is part of the web app at /admin; the server part is
 * api/controllers/AgoraAdminController.js. Its Help desk tab uses the Help
 * desk's own server part (help.js), which also lets in AGORA_HELPDESK_ADMINS;
 * everything in this file is for AGORA_ADMINS only.
 *
 *   Overview      numbers: members, sign-ups, circles, who was active, open
 *                 invitations, join requests and Help desk requests, meetings
 *   Invitations   every circle invitation with what became of it; resend,
 *                 revoke, copy the link; each circle's join link; join requests
 *   Accounts      everyone with an account; "Let someone in"; deactivate and
 *                 reactivate (never delete)
 *   System        version, uptime, disk, which outside services are set up,
 *                 backups. Never a key, password or token
 *   Activity      the latest important events, from the tables Agora already has
 *
 * Every function here starts with requireAdmin: whoever is not an Agora admin
 * is told the page does not exist. Invitation links (which hold a token) only
 * ever leave the server in answers to an admin.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import Admins from './admins'

const knex = () => bookshelf.knex

const PAGE_SIZE = 50
/** Infomaniak's speech to text, per minute of sound, for the estimate on the overview. */
const STT_PRICE_PER_MINUTE = 0.006
const OPEN_HELP_STATUSES = ['new', 'looking', 'building']
const INVITATION_STATUSES = ['waiting', 'accepted', 'revoked']

class AdminError extends Error {
  constructor (status, message) {
    super(message)
    this.status = status
  }
}

const NOT_FOUND = 'This page does not exist.'

async function requireAdmin (userId) {
  if (!(await Admins.isAgoraAdmin(userId))) throw new AdminError(404, NOT_FOUND)
}

function id (value, what = 'This') {
  if (!/^\d{1,18}$/.test(String(value || ''))) throw new AdminError(404, `${what} does not exist.`)
  return String(value)
}

function pageOf (value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1
}

function iso (value) {
  return value ? new Date(value).toISOString() : null
}

function appUrl (pathname) {
  return `${process.env.PROTOCOL || 'http'}://${process.env.DOMAIN || 'localhost:3000'}${pathname}`
}

/* ----------------------------------------------------------------------- */
/* Email: does Agora really send it?                                        */
/* ----------------------------------------------------------------------- */

/**
 * How email leaves Agora, without any key: the transport's name and whether
 * an email really reaches someone. "log" only writes emails into the log.
 */
function emailStatus () {
  if (process.env.SENDWITHUS_KEY) return { transport: 'sendwithus', sends: true }
  const transport = String(process.env.AGORA_EMAIL_TRANSPORT || 'log').trim().toLowerCase()
  const sender = Boolean(process.env.EMAIL_SENDER)
  if (transport === 'brevo') return { transport, sends: Boolean(process.env.BREVO_API_KEY) && sender }
  if (transport === 'smtp') return { transport, sends: Boolean(process.env.AGORA_SMTP_HOST) && sender }
  return { transport: transport === 'log' ? 'log' : 'unknown', sends: false }
}

/* ----------------------------------------------------------------------- */
/* Overview                                                                 */
/* ----------------------------------------------------------------------- */

async function count (query) {
  const row = await query.count('* as n').first()
  return Number(row && row.n) || 0
}

async function overview (userId, { now = new Date() } = {}) {
  await requireAdmin(userId)
  const day = 24 * 60 * 60 * 1000
  const weekAgo = new Date(now - 7 * day)
  const monthAgo = new Date(now - 30 * day)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const k = knex()

  const members = await count(k('users').where({ active: true }))
  const signups7 = await count(k('users').where({ active: true }).where('created_at', '>=', weekAgo))
  const signups30 = await count(k('users').where({ active: true }).where('created_at', '>=', monthAgo))
  const circles = await count(k('groups').where({ active: true }))
  const active7 = await count(k('users').where({ active: true })
    .where(q => q.where('last_active_at', '>=', weekAgo).orWhere('last_login_at', '>=', weekAgo)))
  const pendingInvitations = await count(k('group_invites')
    .join('groups', 'groups.id', 'group_invites.group_id')
    .where('groups.active', true)
    .whereNull('group_invites.used_by_id')
    .whereNull('group_invites.expired_by_id'))
  const joinRequests = await count(k('join_requests')
    .join('groups', 'groups.id', 'join_requests.group_id')
    .where('groups.active', true)
    .where('join_requests.status', 0))
  const helpRequests = await count(k('agora_help_requests').whereIn('status', OPEN_HELP_STATUSES))
  const helpByStatus = await k('agora_help_requests').groupBy('status').select('status').count('* as n')
  const newestHelp = await k('agora_help_requests as hr')
    .leftJoin('users as u', 'u.id', 'hr.user_id')
    .whereIn('hr.status', OPEN_HELP_STATUSES)
    .orderBy('hr.created_at', 'desc')
    .orderBy('hr.id', 'desc')
    .limit(5)
    .select('hr.id', 'hr.title', 'hr.status', 'hr.type', 'hr.urgency', 'hr.created_at', 'u.name as user_name')
  const meetings = await count(k('meeting_sessions').where('started_at', '>=', monthStart))
  const sound = await k('meeting_segments')
    .whereIn('status', ['done', 'empty'])
    .where('spoken_at', '>=', monthStart)
    .sum('duration_ms as ms')
    .first()
  const minutes = Math.round((Number(sound && sound.ms) || 0) / 60000)

  return {
    members,
    signups: { last7: signups7, last30: signups30 },
    circles,
    activeLast7: active7,
    pendingInvitations,
    joinRequests,
    helpRequests,
    help: {
      byStatus: Object.fromEntries(helpByStatus.map(r => [r.status, Number(r.n) || 0])),
      newest: newestHelp.map(r => ({ id: String(r.id), title: r.title, status: r.status, type: r.type, urgency: r.urgency, createdAt: iso(r.created_at), from: r.user_name || null }))
    },
    meetings: {
      since: iso(monthStart),
      held: meetings,
      transcribedMinutes: minutes,
      estimatedCost: Math.round(minutes * STT_PRICE_PER_MINUTE * 100) / 100,
      pricePerMinute: STT_PRICE_PER_MINUTE
    },
    email: emailStatus()
  }
}

/* ----------------------------------------------------------------------- */
/* Invitations                                                              */
/* ----------------------------------------------------------------------- */

function invitationStatus (row) {
  if (row.used_by_id) return 'accepted'
  if (row.expired_by_id || row.group_active === false) return 'revoked'
  return 'waiting'
}

function invitationLink (token, email) {
  return Frontend.Route.useInvitation(token, email)
}

async function circleList () {
  const rows = await knex()('groups').where({ active: true }).orderBy('name').select('id', 'name', 'slug')
  return rows.map(g => ({ id: String(g.id), name: g.name, slug: g.slug }))
}

async function invitations (userId, { status, circle, page } = {}) {
  await requireAdmin(userId)
  if (status && !INVITATION_STATUSES.includes(status)) throw new AdminError(400, 'That status is not valid.')
  const groupId = circle ? id(circle, 'This circle') : null
  const current = pageOf(page)

  const query = knex()('group_invites as gi')
    .join('groups as g', 'g.id', 'gi.group_id')
    .leftJoin('users as inviter', 'inviter.id', 'gi.invited_by_id')
    .leftJoin('users as used', 'used.id', 'gi.used_by_id')
    .leftJoin('users as revoker', 'revoker.id', 'gi.expired_by_id')
  if (groupId) query.where('gi.group_id', groupId)
  if (status === 'accepted') query.whereNotNull('gi.used_by_id')
  if (status === 'revoked') query.whereNull('gi.used_by_id').where(q => q.whereNotNull('gi.expired_by_id').orWhere('g.active', false))
  if (status === 'waiting') query.whereNull('gi.used_by_id').whereNull('gi.expired_by_id').where('g.active', true)

  const total = await count(query.clone())
  const rows = await query
    .orderBy('gi.created_at', 'desc')
    .orderBy('gi.id', 'desc')
    .limit(PAGE_SIZE)
    .offset((current - 1) * PAGE_SIZE)
    .select(
      'gi.id', 'gi.email', 'gi.token', 'gi.created_at', 'gi.last_sent_at', 'gi.sent_count', 'gi.used_at', 'gi.used_by_id', 'gi.expired_at', 'gi.expired_by_id',
      'g.id as group_id', 'g.name as group_name', 'g.slug as group_slug', 'g.active as group_active',
      'inviter.id as inviter_id', 'inviter.name as inviter_name',
      'used.name as used_by_name', 'revoker.name as revoked_by_name'
    )

  return {
    page: current,
    pageSize: PAGE_SIZE,
    total,
    email: emailStatus(),
    circles: await circleList(),
    invitations: rows.map(row => {
      const state = invitationStatus(row)
      return {
        id: String(row.id),
        email: row.email,
        status: state,
        circle: { id: String(row.group_id), name: row.group_name, slug: row.group_slug, deleted: row.group_active === false },
        invitedBy: row.inviter_id ? { id: String(row.inviter_id), name: row.inviter_name } : null,
        createdAt: iso(row.created_at),
        lastSentAt: iso(row.last_sent_at),
        sentCount: Number(row.sent_count) || 0,
        usedBy: row.used_by_id ? { id: String(row.used_by_id), name: row.used_by_name } : null,
        usedAt: iso(row.used_at),
        revokedAt: iso(row.expired_at),
        revokedBy: row.expired_by_id ? { id: String(row.expired_by_id), name: row.revoked_by_name } : null,
        // Only a waiting invitation has a link worth copying
        link: state === 'waiting' ? invitationLink(row.token, row.email) : null
      }
    })
  }
}

async function waitingInvitation (rawId) {
  const invitationId = id(rawId, 'This invitation')
  const row = await knex()('group_invites as gi')
    .join('groups as g', 'g.id', 'gi.group_id')
    .where('gi.id', invitationId)
    .first('gi.id', 'gi.used_by_id', 'gi.expired_by_id', 'g.active as group_active')
  if (!row) throw new AdminError(404, 'This invitation does not exist.')
  const state = invitationStatus(row)
  if (state !== 'waiting') throw new AdminError(409, state === 'accepted' ? 'This invitation was already used.' : 'This invitation was withdrawn.')
  return row
}

/** Sends the invitation email again, through Hylo's own invitation sending. */
async function resendInvitation (userId, rawId) {
  await requireAdmin(userId)
  const row = await waitingInvitation(rawId)
  const InvitationService = require('../../api/services/InvitationService')
  await InvitationService.resend(row.id)
  return { ok: true, email: emailStatus() }
}

/** Withdraws the invitation: its link stops working. Hylo's own "expire". */
async function revokeInvitation (userId, rawId) {
  await requireAdmin(userId)
  const row = await waitingInvitation(rawId)
  const InvitationService = require('../../api/services/InvitationService')
  await InvitationService.expire(userId, row.id)
  return { ok: true }
}

/**
 * Each circle's join link, and how many of its members joined without an
 * email invitation. Hylo does not record who used a join link: such a member
 * joined through the join link, a join request, or was added directly.
 * Plus the join requests that wait for a steward.
 */
async function joins (userId) {
  await requireAdmin(userId)
  const k = knex()
  const groups = await k('groups as g')
    .where('g.active', true)
    .orderBy('g.name')
    .select(
      'g.id', 'g.name', 'g.slug', 'g.access_code',
      k.raw('(select count(*) from group_memberships gm where gm.group_id = g.id and gm.active = true) as members'),
      k.raw(`(select count(*) from group_memberships gm where gm.group_id = g.id and gm.active = true
        and not exists (select 1 from group_invites gi where gi.group_id = g.id and gi.used_by_id = gm.user_id)) as without_invitation`)
    )
  const requests = await k('join_requests as jr')
    .join('groups as g', 'g.id', 'jr.group_id')
    .leftJoin('users as u', 'u.id', 'jr.user_id')
    .where('g.active', true)
    .where('jr.status', 0)
    .orderBy('jr.created_at', 'desc')
    .limit(200)
    .select('jr.id', 'jr.created_at', 'u.id as user_id', 'u.name as user_name', 'u.email as user_email', 'g.id as group_id', 'g.name as group_name', 'g.slug as group_slug')

  return {
    circles: groups.map(g => ({
      id: String(g.id),
      name: g.name,
      slug: g.slug,
      members: Number(g.members) || 0,
      joinedWithoutInvitation: Number(g.without_invitation) || 0,
      joinLink: g.access_code ? appUrl(`/groups/${g.slug}/join/${g.access_code}`) : null
    })),
    joinRequests: requests.map(r => ({
      id: String(r.id),
      createdAt: iso(r.created_at),
      person: r.user_id ? { id: String(r.user_id), name: r.user_name, email: r.user_email } : null,
      circle: { id: String(r.group_id), name: r.group_name, slug: r.group_slug }
    }))
  }
}

/* ----------------------------------------------------------------------- */
/* Accounts                                                                 */
/* ----------------------------------------------------------------------- */

function accountState (row) {
  if (row.active) return 'active'
  return row.finished ? 'deactivated' : 'unfinished'
}

function isListedRow (row, list) {
  return list.includes(String(row.id)) || Boolean(row.email_validated && row.email && list.includes(String(row.email).toLowerCase()))
}

async function accounts (userId, { search, state, page } = {}) {
  await requireAdmin(userId)
  if (state && !['active', 'deactivated', 'unfinished'].includes(state)) throw new AdminError(400, 'That choice is not valid.')
  const current = pageOf(page)
  const k = knex()
  const finished = 'exists (select 1 from linked_account la where la.user_id = u.id)'

  const query = k('users as u')
  const words = String(search || '').trim().slice(0, 100)
  if (words) {
    const like = `%${words.replace(/[\\%_]/g, ch => '\\' + ch)}%`
    query.where(q => q.whereRaw('u.name ilike ?', [like]).orWhereRaw('u.email ilike ?', [like]))
  }
  if (state === 'active') query.where('u.active', true)
  if (state === 'deactivated') query.where(q => q.whereNot('u.active', true).orWhereNull('u.active')).whereRaw(finished)
  if (state === 'unfinished') query.where(q => q.whereNot('u.active', true).orWhereNull('u.active')).whereRaw(`not ${finished}`)

  const total = await count(query.clone())
  const rows = await query
    .orderByRaw('u.created_at desc nulls last')
    .orderBy('u.id', 'desc')
    .limit(PAGE_SIZE)
    .offset((current - 1) * PAGE_SIZE)
    .select(
      'u.id', 'u.name', 'u.email', 'u.active', 'u.email_validated', 'u.created_at', 'u.last_login_at', 'u.last_active_at',
      k.raw(`${finished} as finished`)
    )

  const ids = rows.map(r => r.id)
  const memberships = ids.length === 0
    ? []
    : await k('group_memberships as gm')
      .join('groups as g', 'g.id', 'gm.group_id')
      .whereIn('gm.user_id', ids)
      .where('gm.active', true)
      .where('g.active', true)
      .orderBy('g.name')
      .select('gm.user_id', 'g.id', 'g.name', 'g.slug')
  const circlesOf = {}
  for (const m of memberships) (circlesOf[m.user_id] = circlesOf[m.user_id] || []).push({ id: String(m.id), name: m.name, slug: m.slug })

  const adminList = Admins.agoraAdminList()
  return {
    page: current,
    pageSize: PAGE_SIZE,
    total,
    email: emailStatus(),
    circles: await circleList(),
    accounts: rows.map(row => {
      const times = [row.last_login_at, row.last_active_at].filter(Boolean).map(t => new Date(t).getTime())
      return {
        id: String(row.id),
        name: row.name,
        email: row.email,
        state: accountState(row),
        emailConfirmed: Boolean(row.email_validated),
        joinedAt: iso(row.created_at),
        lastActiveAt: times.length ? iso(Math.max(...times)) : null,
        circles: circlesOf[row.id] || [],
        isAgoraAdmin: row.active === true && isListedRow(row, adminList),
        isMe: String(row.id) === String(userId)
      }
    })
  }
}

/**
 * "Let someone in": with a circle, a circle invitation (Hylo's own, so its
 * email goes out as any invitation does, and its link also lets them make an
 * account); without one, the same sign-up link as scripts/agora-allow-signup.js.
 * Returns the link to send, since Agora may not be able to email yet.
 */
async function letIn (userId, { email: rawEmail, circle } = {}) {
  await requireAdmin(userId)
  const { allowSignup, cleanEmail, AllowSignupError } = require('./allowSignup')
  let email
  try {
    email = cleanEmail(rawEmail)
  } catch (err) {
    throw new AdminError(400, err.message)
  }
  const mail = emailStatus()

  if (circle) {
    const groupId = id(circle, 'This circle')
    const group = await Group.where({ id: groupId, active: true }).fetch({ require: false })
    if (!group) throw new AdminError(404, 'This circle does not exist.')
    const existing = await knex()('users').whereRaw('lower(email) = ?', [email]).first('id', 'active')
    if (existing && existing.active === true) {
      const member = await knex()('group_memberships').where({ group_id: group.id, user_id: existing.id, active: true }).first('id')
      if (member) throw new AdminError(409, `${email} is already a member of ${group.get('name')}.`)
    }
    const InvitationService = require('../../api/services/InvitationService')
    const { getLocaleStrings } = require('../i18n/locales')
    const admin = await User.find(userId)
    const words = getLocaleStrings(admin.getLocale())
    const [result] = await InvitationService.create({
      sessionUserId: userId,
      groupId: group.id,
      emails: [email],
      message: words.createInvitationMessage(group.get('name')),
      subject: words.createInvitationSubject(group.get('name'))
    })
    if (!result || result.error || !result.id) throw new AdminError(500, 'The invitation could not be made: ' + ((result && result.error) || 'unknown reason'))
    const row = await knex()('group_invites').where({ id: result.id }).first('token', 'email')
    return {
      kind: 'invitation',
      email,
      circle: { id: String(group.id), name: group.get('name') },
      hasAccount: Boolean(existing && existing.active === true),
      link: invitationLink(row.token, row.email),
      emailStatus: mail
    }
  }

  try {
    const result = await allowSignup(email)
    if (result.alreadyHasAccount) return { kind: 'has_account', email, link: null, emailStatus: mail }
    return { kind: 'signup', email, link: result.link, hoursValid: 4, emailStatus: mail }
  } catch (err) {
    if (err instanceof AllowSignupError) throw new AdminError(err.status, err.message)
    throw err
  }
}

async function accountRow (rawId) {
  const accountId = id(rawId, 'This account')
  const user = await User.find(accountId, {}, false)
  if (!user) throw new AdminError(404, 'This account does not exist.')
  return user
}

/** Switches an account off with Hylo's own deactivate, which also logs them out everywhere. Never deletes. */
async function deactivate (userId, rawId) {
  await requireAdmin(userId)
  const user = await accountRow(rawId)
  if (String(user.id) === String(userId)) throw new AdminError(409, 'You cannot switch off your own account here.')
  if (user.get('active') !== true) throw new AdminError(409, 'This account is already switched off.')
  await user.deactivate(null)
  return { ok: true }
}

/** Switches a deactivated account back on, with Hylo's own reactivate. */
async function reactivate (userId, rawId) {
  await requireAdmin(userId)
  const user = await accountRow(rawId)
  if (user.get('active') === true) throw new AdminError(409, 'This account is already on.')
  const finished = await knex()('linked_account').where({ user_id: user.id }).first('id')
  if (!finished || !user.get('name')) throw new AdminError(409, 'This sign-up was never finished, so there is nothing to switch on. Use "Let someone in" instead.')
  try {
    await user.reactivate()
  } catch (err) {
    throw new AdminError(409, 'This account could not be switched on: ' + err.message)
  }
  return { ok: true }
}

/* ----------------------------------------------------------------------- */
/* System                                                                   */
/* ----------------------------------------------------------------------- */

function set (name) {
  return Boolean(String(process.env[name] || '').trim())
}

function newestFile (dir, pattern) {
  try {
    let newest = null
    for (const name of fs.readdirSync(dir)) {
      if (!pattern.test(name)) continue
      const mtime = fs.statSync(path.join(dir, name)).mtime
      if (!newest || mtime > newest) newest = mtime
    }
    return { readable: true, at: iso(newest) }
  } catch (e) {
    return { readable: false, at: null }
  }
}

function backups () {
  const dir = process.env.AGORA_BACKUP_DIR || '/var/backups/agora'
  const conf = process.env.AGORA_OFFSITE_CONF || '/etc/agora/offsite-backup.conf'
  const nightly = newestFile(dir, /^agora-\d{4}-\d{2}-\d{2}\.dump$/)
  let offsiteConfigured = null
  try {
    offsiteConfigured = fs.existsSync(conf) ? true : (fs.existsSync(path.dirname(conf)) ? false : null)
  } catch (e) {
    offsiteConfigured = null
  }
  // offsite-backup.sh leaves this mark after each copy that worked
  const offsite = newestFile(dir, /^\.offsite-last-done$/)
  return {
    nightly: nightly.readable ? { lastAt: nightly.at } : null,
    offsite: { configured: offsiteConfigured, lastAt: offsite.readable ? offsite.at : null }
  }
}

function disk () {
  try {
    const where = process.env.AGORA_UPLOADS_DIR && fs.existsSync(process.env.AGORA_UPLOADS_DIR) ? process.env.AGORA_UPLOADS_DIR : __dirname
    const s = fs.statfsSync(where)
    const total = s.blocks * s.bsize
    const free = s.bavail * s.bsize
    return { totalBytes: total, freeBytes: free, usedPercent: total ? Math.round((1 - free / total) * 100) : null }
  } catch (e) {
    return null
  }
}

async function databaseSize () {
  try {
    const result = await knex().raw('select pg_database_size(current_database()) as bytes')
    return Number(result.rows[0].bytes) || null
  } catch (e) {
    return null
  }
}

async function system (userId) {
  await requireAdmin(userId)
  const Help = require('./help')
  const Transcription = require('../../api/services/Transcription')
  const drive = require('./drive')
  const kdrive = require('./kdrive')
  const { isInviteOnly } = require('./signup')
  const meetDomain = String(process.env.AGORA_MEET_DOMAIN || '').trim()

  return {
    version: Help.appVersion() || null,
    node: process.version,
    serverUptimeSeconds: Math.round(process.uptime()),
    machineUptimeSeconds: Math.round(os.uptime()),
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    disk: disk(),
    databaseBytes: await databaseSize(),
    address: appUrl(''),
    services: {
      speechToText: Transcription.isConfigured(),
      claude: set('ANTHROPIC_API_KEY'),
      email: emailStatus(),
      googleDrive: drive.isConfigured(),
      driveUploads: drive.uploadsEnabled(),
      kdrive: kdrive.isConfigured(),
      kdriveMissingTopFolder: kdrive.missingTopFolder(),
      meetDomain: meetDomain || null,
      inviteOnly: isInviteOnly()
    },
    backups: backups()
  }
}

/* ----------------------------------------------------------------------- */
/* Activity                                                                 */
/* ----------------------------------------------------------------------- */

const EVENTS_SQL = `
  select kind, at, user_id, group_id, post_id, detail from (
    select 'signup' as kind, u.created_at as at, u.id as user_id, null::bigint as group_id, null::bigint as post_id, null::text as detail
      from users u where u.name is not null
    union all
    select 'invited', gi.created_at, gi.invited_by_id, gi.group_id, null, gi.email from group_invites gi
    union all
    select 'invitation_accepted', gi.used_at, gi.used_by_id, gi.group_id, null, gi.email from group_invites gi where gi.used_at is not null
    union all
    select 'invitation_revoked', gi.expired_at, gi.expired_by_id, gi.group_id, null, gi.email from group_invites gi where gi.expired_at is not null
    union all
    select 'circle_created', g.created_at, g.created_by_id, g.id, null, null from groups g
    union all
    select 'joined', gm.created_at, gm.user_id, gm.group_id, null, null from group_memberships gm
    union all
    select 'left', gm.updated_at, gm.user_id, gm.group_id, null, null from group_memberships gm where gm.active = false
    union all
    select 'join_request', jr.created_at, jr.user_id, jr.group_id, null, null from join_requests jr
    union all
    select 'meeting_ended', ms.ended_at, ms.ended_by_id, null, ms.post_id, null from meeting_sessions ms where ms.ended_at is not null
    union all
    select 'help_request', hr.created_at, hr.user_id, null, null, hr.title from agora_help_requests hr
  ) events
  where at is not null
  order by at desc
  limit ? offset ?`

async function activity (userId, { page } = {}) {
  await requireAdmin(userId)
  const current = pageOf(page)
  const k = knex()
  const result = await k.raw(EVENTS_SQL, [PAGE_SIZE + 1, (current - 1) * PAGE_SIZE])
  const rows = result.rows.slice(0, PAGE_SIZE)

  const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
  const groupIds = [...new Set(rows.map(r => r.group_id).filter(Boolean))]
  const postIds = [...new Set(rows.map(r => r.post_id).filter(Boolean))]
  const users = userIds.length ? await k('users').whereIn('id', userIds).select('id', 'name') : []
  const groups = groupIds.length ? await k('groups').whereIn('id', groupIds).select('id', 'name', 'slug', 'active') : []
  const posts = postIds.length ? await k('posts').whereIn('id', postIds).select('id', 'name') : []
  const byId = list => Object.fromEntries(list.map(x => [String(x.id), x]))
  const u = byId(users)
  const g = byId(groups)
  const p = byId(posts)

  return {
    page: current,
    pageSize: PAGE_SIZE,
    hasMore: result.rows.length > PAGE_SIZE,
    events: rows.map(r => ({
      kind: r.kind,
      at: iso(r.at),
      person: r.user_id && u[r.user_id] ? { id: String(r.user_id), name: u[r.user_id].name } : null,
      circle: r.group_id && g[r.group_id] ? { id: String(r.group_id), name: g[r.group_id].name, slug: g[r.group_id].slug, deleted: g[r.group_id].active === false } : null,
      meeting: r.post_id ? { postId: String(r.post_id), title: p[r.post_id] ? p[r.post_id].name : null } : null,
      detail: r.detail || null
    }))
  }
}

/* ----------------------------------------------------------------------- */

/**
 * For the menu and the admin area: what may this person open? Answers only
 * about themselves. isAdmin: the whole admin area (AGORA_ADMINS). helpDesk:
 * the Help desk tab (AGORA_ADMINS or AGORA_HELPDESK_ADMINS).
 */
async function me (userId) {
  return { isAdmin: await Admins.isAgoraAdmin(userId), helpDesk: await Admins.isHelpDeskAdmin(userId) }
}

module.exports = {
  AdminError,
  STT_PRICE_PER_MINUTE,
  emailStatus,
  me,
  overview,
  invitations,
  resendInvitation,
  revokeInvitation,
  joins,
  accounts,
  letIn,
  deactivate,
  reactivate,
  system,
  activity
}
