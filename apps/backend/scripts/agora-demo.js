#!/usr/bin/env node

/**
 * Agora demo data.
 *
 * Fills an empty copy of Agora with a small, made-up version of 7BP, so there
 * is something to click through: a main group, a group per circle, a few
 * people, sample playbook proposals and two meetings.
 *
 *   cd apps/backend
 *   node scripts/agora-demo.js
 *
 * Everything here is invented. The people do not exist and the playbook
 * chapters are placeholders. Never run this on the real Agora.
 *
 * The script can be run again. It skips what already exists.
 */

require('@babel/register')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const skiff = require('../lib/skiff')

const LOGIN_FILE = path.join(__dirname, '..', '.agora-demo-login')

// schema.sql creates this table empty, and groups cannot be made without these rows.
const RESPONSIBILITIES = [
  ['Administration', 'Allows for editing group settings, managing the menu and spaces, exporting data, and deleting the group.'],
  ['Add Members', 'The ability to invite and add new people to the group, and to accept or reject join requests.'],
  ['Remove Members', 'The ability to remove a member from the group.'],
  ['Manage Content', 'Adjust group topics, custom views and manage content that contradicts the agreements of the group.']
]

const PEOPLE = [
  { name: 'Demo Steward', email: 'steward@agora.test', tagline: 'Looks after this demo' },
  { name: 'Amara Okafor', email: 'amara@agora.test', tagline: 'Communications circle' },
  { name: 'Lars Jansen', email: 'lars@agora.test', tagline: 'Governance circle' },
  { name: 'Sofia Almeida', email: 'sofia@agora.test', tagline: 'Stories circle' },
  { name: 'Kenji Watanabe', email: 'kenji@agora.test', tagline: 'Network circle' },
  { name: 'Priya Nair', email: 'priya@agora.test', tagline: 'Care circle' }
]

const MAIN = {
  name: '7 Billion Presidents',
  slug: '7bp',
  purpose: 'We are building a society where companies give 100% of their profit to making life better for everyone.'
}

const CIRCLES = [
  { name: 'Governance', slug: '7bp-governance', purpose: 'Keeps the playbook: how we decide, who does what, and how circles work together.', people: ['steward', 'lars', 'amara'] },
  { name: 'Communications', slug: '7bp-communications', purpose: 'Tells the 7BP story and keeps the message house.', people: ['steward', 'amara', 'sofia'] },
  { name: 'Network', slug: '7bp-network', purpose: 'Builds relationships with companies, partners and other movements.', people: ['steward', 'kenji'] },
  { name: 'Stories', slug: '7bp-stories', purpose: 'Finds and shares the stories of people building the new.', people: ['steward', 'sofia'] },
  { name: 'Planning', slug: '7bp-planning', purpose: 'Keeps the roadmap and helps circles plan their work.', people: ['steward', 'lars'] },
  { name: 'Care', slug: '7bp-care', purpose: 'Looks after the people in the movement and welcomes new activists.', people: ['steward', 'priya'] }
]

const SAMPLE_CHAPTERS = [
  ['How we decide', 'A placeholder for the chapter on decision making. Replace this text with the real chapter, then let the circle respond.'],
  ['Circles and roles', 'A placeholder for the chapter that describes each circle, its roles and what each role is accountable for.'],
  ['Welcoming new activists', 'A placeholder for the chapter on how someone joins, finds a role and gets a buddy.'],
  ['Board and activist council', 'A placeholder for the chapter on how the board and the activist council work together.']
]

function passphrase () {
  return `agora-${crypto.randomBytes(9).toString('base64url')}`
}

async function ensureResponsibilities () {
  for (const [title, description] of RESPONSIBILITIES) {
    const existing = await bookshelf.knex('responsibilities').where({ title, type: 'system' }).first()
    if (!existing) {
      await bookshelf.knex('responsibilities').insert({
        title, description, type: 'system', created_at: new Date(), updated_at: new Date()
      })
    }
  }
}

async function ensurePerson ({ name, email, tagline }, password) {
  const existing = await User.where({ email }).fetch()
  if (existing) return existing
  const user = await User.create({
    name,
    email,
    tagline,
    email_validated: true,
    account: { type: 'password', password }
  })
  await user.save({ settings: { ...(user.get('settings') || {}), signup_in_progress: false } }, { patch: true })
  return user
}

async function ensureGroup (stewardId, data) {
  const existing = await Group.find(data.slug)
  if (existing) return existing
  return Group.create(stewardId, { ...data, home_view: 'STREAM' })
}

async function addPeople (group, userIds) {
  const now = new Date()
  await group.addMembers(userIds, {
    settings: { showJoinForm: false, agreementsAcceptedAt: now, joinQuestionsAnsweredAt: now }
  })
}

async function hasPost (groupId, name) {
  const row = await bookshelf.knex('posts')
    .join('groups_posts', 'groups_posts.post_id', 'posts.id')
    .where({ 'groups_posts.group_id': groupId, 'posts.name': name, 'posts.active': true })
    .first('posts.id')
  return !!row
}

function at (daysFromNow, hour) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}

async function run () {
  const createPost = require('../api/models/post/createPost').default

  if (process.env.NODE_ENV === 'production') {
    throw new Error('This script fills Agora with made-up people. It refuses to run in production.')
  }

  await ensureResponsibilities()

  const newLogin = !fs.existsSync(LOGIN_FILE)
  const password = newLogin ? passphrase() : fs.readFileSync(LOGIN_FILE, 'utf8').split('\n')[1].replace('password: ', '').trim()

  const people = {}
  for (const person of PEOPLE) {
    people[person.email.split('@')[0]] = await ensurePerson(person, password)
  }
  const steward = people.steward
  const everyone = Object.values(people).map(u => u.id)

  const main = await ensureGroup(steward.id, {
    ...MAIN,
    description: 'This is a demo copy of Agora with made-up people. Use it to look around and to try things out.'
  })
  await addPeople(main, everyone)

  const circles = {}
  for (const circle of CIRCLES) {
    const group = await ensureGroup(steward.id, {
      name: circle.name,
      slug: circle.slug,
      purpose: circle.purpose,
      parent_ids: [main.id]
    })
    await addPeople(group, circle.people.map(key => people[key].id))
    circles[circle.slug] = group
  }

  if (!(await hasPost(main.id, 'Welcome to Agora'))) {
    await createPost(steward.id, {
      name: 'Welcome to Agora',
      description: '<p>Agora is the online home of 7BP. Each circle has its own group, where you find its people, its meetings, its proposals and its files.</p><p>This copy is a demo. Everything in it is made up, so click on anything.</p>',
      type: 'discussion',
      group_ids: [main.id],
      topicNames: ['welcome'],
      skip_link_preview: true
    })
  }

  const governance = circles['7bp-governance']
  for (const [title, text] of SAMPLE_CHAPTERS) {
    const name = `Playbook: ${title} (sample)`
    if (await hasPost(governance.id, name)) continue
    await createPost(people.lars.id, {
      name,
      description: `<p>${text}</p>`,
      type: 'proposal',
      group_ids: [governance.id],
      topicNames: ['playbook'],
      proposalOptions: [
        { text: 'I agree', emoji: '👍', color: '' },
        { text: 'I have a question', emoji: '❓', color: '' },
        { text: 'I object', emoji: '✋', color: '' }
      ],
      skip_link_preview: true
    })
  }

  const meetings = [
    { group: governance, by: people.lars, name: 'Governance circle weekly', day: 1, hour: 17, text: 'Review of the playbook chapters that are up for a response.' },
    { group: circles['7bp-communications'], by: people.amara, name: 'Communications circle meeting', day: 3, hour: 17, text: 'First meeting: find out what the circle needs and set objectives.' }
  ]
  for (const meeting of meetings) {
    if (await hasPost(meeting.group.id, meeting.name)) continue
    await createPost(meeting.by.id, {
      name: meeting.name,
      description: `<p>${meeting.text}</p>`,
      type: 'event',
      group_ids: [meeting.group.id],
      startTime: at(meeting.day, meeting.hour),
      endTime: at(meeting.day, meeting.hour + 1),
      location: 'Online, in Agora',
      skip_link_preview: true
    })
  }

  // Made-up contacts outside Agora, for the shared Contacts page. Added once.
  const Contacts = require('../lib/agora/contacts')
  const existingContacts = await bookshelf.knex('agora_contacts').count('id as count').first()
  if (Number(existingContacts.count) === 0) {
    const inDays = days => {
      const date = new Date(Contacts.today() + 'T12:00:00Z')
      date.setUTCDate(date.getUTCDate() + days)
      return date.toISOString().slice(0, 10)
    }
    const demoContacts = [
      { by: people.amara, circle: '7bp-communications', name: 'Mila Jansen', organisation: 'De Dagkrant (made up)', kind: 'press', status: 'in_touch', email: 'mila@dagkrant.test', source: 'Demo data', consent: true, follow_up_on: inDays(0), follow_up_what: 'Send the press kit and three story ideas', owner: people.amara, note: 'Interested in a portrait of a circle at work. Prefers email.' },
      { by: people.kenji, circle: '7bp-network', name: 'Commons Lab Utrecht (made up)', organisation: 'Commons Lab Utrecht (made up)', kind: 'partner', status: 'active', website: 'commonslab.test', source: 'Demo data', consent: true, follow_up_on: inDays(5), follow_up_what: 'Plan a joint evening in November', owner: people.kenji, note: 'Offers their space for meetings, free on weekday evenings.' },
      { by: people.steward, circle: '7bp-governance', name: 'Stichting Nieuwe Bodem (made up)', organisation: 'Stichting Nieuwe Bodem (made up)', kind: 'funder', status: 'new', email: 'info@nieuwebodem.test', source: 'Demo data', consent: false, follow_up_on: inDays(-2), follow_up_what: 'Ask whether 7BP fits their spring call', owner: people.steward },
      { by: people.priya, circle: '7bp-care', name: 'Tom Peeters', kind: 'interested', status: 'new', email: 'tom@peeters.test', source: 'Demo data', consent: true, follow_up_on: inDays(2), follow_up_what: 'Invite to the next welcome call', owner: people.priya, note: 'Signed up at the market stall. Wants to help with stories.' },
      { by: people.sofia, circle: '7bp-stories', name: 'Ana Ruiz', organisation: 'Freelance photographer (made up)', kind: 'other', status: 'paused', phone: '+31 6 0000 0000', source: 'Demo data', consent: true }
    ]
    for (const c of demoContacts) {
      const id = await Contacts.create(c.by.id, {
        ...c,
        circle_id: circles[c.circle] ? String(circles[c.circle].id) : null,
        follow_up_owner_id: c.owner ? String(c.owner.id) : null
      })
      if (c.note) await Contacts.addNote(c.by.id, id, c.note)
    }
  }

  if (newLogin) {
    fs.writeFileSync(LOGIN_FILE, `email: ${steward.get('email')}\npassword: ${password}\n`, { mode: 0o600 })
  }

  console.log('\nThe demo is ready.')
  console.log(`Log in as ${steward.get('email')}. The password is in ${path.relative(process.cwd(), LOGIN_FILE)}`)
  console.log('The other made-up people use the same password.\n')
}

skiff.lift({
  start: function () {
    run()
      .catch(err => {
        console.error('\nThe demo could not be created:\n', err)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
