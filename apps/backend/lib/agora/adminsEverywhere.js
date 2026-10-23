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
 * - Only active accounts count, and AGORA_ADMINS holds user ids only. An email
 *   address is ignored (the log says so): Hylo lets anyone change their own
 *   email address without confirming it, so an address cannot prove who
 *   someone is. Ids that match no active account are skipped and named in the
 *   log; they never stop a circle from being made.
 * - Only active circles and spaces are looked at.
 * - Agora admins are always in: an admin who left a circle or space, or was
 *   removed from it, is brought back by the next hourly run (or the command),
 *   and a log line says so. Guy decided this on 2026-10-23: "Admins have full
 *   access everywhere and can see everything."
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
 * The active accounts named in AGORA_ADMINS, as ids (strings), and the ids
 * that match no active account.
 */
async function resolveAgoraAdmins ({ transacting } = {}) {
  const entries = agoraAdminList()
  const ids = new Set()
  const skipped = []
  // agoraAdminList keeps only numbers and logs the other entries as ignored
  for (const entry of entries) {
    let query = knex()('users').where('active', true).where('id', entry)
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
async function addAgoraAdminsToGroup (groupOrId, { adminIds, apply = true, transacting } = {}) {
  const group = groupOrId instanceof Group ? groupOrId : await Group.find(groupOrId, { transacting })
  if (!group || !group.get('active')) return []
  if (!adminIds) adminIds = (await resolveAgoraAdmins({ transacting })).ids
  if (adminIds.length === 0) return []

  const changes = []
  const roleScopeId = await Group.roleScopeId(group, { transacting })
  if (String(roleScopeId) !== String(group.id)) {
    // A space: first the circle it sits in, where its roles are kept
    changes.push(...await addAgoraAdminsToGroup(roleScopeId, { adminIds, apply, transacting }))
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
    } else {
      // Left or was removed: an Agora admin is always brought back
      toJoin.push(userId)
      changes.push({ userId, groupId: String(group.id), change: 'rejoin' })
    }
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
 * adminIds, groups, failures }. Nothing is saved unless apply is true. A group
 * that fails is logged and listed in failures; the others carry on.
 */
async function addAgoraAdminsEverywhere ({ apply = false } = {}) {
  const { ids: adminIds, skipped } = await resolveAgoraAdmins()
  const rows = await knex()('groups')
    .where('active', true)
    .orderByRaw('parent_id is not null, id')
    .select('id')
  const changes = []
  const failures = []
  if (adminIds.length > 0) {
    for (const { id } of rows) {
      try {
        // In dry run a space would report its circle again; count each change once
        const found = await addAgoraAdminsToGroup(id, { adminIds, apply })
        for (const c of found) {
          if (!changes.some(d => d.userId === c.userId && d.groupId === c.groupId && d.change === c.change)) changes.push(c)
        }
      } catch (err) {
        sails.log.error(`Agora: could not update group ${id}: ${err.message}`)
        failures.push({ groupId: String(id), message: err.message })
      }
    }
  }
  return { changes, skipped, adminIds, groups: rows.length, failures }
}

/**
 * Offboarding: takes back what this feature gave one person. Removes the
 * Administrator role and the membership in every circle and space they were
 * put in by this feature (the membership has the marker agoraAdminAutoJoined).
 * Memberships and roles they had on their own are left alone, and so is
 * everything else the person did. Spaces go before circles.
 *
 * Remove the person from AGORA_ADMINS first, or the next hourly run puts them
 * back. Returns { changes: [{ userId, groupId, change: 'remove' }], kept,
 * failures }; kept lists the active memberships that were theirs and stay.
 * Nothing is saved unless apply is true.
 */
async function removeAgoraAdminFromEverywhere (userId, { apply = false } = {}) {
  const rows = await knex()('group_memberships')
    .join('groups', 'groups.id', 'group_memberships.group_id')
    .where({ 'group_memberships.user_id': userId, 'group_memberships.active': true })
    .orderByRaw('groups.parent_id is null, groups.id')
    .select('group_memberships.group_id', 'group_memberships.settings')
  const granted = rows.filter(r => r.settings && r.settings.agoraAdminAutoJoined === true)
  const kept = rows.filter(r => !(r.settings && r.settings.agoraAdminAutoJoined === true)).map(r => String(r.group_id))
  const changes = []
  const failures = []
  for (const { group_id: groupId } of granted) {
    changes.push({ userId: String(userId), groupId: String(groupId), change: 'remove' })
    if (!apply) continue
    try {
      const group = await Group.find(groupId)
      // Leaving a circle also takes the person out of its spaces, and removeMembers
      // revokes the roles there; an earlier step may already have done it
      const membership = await GroupMembership.forPair(userId, groupId).fetch()
      if (membership && membership.get('active')) {
        await GroupMembership.removeAdministratorRole(userId, groupId)
        await group.removeMembers([userId])
      }
    } catch (err) {
      sails.log.error(`Agora: could not take Agora admin ${userId} out of group ${groupId}: ${err.message}`)
      failures.push({ groupId: String(groupId), message: err.message })
    }
  }
  return { changes, kept, failures }
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
      sails.log.warn(`Agora: AGORA_ADMINS id "${entry}" matches no active account; it is skipped`)
    }
    return await addAgoraAdminsToGroup(groupOrId, { adminIds: ids })
  } catch (err) {
    sails.log.error(`Agora: could not make the Agora admins Administrator of group ${groupOrId instanceof Group ? groupOrId.id : groupOrId}: ${err.message}`)
    return []
  }
}

/** For the hourly cron job: saves what is missing, says nothing when nothing changed. */
async function hourlyAgoraAdminsEverywhere () {
  const { changes, failures } = await addAgoraAdminsEverywhere({ apply: true })
  if (failures.length > 0) {
    sails.log.warn(`Agora: the Agora admins could not be updated in ${failures.length} group${failures.length === 1 ? '' : 's'}; the next run tries again`)
  }
  for (const c of changes.filter(c => c.change === 'rejoin')) {
    sails.log.info(`Agora: brought Agora admin ${c.userId} back into group ${c.groupId}, which they had left or been removed from`)
  }
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
  hourlyAgoraAdminsEverywhere,
  removeAgoraAdminFromEverywhere
}
