/**
 * Agora: turns a meeting transcript into minutes.
 *
 * Claude reads the transcript and returns a summary, decisions, actions and
 * open questions. We then lay those out as a post. If no Claude key is set,
 * the post simply holds the transcript, so nothing is lost.
 *
 * Settings (see .env.example):
 *   ANTHROPIC_API_KEY   key of the Claude developer account
 *   AGORA_AI_MODEL      model name, default "claude-sonnet-5-5"
 *   AGORA_AI_URL        only for testing, default https://api.anthropic.com/v1/messages
 */

const TIMEOUT_MS = 180000
const MAX_TRANSCRIPT_CHARS = 300000

const SYSTEM_PROMPT = `You write the minutes of a meeting for a volunteer movement.
You are given the transcript, made by speech recognition, so expect small mistakes in words and names.

Rules:
- Use only what was said. Never invent a decision, an owner or a date.
- A decision is something the group agreed on. If it was only discussed, it is not a decision.
- An action needs a person who took it on. If nobody did, put it under open questions.
- Write plainly and briefly, in the language the meeting was held in.
- Do not judge people or comment on how anyone behaved.

Answer with one JSON object and nothing else, in this shape:
{
  "summary": "three to five sentences",
  "topics": [{"title": "short title", "points": ["what was said, one line each"]}],
  "decisions": ["one line each"],
  "actions": [{"who": "name", "what": "what they will do", "due": "date or empty string"}],
  "open_questions": ["one line each"]
}
Use empty arrays where there is nothing to report.`

function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function clock (date, startedAt) {
  const seconds = Math.max(0, Math.round((new Date(date) - new Date(startedAt)) / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Joins consecutive lines by the same speaker, so the transcript reads like a
 * conversation and not like a list of fragments.
 * @param {Array<{name: string, text: string, spokenAt: Date}>} lines sorted by time
 */
function mergeLines (lines) {
  const merged = []
  for (const line of lines) {
    const last = merged[merged.length - 1]
    const gapMs = last ? new Date(line.spokenAt) - new Date(last.lastSpokenAt) : Infinity
    if (last && last.name === line.name && gapMs < 90000) {
      last.text += ' ' + line.text
      last.lastSpokenAt = line.spokenAt
    } else {
      merged.push({ name: line.name, text: line.text, spokenAt: line.spokenAt, lastSpokenAt: line.spokenAt })
    }
  }
  return merged
}

function transcriptAsText (lines, startedAt) {
  return mergeLines(lines)
    .map(l => `[${clock(l.spokenAt, startedAt)}] ${l.name}: ${l.text}`)
    .join('\n')
}

function parseJson (text) {
  try {
    return JSON.parse(text)
  } catch (e) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('The assistant did not answer with JSON')
    return JSON.parse(text.slice(start, end + 1))
  }
}

function list (items) {
  return `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
}

module.exports = {
  isConfigured: function () {
    return !!process.env.ANTHROPIC_API_KEY
  },

  mergeLines,
  transcriptAsText,

  /**
   * Asks Claude for the minutes.
   * @returns {Promise<object>} summary, topics, decisions, actions, open_questions
   */
  summarise: async function ({ title, date, attendees, lines, startedAt }) {
    let transcript = transcriptAsText(lines, startedAt)
    let cut = false
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS)
      cut = true
    }

    const userMessage = [
      `Meeting: ${title}`,
      `Date: ${date}`,
      `Present: ${attendees.join(', ') || 'unknown'}`,
      cut ? 'Note: the transcript was too long and has been cut off at the end.' : null,
      '',
      'Transcript:',
      transcript
    ].filter(x => x !== null).join('\n')

    const response = await fetch(process.env.AGORA_AI_URL || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.AGORA_AI_MODEL || 'claude-sonnet-5-5',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Claude answered ${response.status}: ${body.slice(0, 300)}`)
    }

    const data = await response.json()
    const text = (data.content || []).filter(part => part.type === 'text').map(part => part.text).join('')
    const minutes = parseJson(text)

    return {
      summary: String(minutes.summary || ''),
      topics: Array.isArray(minutes.topics) ? minutes.topics : [],
      decisions: Array.isArray(minutes.decisions) ? minutes.decisions : [],
      actions: Array.isArray(minutes.actions) ? minutes.actions : [],
      open_questions: Array.isArray(minutes.open_questions) ? minutes.open_questions : [],
      cut
    }
  },

  /**
   * Lays the minutes out as the body of a post. Everything that came from the
   * assistant or from speech recognition is escaped.
   */
  renderHtml: function ({ minutes, attendees, lines, startedAt, error }) {
    const parts = []

    if (minutes) {
      parts.push('<p><em>Written by the Agora assistant from the meeting transcript. It can be wrong, so please correct it in the comments.</em></p>')
      if (minutes.summary) parts.push(`<h3>Summary</h3><p>${escapeHtml(minutes.summary)}</p>`)

      parts.push('<h3>Decisions</h3>')
      parts.push(minutes.decisions.length
        ? list(minutes.decisions.map(escapeHtml))
        : '<p>No decisions were recorded.</p>')

      parts.push('<h3>Actions</h3>')
      parts.push(minutes.actions.length
        ? list(minutes.actions.map(a => {
          const due = a && a.due ? ` (by ${escapeHtml(a.due)})` : ''
          return `<strong>${escapeHtml(a && a.who)}</strong>: ${escapeHtml(a && a.what)}${due}`
        }))
        : '<p>No actions were recorded.</p>')

      if (minutes.open_questions.length) {
        parts.push('<h3>Open questions</h3>')
        parts.push(list(minutes.open_questions.map(escapeHtml)))
      }

      if (minutes.topics.length) {
        parts.push('<h3>What was discussed</h3>')
        for (const topic of minutes.topics) {
          parts.push(`<p><strong>${escapeHtml(topic && topic.title)}</strong></p>`)
          const points = Array.isArray(topic && topic.points) ? topic.points : []
          if (points.length) parts.push(list(points.map(escapeHtml)))
        }
      }

      if (minutes.cut) parts.push('<p><em>The transcript was very long, so the end of the meeting is not covered in this summary.</em></p>')
    } else {
      parts.push(error
        ? '<p><em>The assistant could not write a summary this time, so here is the transcript as it was heard.</em></p>'
        : '<p><em>The assistant is not connected yet, so here is the transcript as it was heard.</em></p>')
    }

    parts.push(`<h3>Who was there</h3><p>${attendees.map(escapeHtml).join(', ') || 'Nobody was recorded as present.'}</p>`)

    parts.push('<h3>Transcript</h3>')
    const merged = mergeLines(lines)
    parts.push(merged.length
      ? merged.map(l => `<p><strong>${escapeHtml(l.name)}</strong> <span>${clock(l.spokenAt, startedAt)}</span><br>${escapeHtml(l.text)}</p>`).join('')
      : '<p>Nothing was transcribed.</p>')

    return parts.join('')
  }
}
