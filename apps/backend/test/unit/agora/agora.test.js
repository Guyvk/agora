/* eslint-env mocha */
/**
 * Agora: checks for the parts that need no database.
 *
 *   cd apps/backend
 *   npx mocha -r @babel/register test/unit/agora/agora.test.js
 */
const { expect } = require('chai')
const MeetingMinutes = require('../../../api/services/MeetingMinutes')
const mailer = require('../../../lib/agora/mailer')

const startedAt = new Date('2026-10-12T17:00:00Z')
const at = seconds => new Date(startedAt.getTime() + seconds * 1000)

describe('Agora meeting minutes', () => {
  const lines = [
    { name: 'Lars', text: 'I propose consent.', spokenAt: at(5) },
    { name: 'Lars', text: 'For three months.', spokenAt: at(12) },
    { name: 'Amara', text: 'Fine by me.', spokenAt: at(20) },
    { name: 'Lars', text: 'Good.', spokenAt: at(200) }
  ]

  it('joins what one person says in a row', () => {
    const merged = MeetingMinutes.mergeLines(lines)
    expect(merged.map(l => l.name)).to.deep.equal(['Lars', 'Amara', 'Lars'])
    expect(merged[0].text).to.equal('I propose consent. For three months.')
  })

  it('writes the transcript with a clock and a name on each line', () => {
    const text = MeetingMinutes.transcriptAsText(lines, startedAt)
    expect(text.split('\n')[0]).to.equal('[0:05] Lars: I propose consent. For three months.')
    expect(text).to.contain('[3:20] Lars: Good.')
  })

  it('escapes whatever the assistant or the speech recognition returns', () => {
    const html = MeetingMinutes.renderHtml({
      minutes: {
        summary: 'A <b>bold</b> summary',
        topics: [{ title: 'T', points: ['<img src=x onerror=alert(1)>'] }],
        decisions: ['<script>alert(1)</script>'],
        actions: [{ who: 'Lars', what: 'Rewrite & send', due: '' }],
        open_questions: []
      },
      attendees: ['Lars', 'Amara <x>'],
      lines: [{ name: 'Lars', text: '<i>hello</i>', spokenAt: at(1) }],
      startedAt
    })
    expect(html).to.not.contain('<script>')
    expect(html).to.not.contain('<img')
    expect(html).to.not.contain('<i>hello</i>')
    expect(html).to.contain('&lt;script&gt;')
    expect(html).to.contain('<strong>Lars</strong>: Rewrite &amp; send')
    expect(html).to.contain('Amara &lt;x&gt;')
  })

  it('falls back to the transcript when there is no summary', () => {
    const html = MeetingMinutes.renderHtml({ minutes: null, attendees: [], lines, startedAt })
    expect(html).to.contain('The assistant is not connected yet')
    expect(html).to.contain('<h3>Transcript</h3>')
    expect(html).to.not.contain('<h3>Decisions</h3>')
  })
})

describe('Agora mailer', () => {
  it('has a text for every email a new member needs', () => {
    const needed = [
      'tem_h99yGHv9MXTpMrPSDVTjQFyB', // verification code
      'tem_fqGSrDrSK6WpjTBFXSfY79k4', // finish registration
      'tem_phRPHm3y6RHvRFww6Vc3VBVB', // password reset
      'tem_GTwXKBfkTpTHRfHpmJWbYr9d' // invitation
    ]
    needed.forEach(id => expect(mailer.TEMPLATES[id], id).to.be.a('function'))
  })

  it('puts the code in the verification email and escapes links in the HTML', () => {
    const email = mailer.TEMPLATES.tem_h99yGHv9MXTpMrPSDVTjQFyB({ code: '482913', verify_url: 'https://agora.test/v?a=1&b=<2>' })
    expect(email.subject).to.contain('482913')
    expect(email.text).to.contain('https://agora.test/v?a=1&b=<2>')
    expect(email.html).to.contain('href="https://agora.test/v?a=1&amp;b=&lt;2&gt;"')
  })

  it('does not send an email it has no text for', done => {
    mailer.send({ email_id: 'tem_does_not_exist', recipient: { address: 'x@agora.test' } }, (err, result) => {
      expect(err).to.equal(null)
      expect(result).to.deep.equal({ skipped: true })
      done()
    })
  })
})
