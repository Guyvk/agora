/**
 * Agora's own email sender.
 *
 * Hylo sends its email through a service called SendWithUs, and the texts of
 * those emails are stored in Hylo's own account there. A copy of Hylo that is
 * run by someone else has no access to them, so nobody could sign up.
 *
 * This file takes the place of the SendWithUs library. It offers the same
 * `send(options, callback)` function, holds the texts of the emails we need,
 * and hands the finished email to a delivery service.
 *
 * Emails that have no text here yet are not sent. A line in the log says so.
 *
 * Settings (see .env.example):
 *   AGORA_EMAIL_TRANSPORT    "log" (default) prints emails in the terminal and sends nothing.
 *                            "brevo" sends them through Brevo.
 *                            "smtp" sends them through any mail server, e.g. a 7BP mailbox.
 *   BREVO_API_KEY            the key of the Brevo account, when the transport is "brevo"
 *   AGORA_SMTP_HOST          the mail server, when the transport is "smtp", e.g. smtp.gmail.com
 *   AGORA_SMTP_PORT          587 (default) or 465
 *   AGORA_SMTP_USER          the mailbox that logs in, e.g. agora@7billionpresidents.org
 *   AGORA_SMTP_PASSWORD      its password (for Google: an app password)
 *   EMAIL_SENDER             the address emails come from, e.g. agora@7billionpresidents.org
 *   AGORA_EMAIL_SENDER_NAME  the name shown next to that address, default "Agora"
 */

const APP_NAME = process.env.AGORA_APP_NAME || 'Agora'

function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Turns the HTML of a post or comment into plain lines of text, and shortens
 * it when it is long. The result is escaped again by compose(), so nothing in
 * it can become HTML.
 */
function plainText (html, max = 600) {
  const text = String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length <= max) return text
  return text.slice(0, max).replace(/\s+\S*$/, '') + '...'
}

/** Hylo's code puts its own name in some texts. Ours says Agora. */
function ourName (value) {
  return value == null ? value : String(value).replace(/\bHylo\b/g, APP_NAME)
}

/** "Lars (via Hylo)" becomes "Lars". */
function personName (senderName) {
  return senderName ? String(senderName).replace(/\s*\(via [^)]*\)\s*$/i, '').trim() : ''
}

/**
 * Builds an email from simple parts, as plain text and as HTML.
 * @param {object} parts
 * @param {string} parts.subject
 * @param {string[]} parts.lines   paragraphs, in order
 * @param {{title: string, items: {title: string, url?: string, meta?: string}[]}[]} [parts.sections]
 *                                 lists with a heading, used by the digest
 * @param {{label: string, url: string}} [parts.button]  the one thing to click
 * @param {string} [parts.footer]
 */
function compose ({ subject, lines, sections = [], button, footer }) {
  const paragraphs = lines.filter(line => line != null && line !== '')
  const lists = sections.filter(section => section && section.items && section.items.length > 0)

  const text = [
    ...paragraphs,
    ...lists.map(section => [
      section.title,
      ...section.items.map(item => [
        `- ${item.title}${item.meta ? ` (${item.meta})` : ''}`,
        item.url ? `  ${item.url}` : null
      ].filter(Boolean).join('\n'))
    ].join('\n')),
    button ? `${button.label}: ${button.url}` : null,
    footer || null,
    `${APP_NAME}, the online home of 7 Billion Presidents`
  ].filter(Boolean).join('\n\n')

  const html = [
    '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-size: 16px; line-height: 1.5; color: #1d1a22; max-width: 560px;">',
    ...paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`),
    ...lists.map(section =>
      `<h3 style="font-size: 16px; margin: 24px 0 8px;">${escapeHtml(section.title)}</h3><ul style="padding-left: 20px; margin: 0;">` +
      section.items.map(item => {
        const title = item.url
          ? `<a href="${escapeHtml(item.url)}" style="color: #c2255c;">${escapeHtml(item.title)}</a>`
          : escapeHtml(item.title)
        const meta = item.meta ? ` <span style="color: #6b6573;">(${escapeHtml(item.meta)})</span>` : ''
        return `<li style="margin-bottom: 6px;">${title}${meta}</li>`
      }).join('') +
      '</ul>'
    ),
    button
      ? `<p><a href="${escapeHtml(button.url)}" style="display: inline-block; background: #c2255c; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">${escapeHtml(button.label)}</a></p>` +
        `<p style="font-size: 13px; color: #6b6573;">If the button does not work, copy this address into your browser:<br>${escapeHtml(button.url)}</p>`
      : '',
    footer ? `<p style="font-size: 13px; color: #6b6573;">${escapeHtml(footer)}</p>` : '',
    `<p style="font-size: 13px; color: #6b6573;">${escapeHtml(APP_NAME)}, the online home of 7 Billion Presidents</p>`,
    '</div>'
  ].join('')

  // A subject is one line, whatever a post title holds.
  return { subject: String(subject == null ? '' : subject).replace(/\s+/g, ' ').trim(), text, html }
}

/**
 * The texts of our emails. The keys are the names Hylo's code uses for them.
 */
const TEMPLATES = {
  // A plain message with a subject and a body, used for alerts to the people who run the platform.
  tem_jFYJ3bxMyfbbtbwgDGS4JGfK: data => compose({
    subject: data.subject || `A message from ${APP_NAME}`,
    lines: [data.body]
  }),

  // "I forgot my password"
  tem_phRPHm3y6RHvRFww6Vc3VBVB: data => compose({
    subject: `Set a new ${APP_NAME} password`,
    lines: [
      `Someone asked to set a new password for your ${APP_NAME} account.`,
      'The link below logs you in and takes you to the page where you choose a new password.'
    ],
    button: { label: 'Set a new password', url: data.login_url },
    footer: 'If this was not you, you can ignore this email. Your password stays as it is.'
  }),

  // The code a new person types in to prove the email address is theirs
  tem_h99yGHv9MXTpMrPSDVTjQFyB: data => compose({
    subject: `Your ${APP_NAME} code is ${data.code}`,
    lines: [
      `Welcome to ${APP_NAME}.`,
      `Your code is ${data.code}. Type it into the sign-up page, or use the button below.`
    ],
    button: data.verify_url ? { label: 'Confirm my email address', url: data.verify_url } : null,
    footer: `If you did not try to sign up for ${APP_NAME}, you can ignore this email.`
  }),

  // For accounts that were created on someone's behalf and still need to be finished
  tem_fqGSrDrSK6WpjTBFXSfY79k4: data => compose({
    subject: `Finish setting up your ${APP_NAME} account`,
    lines: [
      data.group_name
        ? `An account was started for you in ${data.group_name} on ${APP_NAME}.`
        : `An account was started for you on ${APP_NAME}.`,
      'Use the button below to confirm your email address and choose a password.'
    ],
    button: { label: 'Finish my account', url: data.verify_url }
  }),

  // An invitation to join a group, written by a member
  tem_GTwXKBfkTpTHRfHpmJWbYr9d: data => compose({
    subject: data.subject || `${data.inviter_name} invites you to ${data.group_name} on ${APP_NAME}`,
    lines: [
      data.message || `${data.inviter_name} invites you to join ${data.group_name} on ${APP_NAME}.`
    ],
    button: { label: `Join ${data.group_name}`, url: data.invite_link },
    footer: `This invitation was sent by ${data.inviter_name}. Reply to this email to reach them.`
  }),

  // Sent a little while after someone finishes signing up
  tem_jkdjbcSVK9cmGvwXbtX9PQbJ: data => compose({
    subject: `Welcome to ${APP_NAME}, ${data.member_name}`,
    lines: [
      `Good to have you, ${data.member_name}.`,
      `${APP_NAME} is where 7BP keeps its circles, meetings, decisions and files in one place.`,
      'A good first step is to fill in your profile and your skills, so others can see what you would like to help with.'
    ],
    button: data.group_url ? { label: data.group_name ? `Go to ${data.group_name}` : `Open ${APP_NAME}`, url: data.group_url } : null
  }),

  // To the people who look after a group: someone asked to join
  tem_Dkvtfv9HGgYgjqD4KCXPPdy6: data => {
    const answers = Array.isArray(data.join_question_answers) ? data.join_question_answers : []
    return compose({
      subject: `${data.requester_name} asks to join ${data.group_name}`,
      lines: [
        `${data.requester_name} would like to join ${data.group_name}.`,
        ...answers
          .map(a => {
            const question = a && (a.text || a.question)
            const answer = a && a.answer
            return question && answer ? `${question}\n${answer}` : null
          })
      ],
      button: { label: 'Look at the request', url: data.settings_url }
    })
  },

  // To the person who asked: you are in
  tem_JjPbSJqj4wbJqSydqw49VrfT: data => compose({
    subject: `You are now a member of ${data.group_name}`,
    lines: [`Your request to join ${data.group_name} was accepted.`],
    button: { label: `Go to ${data.group_name}`, url: data.group_url }
  }),

  // A new post in a group, or an announcement
  tem_cPYpXw7d9pCdm6M8QmtPvPGG: (data, options) => {
    const post = data.post || {}
    const author = (post.user && post.user.name) || personName(options.sender && options.sender.name)
    return compose({
      subject: data.announcement || post.announcement
        ? `Announcement in ${data.group_name}: ${post.title}`
        : `${author} posted in ${data.group_name}: ${post.title}`,
      lines: postLines(post),
      button: { label: 'Read and reply', url: post.url },
      footer: settingsFooter(data)
    })
  },

  // Someone mentioned you in a post
  tem_77d99tkvmTBJt7rD83DD4XRP: (data, options) => {
    const post = data.post || {}
    const author = (post.user && post.user.name) || personName(options.sender && options.sender.name)
    return compose({
      subject: data.group_name
        ? `${author} mentioned you in ${data.group_name}`
        : `${author} mentioned you`,
      lines: [`${author} mentioned you in "${post.title}".`, ...postLines(post).slice(1)],
      button: { label: 'Read and reply', url: post.url },
      footer: settingsFooter(data)
    })
  },

  // A member invites you to an event
  tem_8pt9FjFkxRGQ7XYhRRW3BBrK: (data, options) => {
    const post = data.post || {}
    const inviter = personName(options.sender && options.sender.name) || (post.user && post.user.name) || 'Someone'
    return compose({
      subject: `${inviter} invites you to ${post.title}`,
      lines: [
        data.group_name
          ? `${inviter} invites you to an event in ${data.group_name}.`
          : `${inviter} invites you to an event.`,
        ...postLines(post)
      ],
      button: { label: 'See the event and reply', url: post.url },
      footer: settingsFooter(data)
    })
  },

  // You said whether you are going to an event. The calendar file is attached.
  tem_93YXdBV6bg4WmD8w3krpGP7H: data => compose({
    subject: `Your reply: ${data.event_name}`,
    lines: [
      data.user_name ? `Hi ${data.user_name},` : null,
      `${RSVP_ANSWERS[data.response] || 'You replied to'} ${data.event_name}.`,
      ...eventLines(data),
      'The calendar file attached to this email adds the event to your calendar.'
    ],
    button: { label: 'See the event', url: data.event_url }
  }),

  // An event you replied to has changed. The new calendar file is attached.
  tem_77XY6QJTVYKKFhDtkVgW3W93: data => compose({
    subject: `Changed: ${data.event_name}`,
    lines: [
      data.user_name ? `Hi ${data.user_name},` : null,
      `${data.event_name} has changed.`,
      data.newDate ? `New time: ${data.newDate}` : null,
      data.newLocation ? `New place: ${data.newLocation}` : null,
      ...eventLines({ ...data, date: data.newDate ? null : data.date, event_location: data.newLocation ? null : data.event_location }),
      'The calendar file attached to this email updates the event in your calendar.'
    ],
    button: { label: 'See the event', url: data.event_url }
  }),

  // An event you replied to is cancelled. The calendar file removes it.
  tem_YCTQy4pJywkRDw6pfhShDg9H: data => compose({
    subject: `Cancelled: ${data.event_name}`,
    lines: [
      data.user_name ? `Hi ${data.user_name},` : null,
      data.date
        ? `${data.event_name} on ${data.date} is cancelled.`
        : `${data.event_name} is cancelled.`,
      'The calendar file attached to this email takes the event out of your calendar.'
    ]
  }),

  // The daily or weekly digest of a group, or of all your groups together
  tem_t7rmGfJKvqXrvmrVWJjjWkg4: data => {
    const groupName = data.unified ? null : ourName(data.group_name)
    const period = data.time_period === 'day' ? 'day' : 'week'
    return compose({
      subject: ourName(data.subject) || `Your ${APP_NAME} digest`,
      lines: [
        data.recipient && data.recipient.name ? `Hi ${data.recipient.name},` : null,
        groupName
          ? `This is what happened in ${groupName} in the past ${period}.`
          : `This is what happened in your groups in the past ${period}.`
      ],
      sections: digestSections(data),
      button: { label: groupName ? `Go to ${groupName}` : `Open ${APP_NAME}`, url: data.group_url },
      footer: settingsFooter(data)
    })
  },

  // The Help desk answered a request someone sent from the Help window (lib/agora/help.js)
  agora_help_reply: data => compose({
    subject: `An answer to your request: ${data.title}`,
    lines: [
      `The ${APP_NAME} team answered your request "${data.title}":`,
      data.reply,
      'You can read it and answer in Help, at the bottom right of every page, under "My requests".'
    ],
    button: data.url ? { label: 'Open my request', url: data.url } : null,
    footer: `You get this email because you sent a request from the Help window of ${APP_NAME}.`
  })
}

/** What a reply to an event invitation means, in Hylo's words and in ours. */
const RSVP_ANSWERS = {
  'Going to': 'You are going to',
  'Not Going to': 'You are not going to',
  'Interested in': 'You are interested in'
}

/** The title, time, place and text of a post, as paragraphs. */
function postLines (post) {
  return [
    post.title,
    post.when ? `When: ${post.when}` : null,
    post.location ? `Where: ${post.location}` : null,
    plainText(post.details)
  ]
}

/** Time, place and description of an event in the reply emails. */
function eventLines (data) {
  return [
    data.date ? `When: ${data.date}` : null,
    data.event_location ? `Where: ${data.event_location}` : null,
    data.group_names ? `In: ${data.group_names}` : null,
    plainText(data.event_description, 400)
  ]
}

function settingsFooter (data) {
  return data.email_settings_url
    ? `You get this email because of your notification settings. You can change them here: ${data.email_settings_url}`
    : null
}

/** The lists of a digest, in the order a member would want to read them. */
function digestSections (data) {
  const postItem = meta => post => ({
    title: post.title || plainText(post.details, 80) || 'A post',
    url: post.url,
    meta: meta(post)
  })
  const by = post => [
    post.user && post.user.name ? `by ${post.user.name}` : null,
    post.space_name ? `in ${post.space_name}` : null
  ].filter(Boolean).join(', ')
  const list = (title, key, meta = by) => ({ title, items: (data[key] || []).map(postItem(meta)) })

  return [
    list('Coming up', 'upcoming', post => post.start_time),
    list('Ending soon', 'ending', post => post.end_time),
    list('New events', 'events', post => [post.when, by(post)].filter(Boolean).join(', ')),
    list('New proposals', 'proposals'),
    list('New discussions', 'discussions'),
    list('Requests', 'requests'),
    list('Offers', 'offers'),
    list('Projects', 'projects'),
    list('Resources', 'resources'),
    list('New comments', 'posts_with_new_comments', post => {
      const count = post.comment_count || (post.comments || []).length
      return count === 1 ? '1 new comment' : `${count} new comments`
    }),
    {
      title: 'Chat',
      items: (data.chat_rooms || []).map(room => ({
        title: ourName(room.name) || 'Chat',
        url: room.url,
        meta: room.num_new_chats === 1 ? '1 new message' : `${room.num_new_chats} new messages`
      }))
    }
  ]
}

/* ---------- Delivery ---------- */

/**
 * Hylo lets people answer a post by replying to its email, through addresses
 * like reply-...@INBOUND_EMAIL_DOMAIN that Hylo's own mail server reads, and
 * signs digests with DoNotReply@hylo.com. Agora reads no incoming mail, so a
 * reply to such an address would get lost, or reach Hylo. Those addresses are
 * left out. A real person's address, like that of someone who invites you,
 * stays.
 */
function usableReplyTo (address) {
  if (!address) return null
  const domain = String(address).split('@').pop().toLowerCase()
  const inbound = (process.env.INBOUND_EMAIL_DOMAIN || '').toLowerCase()
  if (inbound && domain === inbound) return null
  if (domain === 'hylo.com' || domain.endsWith('.hylo.com')) return null
  return address
}

function fromHeader (options) {
  const sender = options.sender || {}
  const rawName = sender.name || process.env.AGORA_EMAIL_SENDER_NAME || APP_NAME
  return {
    // Hylo's code signs emails as "The Team at Hylo" or "Name (via Hylo)".
    name: rawName === 'The Team at Hylo' ? APP_NAME : rawName.replace(/\bHylo\b/g, APP_NAME),
    email: process.env.EMAIL_SENDER,
    replyTo: usableReplyTo(sender.reply_to)
  }
}

/** Hylo hands attachments over as [{ id: 'invite.ics', data: <base64> }]. */
function attachmentsOf (options) {
  return (Array.isArray(options.files) ? options.files : [])
    .filter(file => file && file.id && file.data)
    .map(file => ({ name: file.id, content: file.data }))
}

async function deliverWithBrevo ({ to, from, content, attachments = [] }) {
  if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY is not set')
  if (!from.email) throw new Error('EMAIL_SENDER is not set')

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { name: from.name, email: from.email },
      to: [{ email: to }],
      replyTo: from.replyTo ? { email: from.replyTo } : undefined,
      subject: content.subject,
      textContent: content.text,
      htmlContent: content.html,
      attachment: attachments.length > 0 ? attachments : undefined
    }),
    signal: AbortSignal.timeout(30000)
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Brevo answered ${response.status}: ${body.slice(0, 300)}`)
  }
  return response.json().catch(() => ({}))
}

let smtpTransport = null

/**
 * Sends through any mail server that speaks SMTP: a 7BP mailbox at Google
 * Workspace, Infomaniak's mail service, or Brevo's SMTP. The transport is made
 * once and reused.
 */
async function deliverWithSmtp ({ to, from, content, attachments = [] }) {
  if (!process.env.AGORA_SMTP_HOST) throw new Error('AGORA_SMTP_HOST is not set')
  if (!from.email) throw new Error('EMAIL_SENDER is not set')

  if (!smtpTransport) {
    const nodemailer = require('nodemailer')
    const port = Number(process.env.AGORA_SMTP_PORT || 587)
    smtpTransport = nodemailer.createTransport({
      host: process.env.AGORA_SMTP_HOST,
      port,
      // Port 465 talks encrypted from the start; 587 switches to encryption first (STARTTLS).
      secure: port === 465,
      requireTLS: port !== 465,
      // Give up on an unreachable server quickly, so a background job is not stuck.
      connectionTimeout: 15000,
      socketTimeout: 30000,
      auth: process.env.AGORA_SMTP_USER
        ? { user: process.env.AGORA_SMTP_USER, pass: process.env.AGORA_SMTP_PASSWORD }
        : undefined
    })
  }

  return smtpTransport.sendMail({
    from: { name: from.name, address: from.email },
    to,
    replyTo: from.replyTo || undefined,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: attachments.map(a => ({ filename: a.name, content: a.content, encoding: 'base64' }))
  })
}

async function deliverToLog ({ to, from, content, attachments = [] }) {
  console.log([
    '',
    '----- Email (not sent, AGORA_EMAIL_TRANSPORT is "log") -----',
    `To:      ${to}`,
    `From:    ${from.name} <${from.email || 'no sender set'}>`,
    from.replyTo ? `Reply to: ${from.replyTo}` : null,
    `Subject: ${content.subject}`,
    attachments.length > 0 ? `Attached: ${attachments.map(a => a.name).join(', ')}` : null,
    '',
    content.text,
    '-----------------------------------------------------------',
    ''
  ].filter(line => line != null).join('\n'))
  return { logged: true }
}

const TRANSPORTS = {
  log: deliverToLog,
  brevo: deliverWithBrevo,
  smtp: deliverWithSmtp
}

/**
 * Same call as the SendWithUs library: send(options, callback).
 * @param {object} options
 * @param {string} options.email_id          which email to send
 * @param {{address: string}} options.recipient
 * @param {object} options.email_data        the details that go into the text
 * @param {object} [options.sender]          name and reply_to
 */
function send (options, callback) {
  const done = typeof callback === 'function' ? callback : () => {}
  const template = TEMPLATES[options.email_id]
  const to = options.recipient && options.recipient.address

  if (!template) {
    console.log(`Agora mailer: there is no text yet for email "${options.email_id}", so it was not sent to ${to}.`)
    return done(null, { skipped: true })
  }
  if (!to) return done(new Error('Agora mailer: no recipient'))

  let content
  try {
    content = template(options.email_data || {}, options)
  } catch (err) {
    return done(err)
  }

  const transportName = (process.env.AGORA_EMAIL_TRANSPORT || 'log').toLowerCase()
  const deliver = TRANSPORTS[transportName]
  if (!deliver) return done(new Error(`Agora mailer: unknown AGORA_EMAIL_TRANSPORT "${transportName}"`))

  deliver({ to, from: fromHeader(options), content, attachments: attachmentsOf(options) })
    .then(result => done(null, result || true))
    .catch(err => done(err))
}

module.exports = { send, compose, plainText, fromHeader, TEMPLATES }
