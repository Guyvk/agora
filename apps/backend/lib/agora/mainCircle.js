/**
 * Agora: what the web needs to show the 7BP Home as the circle that holds all
 * other circles (the left bar, the header and the welcome page).
 *
 * mainCircleFor(userId) returns null when there is no main circle or the
 * person is not an active member of it (it is hidden from everyone else).
 * Otherwise { id, slug, name, avatarUrl, circles }, where circles are the
 * ACTIVE children of the main circle: active relationship, active circle.
 * A circle a steward took out of the main circle on purpose (relationship
 * switched off) is not listed. A circle hidden from this person (they are not
 * a member and its visibility is hidden) is left out too.
 */
const { findMainGroup } = require('./mainGroup')

const knex = () => bookshelf.knex

async function mainCircleFor (userId) {
  if (!userId) return null
  const main = await findMainGroup()
  if (!main || !main.get('active')) return null
  const membership = await knex()('group_memberships')
    .where({ group_id: main.id, user_id: userId, active: true })
    .first('id')
  if (!membership) return null

  const rows = await knex()('group_relationships')
    .join('groups', 'groups.id', 'group_relationships.child_group_id')
    .where({
      'group_relationships.parent_group_id': main.id,
      'group_relationships.relationship_type': Group.RelationshipType.PARENT_CHILD,
      'group_relationships.active': true,
      'groups.active': true
    })
    .where(q => q.whereNull('groups.type').orWhere('groups.type', '<>', 'space'))
    .select('groups.id', 'groups.slug', 'groups.name', 'groups.avatar_url', 'groups.visibility')
    .orderByRaw('lower(groups.name)')
  const myGroupIds = new Set((await knex()('group_memberships')
    .where({ user_id: userId, active: true })
    .whereIn('group_id', rows.map(r => r.id))
    .select('group_id')).map(r => String(r.group_id)))
  const visible = rows.filter(r => myGroupIds.has(String(r.id)) || r.visibility !== Group.Visibility.HIDDEN)
  const counts = {}
  for (const c of await knex()('group_memberships')
    .where('active', true)
    .whereIn('group_id', visible.map(r => r.id))
    .groupBy('group_id')
    .select('group_id', knex().raw('count(*)::int as n'))) {
    counts[String(c.group_id)] = c.n
  }
  return {
    id: String(main.id),
    slug: main.get('slug'),
    name: main.get('name'),
    avatarUrl: main.get('avatar_url') || null,
    circles: visible.map(r => ({
      id: String(r.id),
      slug: r.slug,
      name: r.name,
      avatarUrl: r.avatar_url || null,
      memberCount: counts[String(r.id)] || 0
    }))
  }
}

module.exports = { mainCircleFor }
