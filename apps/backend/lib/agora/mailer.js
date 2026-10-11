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
 *   BREVO_API_KEY            the key of the Brevo account, when the transport is "brevo"
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
 * Builds an email from simple parts, as plain text and as HTML.
 * @param {object} parts
 * @param {string} parts.subject
 * @param {string[]} parts.lines   paragraphs, in order
 * @param {{label: string, url: string}} [parts.button]  the one thing to click
 * @param {string} [parts.footer]
 */
function compose ({ subject, lines, button, footer }) {
  const paragraphs = lines.filter(line => line != null && line !== '')

  const text = [
    ...paragraphs,
    button ? `${button.label}: ${button.url}` : null,
    footer || null,
    `${APP_NAME}, the online home of 7 Billion Presidents`
  ].filter(Boolean).join('\n\n')

  const html = [
    '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-size: 16px; line-height: 1.5; color: #1d1a22; max-width: 560px;">',
    ...paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`),
    button
      ? `<p><a href="${escapeHtml(button.url)}" style="display: inline-block; background: #c2255c; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600;">${escapeHtml(button.label)}</a></p>` +
        `<p style="font-size: 13px; color: #6b6573;">If the button does not work, copy this address into your browser:<br>${escapeHtml(button.url)}</p>`
      : '',
    footer ? `<p style="font-size: 13px; color: #6b6573;">${escapeHtml(footer)}</p>` : '',
    `<p style="font-size: 13px; color: #6b6573;">${escapeHtml(APP_NAME)}, the online home of 7 Billion Presidents</p>`,
    '</div>'
  ].join('')

  return { subject, text, html }
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
  })
}

/* ---------- Delivery ---------- */

function fromHeader (options) {
  const sender = options.sender || {}
  const rawName = sender.name || process.env.AGORA_EMAIL_SENDER_NAME || APP_NAME
  return {
    // Hylo's code signs emails as "The Team at Hylo" or "Name (via Hylo)".
    name: rawName === 'The Team at Hylo' ? APP_NAME : rawName.replace(/\bHylo\b/g, APP_NAME),
    email: process.env.EMAIL_SENDER,
    replyTo: sender.reply_to || null
  }
}

async function deliverWithBrevo ({ to, from, content }) {
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
      htmlContent: content.html
    }),
    signal: AbortSignal.timeout(30000)
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Brevo answered ${response.status}: ${body.slice(0, 300)}`)
  }
  return response.json().catch(() => ({}))
}

async function deliverToLog ({ to, from, content }) {
  console.log([
    '',
    '----- Email (not sent, AGORA_EMAIL_TRANSPORT is "log") -----',
    `To:      ${to}`,
    `From:    ${from.name} <${from.email || 'no sender set'}>`,
    `Subject: ${content.subject}`,
    '',
    content.text,
    '-----------------------------------------------------------',
    ''
  ].join('\n'))
  return { logged: true }
}

const TRANSPORTS = {
  log: deliverToLog,
  brevo: deliverWithBrevo
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
    content = template(options.email_data || {})
  } catch (err) {
    return done(err)
  }

  const transportName = (process.env.AGORA_EMAIL_TRANSPORT || 'log').toLowerCase()
  const deliver = TRANSPORTS[transportName]
  if (!deliver) return done(new Error(`Agora mailer: unknown AGORA_EMAIL_TRANSPORT "${transportName}"`))

  deliver({ to, from: fromHeader(options), content })
    .then(result => done(null, result || true))
    .catch(err => done(err))
}

module.exports = { send, compose, TEMPLATES }
