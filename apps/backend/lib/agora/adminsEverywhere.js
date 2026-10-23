/**
 * Agora: Agora admins are Administrator in every circle and every space.
 *
 * The Agora admins are the accounts in AGORA_ADMINS (see lib/agora/admins.js).
 * When a circle or a space is made, each of them becomes a member of it and
 * gets the Administrator role. Hylo keeps the roles of a space on the circle it
 * sits in, so for a space the Administrator role is the one of that circle.
 * The person who made the circle or space keeps their own role, as in Hylo.
 *
 * scripts/agora-admins-everywhere.js does the same for the circles and spaces
 * that already exist, and the hourly cron job runs it quietly, so someone added
 * to AGORA_ADMINS later gets the role everywhere within the hour.
 *
 * Rules:
 * - Only active accounts count. An email address counts only when the account
 *   has confirmed it. Entries that match no such account are skipped and named
 *   in the log; they never stop a circle from being made.
 * - Only active circles and spaces are looked at.
 * - An admin who left a circle or space, or was removed from it, stays out:
 *   Agora does not undo that by itself. Running the command with --rejoin
 *   brings them back everywhere.
 * - Joining this way skips the join form (agreements and join questions), so
 *   nobody is told "X joined". Hylo's addMembers sends no notification to the
 *   other members. The admin gets only important notices from the circle
 *   (mentions and announcements) and a weekly digest, instead of a notice for
 *   every post; they can change that in the circle's settings.
 */
const { agoraAdminList } = require('./admins')

const knex = () => bookshelf.knex

/** Notification settings for an admin who joins a circle or space this way. */
function quietSettings (now) {
  return {
    showJoinForm: false,
    agreementsAcceptedAt: now,
    joinQuestionsAnsweredAt: now,
    lastReadAt: now,
    postNotifications: 'important',
    digestFrequency: 'weekly',
    sendEmail: true,
    sendPushNotifications: true,
    agoraAdminAutoJoined: true
  }
}

/**
 * The active accounts named in AGORA_ADMINS, as ids (strings), and the entries
 * that match no active account.
 */
async function resolveAgoraAdmins ({ transacting } = {}) {
  const entries = agoraAdminList()
  const ids = new Set()
  const skipped = []
  for (const entry of entries) {
    let query = knex()('users').where('active', true)
    if (/^\d+$/.test(entry)) {
      query = query.where('id', entry)
    } else if (entry.includes('@')) {
      query = query.whereRaw('lower(email) = ?', [entry]).where('email_validated', true)
    } else {
      skipped.push(entry)
      continue
    }
    if (transacting) query = query.transacting(transacting)
    const user = await query.first('id')
    if (user) ids.add(String(user.id))
    else skipped.push(entry)
  }
  return { ids: [...ids], skipped }
}

/**
 * What one group (circle or space) still needs for these admins. Returns a
 * list of changes like { userId, groupId, change }, where change is 'join',
 * 'rejoin' or 'administrator'. Saves them unless apply is false.
 *
 * For a space this also covers the circle it sits in, because that is where
 * the Administrator role of the space lives.
 */
async function addAgoraAdminsToGroup (groupOrId, { adminIds, apply = true, rejoin = false, transacting } = {}) {
  const group = groupOrId instanceof Group ? groupOrId : await Group.find(groupOrId, { transacting })
  if (!group || !group.get('active')) return []
  if (!adminIds) adminIds = (await resolveAgoraAdmins({ transacting })).ids
  if (adminIds.length === 0) return []

  const changes = []
  const roleScopeId = await Group.roleScopeId(group, { transacting })
  if (String(roleScopeId) !== String(group.id)) {
    // A space: first the circle it sits in, where its roles are kept
    changes.push(...await addAgoraAdminsToGroup(roleScopeId, { adminIds, apply, rejoin, transacting }))
  }

  // Memberships, also the ones that are no longer active
  const memberships = await group.memberships(true)
    .query(q => q.whereIn('user_id', adminIds)).fetch({ transacting })
  const membershipOf = {}
  for (const m of memberships.models) membershipOf[String(m.get('user_id'))] = m

  const toJoin = []
  const members = []
  for (const userId of adminIds) {
    const membership = membershipOf[userId]
    if (membership && membership.get('active')) {
      members.push(userId)
    } else if (!membership) {
      toJoin.push(userId)
      changes.push({ userId, groupId: String(group.id), change: 'join' })
    } else if (rejoin) {
      toJoin.push(userId)
      changes.push({ userId, groupId: String(group.id), change: 'rejoin' })
    }
    // Left or removed, and no --rejoin: stays out
  }

  if (apply && toJoin.length > 0) {
    await group.addMembers(toJoin, { settings: quietSettings(new Date()) }, { transacting })
    // Start with the views read, as auto-added space members do, so no old unread badges
    await Group.ensureSpaceViewUsers(group.id, toJoin, { transacting })
  }

  // The Administrator role lives on the circle itself (not on a space)
  if (String(roleScopeId) === String(group.id)) {
    const holders = new Set()
    const administrator = await GroupRole.findSystemRole(group.id, 'Administrator', { transacting })
    if (administrator) {
      let query = knex()('group_memberships_group_roles')
        .where({ group_id: group.id, group_role_id: administrator.id })
        .whereIn('user_id', adminIds)
        .select('user_id')
      if (transacting) query = query.transacting(transacting)
      for (const row of await query) holders.add(String(row.user_id))
    }
    for (const userId of members.concat(toJoin)) {
      if (holders.has(userId)) continue
      changes.push({ userId, groupId: String(group.id), change: 'administrator' })
      if (apply) await GroupMembership.assignAdministratorRole(userId, group.id, { transacting })
    }
  }

  return changes
}

/**
 * Runs addAgoraAdminsToGroup for every active circle and space. Circles go
 * first, so a space finds its circle ready. Returns { changes, skipped,
 * adminIds, groups }. Nothing is saved unless apply is true.
 */
async function addAgoraAdminsEverywhere ({ apply = false, rejoin = false } = {}) {
  const { ids: adminIds, skipped } = await resolveAgoraAdmins()
  const rows = await knex()('groups')
    .where('active', true)
    .orderByRaw('parent_id is not null, id')
    .select('id')
  const changes = []
  if (adminIds.length > 0) {
    for (const { id } of rows) {
      // In dry run a space would report its circle again; count each change once
      const found = await addAgoraAdminsToGroup(id, { adminIds, apply, rejoin })
      for (const c of found) {
        if (!changes.some(d => d.userId === c.userId && d.groupId === c.groupId && d.change === c.change)) changes.push(c)
      }
    }
  }
  return { changes, skipped, adminIds, groups: rows.length }
}

/**
 * For Group.create and createSpace: never lets the new circle or space fail.
 * Runs after the circle or space is saved; a problem is logged, and the
 * hourly job tries again.
 */
async function addAgoraAdminsToNewGroup (groupOrId) {
  try {
    const { ids, skipped } = await resolveAgoraAdmins()
    for (const entry of skipped) {
      sails.log.warn(`Agora: AGORA_ADMINS entry "${entry}" matches no active account; it is skipped`)
    }
    return await addAgoraAdminsToGroup(groupOrId, { adminIds: ids })
  } catch (err) {
    sails.log.error(`Agora: could not make the Agora admins Administrator of group ${groupOrId instanceof Group ? groupOrId.id : groupOrId}: ${err.message}`)
    return []
  }
}

/** For the hourly cron job: saves what is missing, says nothing when nothing changed. */
async function hourlyAgoraAdminsEverywhere () {
  const { changes } = await addAgoraAdminsEverywhere({ apply: true })
  if (changes.length > 0) {
    sails.log.info(`Agora: made the Agora admins Administrator in more places (${changes.length} change${changes.length === 1 ? '' : 's'})`)
  }
  return changes.length
}

module.exports = {
  quietSettings,
  resolveAgoraAdmins,
  addAgoraAdminsToGroup,
  addAgoraAdminsEverywhere,
  addAgoraAdminsToNewGroup,
  hourlyAgoraAdminsEverywhere
}
