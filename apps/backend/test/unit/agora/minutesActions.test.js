/* eslint-env mocha */
/**
 * Agora: action points of minutes as plain functions (lib/agora/minutesActions.js):
 * old and new shapes, matching names to members, reading an Actions list from a post.
 * No database needed for these checks.
 */
import { whoList, whoText, normalizeAction, matchName, matchNames, isGuestName, parseActionsHtml } from '../../../lib/agora/minutesActions'
import MeetingMinutes from '../../../api/services/MeetingMinutes'

describe('Agora minutes actions', () => {
  const members = [
    { id: '1', name: 'Mariam:)' },
    { id: '2', name: 'zenab suleiman' },
    { id: '3', name: 'Lars Jansen' },
    { id: '4', name: 'Lars Peters' },
    { id: '5', name: 'Éva' }
  ]

  describe('shapes', () => {
    it('reads who as a list or as the old single text', () => {
      expect(whoList(['Mariam', 'Zenab'])).to.deep.equal(['Mariam', 'Zenab'])
      expect(whoList('Mariam')).to.deep.equal(['Mariam'])
      expect(whoList('Mariam and Zenab')).to.deep.equal(['Mariam', 'Zenab'])
      expect(whoList('Mariam, Zenab')).to.deep.equal(['Mariam', 'Zenab'])
      expect(whoList(undefined)).to.deep.equal([])
      expect(whoList(['Mariam and Zenab'])).to.deep.equal(['Mariam', 'Zenab'])
      expect(whoList(['Mariam & Zenab', 'Lars'])).to.deep.equal(['Mariam', 'Zenab', 'Lars'])
      expect(whoList(['Mariam, Zenab'])).to.deep.equal(['Mariam', 'Zenab'])
    })

    it('keeps initials whole', () => {
      expect(whoList(['E. Smith'])).to.deep.equal(['E. Smith'])
      expect(whoList('E. Smith and J. Doe')).to.deep.equal(['E. Smith', 'J. Doe'])
    })

    it('joins names with " and " for the minutes post', () => {
      expect(whoText(['Mariam', 'Zenab'])).to.equal('Mariam and Zenab')
      expect(whoText('Mariam and Zenab')).to.equal('Mariam and Zenab')
      expect(whoText(undefined)).to.equal('')
    })

    it('normalises an action, old or new', () => {
      expect(normalizeAction({ who: 'Amara', what: ' Call ', due: 'Friday' })).to.deep.equal({ who: ['Amara'], what: 'Call', due: '', project: null })
      expect(normalizeAction({ who: ['A', 'B'], what: 'x', due: '2026-12-01', project: 42 })).to.deep.equal({ who: ['A', 'B'], what: 'x', due: '2026-12-01', project: '42' })
      expect(normalizeAction({ who: ['A'], what: 'x', due: '2026-02-30', project: 'abc' })).to.include({ due: '', project: null })
      expect(normalizeAction(null)).to.deep.equal({ who: [], what: '', due: '', project: null })
    })

    it('keeps the rendered minutes the same for both shapes', () => {
      const base = { decisions: [], topics: [], open_questions: [], summary: '' }
      const old = MeetingMinutes.renderHtml({ minutes: { ...base, actions: [{ who: 'Mariam and Zenab', what: 'Ring them', due: '' }] }, attendees: [], lines: [] })
      const next = MeetingMinutes.renderHtml({ minutes: { ...base, actions: [{ who: ['Mariam', 'Zenab'], what: 'Ring them', due: '' }] }, attendees: [], lines: [] })
      expect(next).to.equal(old)
      expect(next).to.contain('<strong>Mariam and Zenab</strong>: Ring them')
      const md = MeetingMinutes.renderMarkdown({ title: 'T', date: '2026-11-09', minutes: { ...base, actions: [{ who: ['Mariam', 'Zenab'], what: 'Ring them', due: '2026-12-01' }] }, attendees: [], lines: [] })
      expect(md).to.contain('**Mariam and Zenab**: Ring them (by 2026-12-01)')
    })
  })

  describe('matching names', () => {
    it('matches the first word of the display name, ignoring marks and case', () => {
      expect(matchName('Mariam', members).id).to.equal('1')
      expect(matchName('Zenab', members).id).to.equal('2')
      expect(matchName('ZENAB', members).id).to.equal('2')
      expect(matchName('Eva', members).id).to.equal('5')
    })

    it('matches the full name, and a full name wins over a first word', () => {
      expect(matchName('Zenab Suleiman', members).id).to.equal('2')
      expect(matchName('Lars Peters', members).id).to.equal('4')
    })

    it('gives no match for two equal fits, for strangers and for empty names', () => {
      expect(matchName('Lars', members)).to.equal(null)
      expect(matchName('Nobody', members)).to.equal(null)
      expect(matchName('', members)).to.equal(null)
    })

    it('matches one or two people for an action, once each', () => {
      expect(matchNames(['Mariam', 'Zenab', 'mariam'], members)).to.deep.equal({ everyone: false, people: [members[0], members[1]] })
      expect(matchNames('Mariam and Zenab', members).people.map(p => p.id)).to.deep.equal(['1', '2'])
      expect(matchNames(['Someone else'], members)).to.deep.equal({ everyone: false, people: [] })
    })

    it('understands "everyone"', () => {
      for (const word of ['Everyone', 'all', 'We all', 'iedereen', 'Alle', 'wir alle']) {
        expect(matchNames([word], members).everyone, word).to.equal(true)
      }
    })

    it('never matches a guest: guests are not in the list of members', () => {
      expect(matchName('Gina (guest)', members)).to.equal(null)
    })

    it('never matches a member to a guest, by the (guest) mark or by the guest names of the session', () => {
      expect(isGuestName('Gina (guest)')).to.equal(true)
      expect(isGuestName('Gina ( Guest )')).to.equal(true)
      expect(isGuestName('Lars', ['Lars (guest)'])).to.equal(true)
      expect(isGuestName('Mariam', ['Gina'])).to.equal(false)
      // a guest called Lars is not the member Lars Peters, and "Mariam (guest)" is not Mariam
      expect(matchNames(['Lars Peters'], members, ['Lars Peters']).people).to.deep.equal([])
      expect(matchNames(['Mariam (guest)'], members).people).to.deep.equal([])
      expect(matchNames(['Mariam'], members, ['Gina']).people.map(p => p.id)).to.deep.equal(['1'])
    })

    it('tries a member first and only then the everyone words', () => {
      const withAll = [...members, { id: '9', name: 'All' }, { id: '10', name: 'Everyone Smith' }]
      expect(matchNames(['All'], withAll)).to.deep.equal({ everyone: false, people: [withAll[5]] })
      expect(matchNames(['Everyone'], withAll)).to.deep.equal({ everyone: false, people: [withAll[6]] })
      expect(matchNames(['Everyone'], members)).to.deep.equal({ everyone: true, people: [] })
    })
  })

  describe('reading a minutes post', () => {
    it('reads the Actions list in the format of the post', () => {
      const html = '<h3>Decisions</h3><ul><li>x</li></ul><h3>Actions</h3><ul>' +
        '<li><strong>Mariam and Zenab</strong>: Ring the &quot;venue&quot; &amp; ask (by 2026-12-01)</li>' +
        '<li><strong>Everyone</strong>: Read the plan</li>' +
        '<li><strong>Lars</strong>: Send it (by Friday)</li></ul><h3>Who was there</h3><p>x</p>'
      expect(parseActionsHtml(html)).to.deep.equal([
        { who: 'Mariam and Zenab', what: 'Ring the "venue" & ask', due: '2026-12-01' },
        { who: 'Everyone', what: 'Read the plan', due: '' },
        { who: 'Lars', what: 'Send it (by Friday)', due: '' }
      ])
    })

    it('finds nothing when there are no actions', () => {
      expect(parseActionsHtml('<h3>Actions</h3><p>No actions were recorded.</p>')).to.deep.equal([])
      expect(parseActionsHtml('')).to.deep.equal([])
      expect(parseActionsHtml(null)).to.deep.equal([])
    })
  })
})
