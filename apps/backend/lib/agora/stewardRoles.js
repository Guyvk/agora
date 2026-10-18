/**
 * Agora: what a steward of a circle may do.
 *
 * Hylo keeps four "system responsibilities" in the responsibilities table:
 * Administration, Add Members (which includes inviting), Remove Members and
 * Manage Content. Hylo adds these rows in a migration, but a new Agora
 * database is made from migrations/schema.sql, which has the tables and not
 * their rows. Without them nobody may invite anyone, not even the person who
 * made a circle.
 *
 * When a circle is made, Hylo gives it three roles (Administrator, Moderator,
 * Host, see api/models/GroupRole.js) and links each role to the
 * responsibilities that exist at that moment. A circle made while the rows were
 * missing keeps roles without responsibilities, so it also needs repairing.
 *
 * These are the four the current Hylo code uses (GroupRole SYSTEM_ROLES).
 * Older Hylo migrations also mention "Manage Tracks" and "Manage Rounds", but
 * later migrations folded those away, and no role uses them any more.
 */
const STEWARD_RESPONSIBILITIES = [
  ['Administration', 'Allows for editing group settings, exporting data, and deleting the group.'],
  ['Add Members', 'The ability to invite and add new people to the group, and to accept or reject join requests.'],
  ['Remove Members', 'The ability to remove a member from the group.'],
  ['Manage Content', 'Adjust group topics, custom views and manage content that contradicts the agreements of the group.']
]

/**
 * Adds the four rows when they are missing. Takes a knex instance, so it also
 * works without the rest of Agora running (scripts/agora-init-db.js).
 * Returns the titles it added.
 */
async function ensureStewardResponsibilities (knex) {
  const added = []
  for (const [title, description] of STEWARD_RESPONSIBILITIES) {
    const existing = await knex('responsibilities').where({ title, type: 'system' }).whereNull('group_id').first()
    if (!existing) {
      await knex('responsibilities').insert({ title, description, type: 'system', created_at: new Date(), updated_at: new Date() })
      added.push(title)
    }
  }
  return added
}

/**
 * Gives the roles of every circle the responsibilities they should have,
 * using Hylo's own GroupRole.setupSystemRoles, which only adds what is
 * missing. Needs Agora running (sails globals). Returns how many circles it
 * looked at.
 */
async function repairCircleRoles () {
  // Spaces inside a circle use the circle's roles; setupSystemRoles skips them itself
  const groups = await bookshelf.knex('groups').select('id')
  for (const { id } of groups) {
    await GroupRole.setupSystemRoles(id)
  }
  return groups.length
}

module.exports = { STEWARD_RESPONSIBILITIES, ensureStewardResponsibilities, repairCircleRoles }
