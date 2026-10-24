/**
 * Agora: "This week in 7BP", the block at the top of the 7BP Home's welcome page.
 *
 * One call (GET /noo/agora/this-week?group=<slug>) answers four questions for
 * the person who asks:
 *
 * 1. meetings: the next meetings and events (up to 6, the soonest first, so the
 *    ones in the next 7 days come before later ones);
 * 2. announcements: the newest posts sent as an announcement (up to 3);
 * 3. minutes: the newest meeting minutes (up to 3). A minutes post is the post
 *    Agora's assistant writes when a meeting ends; it is the one named in
 *    meeting_sessions.minutes_post_id (someone typing the tag "minutes" on an
 *    ordinary post does not count);
 * 4. decisions: proposals that ended or were completed in the last 14 days (up
 *    to 3). A voting proposal is decided when its end time has passed, a casual
 *    proposal (no voting period) when someone marked it completed. We show the
 *    outcome text when someone wrote one.
 *
 * Who sees what: only posts that are in a circle where the asker is an active
 * member, and only circles that are the 7BP Home itself or active children of
 * it. A hidden circle the asker is not in never shows anything, and a post
 * that is also in such a circle is shown under the circles the asker may see,
 * never under the others. The block exists only on the main circle: for any
 * other circle, or for someone who is not a member of the main circle, the
 * answer is { enabled: false } and the page shows nothing.
 *
 * Six small queries, none per item.
 */
const knex = () => bookshelf.knex

const MEETING_LIMIT = 6
const ANNOUNCEMENT_LIMIT = 3
const MINUTES_LIMIT = 3
const DECISION_LIMIT = 3
const DECISION_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

function mainSlug () {
  return (process.env.AGORA_MAIN_GROUP_SLUG || '').trim().toLowerCase() || '7bp'
}

/** The circles the asker may read here: the main circle and its active children, where the asker is an active member. */
async function visibleCircles (userId, main) {
  const childIds = knex()('group_relationships').where({ parent_group_id: main.id, active: true }).select('child_group_id')
  const rows = await knex()('groups')
    .join('group_memberships', 'group_memberships.group_id', 'groups.id')
    .where('group_memberships.user_id', userId)
    .where('group_memberships.active', true)
    .where('groups.active', true)
    .where(q => q.where('groups.id', main.id).orWhereIn('groups.id', childIds))
    .select('groups.id', 'groups.name', 'groups.slug')
  return rows.map(r => ({ id: String(r.id), name: r.name, slug: r.slug }))
}

function inCircles (query, circleIds) {
  return query.whereIn('posts.id', knex()('groups_posts').whereIn('group_id', circleIds).select('post_id'))
}

function plain (text, max) {
  const s = String(text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s
}

async function thisWeek (userId, groupSlug, { now = new Date() } = {}) {
  const off = { enabled: false }
  if (!userId || String(groupSlug || '').toLowerCase() !== mainSlug()) return off
  const main = await knex()('groups').where({ slug: mainSlug(), active: true }).first('id')
  if (!main) return off
  const circles = await visibleCircles(userId, main)
  if (!circles.some(c => c.id === String(main.id))) return off
  const circleIds = circles.map(c => c.id)

  const base = () => inCircles(knex()('posts').where('posts.active', true).whereNot('posts.type', 'chat'), circleIds)

  const [meetings, announcements, minutes, decisions] = await Promise.all([
    base().where('posts.type', 'event')
      .whereRaw('coalesce(posts.end_time, posts.start_time) >= ?', [now])
      .orderBy('posts.start_time', 'asc').orderBy('posts.id', 'asc').limit(MEETING_LIMIT)
      .select('posts.id', 'posts.name', 'posts.start_time', 'posts.end_time', 'posts.timezone', 'posts.meeting_link'),
    base().where('posts.announcement', true)
      .orderBy('posts.created_at', 'desc').orderBy('posts.id', 'desc').limit(ANNOUNCEMENT_LIMIT)
      .select('posts.id', 'posts.name', 'posts.description', 'posts.created_at'),
    base().join('meeting_sessions', 'meeting_sessions.minutes_post_id', 'posts.id')
      .orderBy('posts.created_at', 'desc').orderBy('posts.id', 'desc').limit(MINUTES_LIMIT)
      .select('posts.id', 'posts.name', 'posts.created_at'),
    base().where('posts.type', 'proposal')
      .whereRaw(`(case when posts.proposal_status = 'casual' then posts.fulfilled_at else posts.end_time end) between ? and ?`, [new Date(now.getTime() - DECISION_DAYS * DAY_MS), now])
      .select('posts.id', 'posts.name', 'posts.proposal_status', 'posts.proposal_outcome', 'posts.fulfilled_at', 'posts.end_time')
      .select(knex().raw(`(case when posts.proposal_status = 'casual' then posts.fulfilled_at else posts.end_time end) as decided_at`))
      .orderBy('decided_at', 'desc').orderBy('posts.id', 'desc').limit(DECISION_LIMIT)
  ])

  // Which of the asker's circles each post is in: one query for all of them
  const ids = [...new Set([...meetings, ...announcements, ...minutes, ...decisions].map(p => String(p.id)))]
  const where = {}
  if (ids.length > 0) {
    const links = await knex()('groups_posts').whereIn('post_id', ids).whereIn('group_id', circleIds).select('post_id', 'group_id')
    for (const l of links) {
      const c = circles.find(x => x.id === String(l.group_id))
      if (c) (where[String(l.post_id)] = where[String(l.post_id)] || []).push(c)
    }
  }
  // A circle other than the main one gives the better label; the main circle comes last
  const circleOf = id => {
    const list = (where[String(id)] || []).slice().sort((a, b) => (a.id === String(main.id)) - (b.id === String(main.id)))
    return list[0] ? { name: list[0].name, slug: list[0].slug } : null
  }
  const common = p => ({ id: String(p.id), title: p.name || '', circle: circleOf(p.id) })

  return {
    enabled: true,
    meetings: meetings.map(p => ({
      ...common(p),
      startsAt: p.start_time,
      endsAt: p.end_time,
      timezone: p.timezone || null,
      inNextSevenDays: new Date(p.start_time) < new Date(now.getTime() + 7 * DAY_MS),
      roomPath: p.meeting_link ? `/noo/meeting/${p.id}/room` : null
    })),
    announcements: announcements.map(p => ({ ...common(p), at: p.created_at, summary: plain(p.description, 140) })),
    minutes: minutes.map(p => ({ ...common(p), at: p.created_at })),
    decisions: decisions.map(p => ({
      ...common(p),
      at: p.decided_at,
      outcome: plain(p.proposal_outcome, 140) || null
    }))
  }
}

module.exports = { thisWeek, MEETING_LIMIT, ANNOUNCEMENT_LIMIT, MINUTES_LIMIT, DECISION_LIMIT, DECISION_DAYS }
