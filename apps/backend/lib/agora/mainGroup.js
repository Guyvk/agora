/**
 * Agora: the 7BP Home, one main circle that holds every other circle.
 *
 * Without it Agora is a set of separate circles and nobody has one place to
 * land. The main circle is the circle whose slug (its name in the web address)
 * is AGORA_MAIN_GROUP_SLUG, by default "7bp"; its name is AGORA_MAIN_GROUP_NAME,
 * by default "7BP". PR #32 (events for all of 7BP) reads the same slug.
 *
 * ensureMainGroup({ apply }) does five things, and only adds what is missing,
 * so a second run changes nothing:
 *
 * a. Makes the main circle when it does not exist, through Hylo's own
 *    Group.create (roles, menu and chat room are made like for any circle).
 *    The maker is the first active account in AGORA_ADMINS (ids only). Visible to its members only, joining
 *    by invitation or join link, like the other circles. Commons stays off.
 * b. Makes every other active circle a child of it (Hylo's group_relationships,
 *    active, parent and child). The children's own settings and members are not
 *    touched. A relationship that a steward switched off on purpose is not
 *    switched on again (it is listed as "kept apart").
 * c. Makes every active account with a confirmed email address, who is an
 *    active member of at least one active circle, a member of the main circle
 *    with the default role Member, through Hylo's addMembers. Memberships that
 *    exist stay as they are. Hylo records leaving as a membership with
 *    active = false, so someone who left the main circle (or was removed) is
 *    NOT added again; they are listed as "left on purpose". The new
 *    memberships are quiet: no join form, notifications only for mentions and
 *    announcements, a weekly digest (a member can change that in the circle's
 *    settings). Nobody is told "X joined".
 * d. Sets up the home page of the main circle once: a welcome page (the
 *    home), the stream with its announcements, events and meetings, members,
 *    chat, and a menu entry for each circle inside it. "Once" matters: the
 *    setup is remembered in the circle's settings (agoraHome), so a view a
 *    steward removes later stays removed, and only circles made later get a
 *    menu entry of their own. A welcome page that already has text keeps it.
 * e. Reports exactly what it would change, and saves only with apply.
 *
 * scripts/agora-main-group.js runs it by hand, cron.js runs it (with apply)
 * every 10 minutes, so people who join any circle later also land in the main
 * circle and new circles become its children.
 */
const { agoraAdminList } = require('./admins')

const knex = () => bookshelf.knex

const DEFAULT_SLUG = '7bp'
const DEFAULT_NAME = '7BP'
const WELCOME_TEXT = 'The home of 7 Billion Presidents: announcements, meetings and all our circles.'
// In this order; the first one is the home page. 'chat' is the main circle's own chat room.
const HOME_VIEWS = ['welcome', 'all', 'events', 'members', 'chat']

function mainGroupSlug () {
  return (process.env.AGORA_MAIN_GROUP_SLUG || '').trim().toLowerCase() || DEFAULT_SLUG
}

function mainGroupName () {
  return (process.env.AGORA_MAIN_GROUP_NAME || '').trim() || DEFAULT_NAME
}

/** The main circle (active or not), or null. */
async function findMainGroup ({ transacting } = {}) {
  return Group.where({ slug: mainGroupSlug() }).fetch({ transacting })
}

/**
 * The first account in AGORA_ADMINS that is active, as { id, name }, or null.
 * Ids only: an email address in the list is ignored (see admins.js).
 */
async function firstActiveAgoraAdmin () {
  for (const entry of agoraAdminList()) {
    const query = knex()('users').where('active', true).where('id', entry)
    const user = await query.first('id', 'name')
    if (user) return { id: String(user.id), name: user.name }
  }
  return null
}

/** Settings for a membership made this way: quiet, no join form. */
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
    agoraMainAutoJoined: true
  }
}

/** Active circles (no spaces) other than the main circle: [{ id, name }]. */
async function activeCircles (exceptId) {
  const rows = await knex()('groups')
    .where('active', true)
    .whereNull('parent_id')
    .where(q => q.whereNull('type').orWhere('type', '<>', 'space'))
    .orderBy('id')
    .select('id', 'name', 'slug')
  return rows.filter(r => String(r.id) !== String(exceptId) && r.slug !== mainGroupSlug())
}

/**
 * Plans (and with apply saves) all of it. Returns
 * {
 *   blocked,        // a reason string when nothing can be done, else null
 *   main,           // { id, slug, name, exists, create: bool, creator }
 *   links,          // [{ id, name }] circles that become children
 *   keptApart,      // [{ id, name }] relationships switched off on purpose
 *   joins,          // [{ id, name }] accounts that become members
 *   leftOnPurpose,  // [{ id, name }] accounts that left and stay out
 *   home,           // [string] what is set up on the home page
 *   failures,       // [{ step, message }]
 *   changes         // total number of changes
 * }
 */
async function ensureMainGroup ({ apply = false, create = true } = {}) {
  const report = {
    blocked: null,
    main: { slug: mainGroupSlug(), name: mainGroupName(), exists: false, create: false, id: null, creator: null },
    links: [],
    keptApart: [],
    joins: [],
    leftOnPurpose: [],
    home: [],
    failures: [],
    changes: 0
  }

  let main = await findMainGroup()
  if (main && !main.get('active')) {
    report.blocked = `A circle with the slug "${report.main.slug}" exists but is switched off. Nothing was done. Choose another AGORA_MAIN_GROUP_SLUG or switch that circle on again.`
    return report
  }

  // a. The circle itself
  if (main) {
    report.main.exists = true
    report.main.id = String(main.id)
    report.main.name = main.get('name')
  } else {
    if (!create) {
      // Only a person makes the circle, after looking at the dry run
      report.blocked = 'The main circle does not exist yet. Make it by hand: node scripts/agora-main-group.js, then with --apply.'
      return report
    }
    const creator = await firstActiveAgoraAdmin()
    if (!creator) {
      report.blocked = 'The main circle does not exist yet and there is no active account in AGORA_ADMINS to make it. Put an Agora admin\'s account number in AGORA_ADMINS first.'
      return report
    }
    report.main.create = true
    report.main.creator = creator
    report.changes += 1
    if (apply) {
      try {
        main = await Group.create(creator.id, {
          name: mainGroupName(),
          slug: mainGroupSlug(),
          purpose: WELCOME_TEXT,
          accessibility: Group.Accessibility.RESTRICTED,
          visibility: Group.Visibility.HIDDEN,
          view_types: HOME_VIEWS
        })
        report.main.id = String(main.id)
      } catch (err) {
        report.failures.push({ step: 'create', message: err.message })
        return report
      }
    }
  }
  const mainId = report.main.id
  const circles = await activeCircles(mainId)

  // b. Every other circle becomes a child
  const relationships = mainId
    ? await knex()('group_relationships')
      .where({ parent_group_id: mainId, relationship_type: Group.RelationshipType.PARENT_CHILD })
      .select('child_group_id', 'active')
    : []
  const relationshipOf = {}
  for (const r of relationships) relationshipOf[String(r.child_group_id)] = r
  for (const circle of circles) {
    const existing = relationshipOf[String(circle.id)]
    if (!existing) report.links.push({ id: String(circle.id), name: circle.name })
    else if (!existing.active) report.keptApart.push({ id: String(circle.id), name: circle.name })
  }
  report.changes += report.links.length
  if (apply && mainId) {
    for (const link of report.links) {
      try {
        // A lock and a second look, so two runs at once never link a circle twice
        await bookshelf.transaction(async trx => {
          await trx.raw('select pg_advisory_xact_lock(hashtext(?))', ['agora-main-group-links'])
          const existing = await trx('group_relationships').where({ parent_group_id: mainId, child_group_id: link.id }).first('id')
          if (existing) return
          const child = await Group.find(link.id, { transacting: trx })
          await child.parentGroups().attach(mainId, { transacting: trx })
        })
      } catch (err) {
        report.failures.push({ step: `link ${link.id}`, message: err.message })
      }
    }
  }

  // c. Every member of a circle becomes a member of the main circle
  const circleIds = circles.map(c => c.id)
  const candidates = circleIds.length === 0
    ? []
    : await knex()('users')
      .where('users.active', true)
      .where('users.email_validated', true)
      .whereExists(function () {
        this.select(knex().raw('1')).from('group_memberships')
          .whereRaw('group_memberships.user_id = users.id')
          .where('group_memberships.active', true)
          .whereIn('group_memberships.group_id', circleIds)
      })
      .orderBy('users.id')
      .select('users.id', 'users.name')
  const membershipOf = {}
  if (mainId) {
    for (const m of await knex()('group_memberships').where('group_id', mainId).select('user_id', 'active')) {
      membershipOf[String(m.user_id)] = m
    }
  }
  const creatorId = report.main.creator && report.main.creator.id
  for (const user of candidates) {
    const id = String(user.id)
    if (id === creatorId) continue // becomes a member (Administrator) when the circle is made
    const membership = membershipOf[id]
    if (!membership) report.joins.push({ id, name: user.name })
    else if (!membership.active) report.leftOnPurpose.push({ id, name: user.name })
  }
  report.changes += report.joins.length
  if (apply && mainId && report.joins.length > 0) {
    try {
      const group = await Group.find(mainId)
      const ids = report.joins.map(j => j.id)
      await bookshelf.transaction(async trx => {
        await group.addMembers(ids, { settings: quietSettings(new Date()) }, { transacting: trx })
        // Start with the views read, so people do not land on old unread badges
        await Group.ensureSpaceViewUsers(group.id, ids, { transacting: trx })
      })
    } catch (err) {
      report.failures.push({ step: 'members', message: err.message })
    }
  }

  // d. The home page, once
  try {
    await ensureHome(report, { apply, mainId, circles })
  } catch (err) {
    report.failures.push({ step: 'home', message: err.message })
  }
  report.changes += report.home.length

  return report
}

/** Step d. Fills report.home and, with apply, saves it. */
async function ensureHome (report, { apply, mainId, circles }) {
  const settings = mainId ? ((await knex()('groups').where('id', mainId).first('settings')).settings || {}) : {}
  const done = settings.agoraHome && Array.isArray(settings.agoraHome.circleIds) ? settings.agoraHome : null
  const views = mainId ? await knex()('group_views').where('group_id', mainId).select('id', 'type', 'linked_group_id', 'page_content', 'order') : []
  const circleViews = new Set(views.filter(v => v.linked_group_id).map(v => String(v.linked_group_id)))
  const handled = new Set(done ? done.circleIds.map(String) : [])
  const newCircleIds = circles.filter(c => !handled.has(String(c.id)) && !circleViews.has(String(c.id)))
  const first = !done

  // The blocks a member needs, only on the first run
  // Before the circle exists, Group.create makes these pages itself
  const missingBlocks = first && mainId ? HOME_VIEWS.filter(type => !views.some(v => v.type === type)) : []
  const welcome = views.find(v => v.type === 'welcome')
  const textNeeded = first && (!welcome || !String(welcome.page_content || '').trim())

  const homeRoute = mainId ? (await knex()('groups').where('id', mainId).first('home_route')).home_route : null
  // Group.create saves its own home route after the views are made, so check it here
  const homeNeeded = first && !missingBlocks.includes('welcome') && welcome && Number(welcome.order) === 0 && homeRoute !== '/welcome'

  if (homeNeeded) report.home.push('make the welcome page the home page')
  for (const type of missingBlocks) report.home.push(`add the "${type}" page to the menu`)
  if (textNeeded) report.home.push(`write the welcome text: "${WELCOME_TEXT}"`)
  for (const circle of newCircleIds) report.home.push(`add a menu entry for the circle "${circle.name}"`)
  if (!apply || !mainId) return
  if (report.home.length === 0 && done) return

  await bookshelf.transaction(async trx => {
    let welcomeId = welcome && welcome.id
    for (const type of missingBlocks) {
      const view = await GroupView.appendToMenu({ group_id: mainId, type }, { transacting: trx })
      if (type === 'welcome') welcomeId = view.id
    }
    if (missingBlocks.includes('welcome')) {
      await GroupView.setHomeView({ id: welcomeId, groupId: mainId, trx })
    }
    if (homeNeeded) {
      await trx('groups').where('id', mainId).update({ home_route: '/welcome' })
    }
    if (textNeeded && welcomeId) {
      await trx('group_views').where('id', welcomeId).update({ page_content: `<p>${WELCOME_TEXT}</p>` })
    }
    for (const circle of newCircleIds) {
      await GroupView.appendToMenu({ group_id: mainId, type: 'group', linked_group_id: circle.id }, { transacting: trx })
    }
    const circleIds = new Set([...handled, ...circles.map(c => String(c.id))])
    const agoraHome = { circleIds: [...circleIds], setUpAt: (done && done.setUpAt) || new Date().toISOString() }
    // Merge, so a steward's settings saved in the meantime are kept
    await trx('groups').where('id', mainId).update({
      settings: trx.raw('coalesce(settings, \'{}\'::jsonb) || ?::jsonb', [JSON.stringify({ agoraHome })])
    })
  })
}

/**
 * For the 10-minute cron job: saves what is missing, says nothing when
 * nothing changed, and never throws.
 */
async function everyTenMinutesMainGroup () {
  try {
    // Keeps the circle up to date; making it is left to a person
    const report = await ensureMainGroup({ apply: true, create: false })
    if (report.blocked) {
      sails.log.debug(`Agora: main circle not checked: ${report.blocked}`)
    }
    for (const f of report.failures) {
      sails.log.warn(`Agora: main circle step "${f.step}" failed; the next run tries again: ${f.message}`)
    }
    if (report.changes > 0) {
      sails.log.info(`Agora: main circle updated (${report.changes} change${report.changes === 1 ? '' : 's'})`)
    }
    return report.changes
  } catch (err) {
    sails.log.error(`Agora: the main circle job failed: ${err.message}`)
    return 0
  }
}

module.exports = {
  WELCOME_TEXT,
  HOME_VIEWS,
  mainGroupSlug,
  mainGroupName,
  findMainGroup,
  firstActiveAgoraAdmin,
  quietSettings,
  ensureMainGroup,
  everyTenMinutesMainGroup
}
