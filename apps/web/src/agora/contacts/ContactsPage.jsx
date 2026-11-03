/**
 * Agora: the shared Contacts page, a small CRM for the people and organisations
 * 7BP works with, team members and people outside Agora. Every Agora member can read, add, change and
 * delete contacts; the server logs who changed which fields.
 *
 *   /contacts             the list
 *   /contacts/new         a new contact
 *   /contacts/<id>        one contact
 *   /contacts?view=mine   my follow-ups (also view=council and view=unclaimed)
 *
 * One contact opens in a side panel on the right of the table (rows carry no photos): read mode first, Edit shows the form.
 *
 * A team member's contact can hold a short profile (from their sheet at the
 * activist council) and a claim link, so the person can make it their own
 * profile later (see ../claim/ClaimPage.jsx and apps/backend/lib/agora/claims.js).
 *
 * The data comes from the server part, see apps/backend/lib/agora/contacts.js.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, BookUser, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import Checkbox from 'components/ui/checkbox'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import { contactsApi, today } from './api'

export const CONTACT_FIELDS = [
  'name', 'organisation', 'kind', 'email', 'phone', 'website', 'status', 'circle_id',
  'source', 'consent', 'follow_up_on', 'follow_up_what', 'follow_up_owner_id',
  'country', 'offers', 'why_here', 'skills'
]
const PROFILE_FIELDS = ['country', 'offers', 'why_here', 'skills']

const fieldClasses = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function useLabels (t) {
  return useMemo(() => ({
    kinds: { team: t('Team'), partner: t('Partner'), press: t('Press'), funder: t('Funder'), interested: t('Interested'), other: t('Other') },
    statuses: { new: t('New'), in_touch: t('In touch'), active: t('Active'), paused: t('Paused') },
    fields: {
      name: t('name'),
      organisation: t('organisation'),
      kind: t('kind'),
      email: t('email'),
      phone: t('phone'),
      website: t('website'),
      status: t('status'),
      circle_id: t('circle'),
      source: t('source'),
      consent: t('consent'),
      follow_up_on: t('next step date'),
      follow_up_what: t('next step'),
      follow_up_owner_id: t('who does the next step'),
      country: t('country'),
      offers: t('what they do and can do'),
      why_here: t('why they are here'),
      skills: t('skills'),
      photo_url: t('photo')
    }
  }), [t])
}

function formatDay (day) {
  return day ? new Date(day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

function formatMoment (iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

function Select ({ value, onChange, children, ...props }) {
  return (
    <select className={fieldClasses} value={value || ''} onChange={e => onChange(e.target.value)} {...props}>
      {children}
    </select>
  )
}

function Field ({ label, htmlFor, className, children }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className='text-muted-foreground'>{label}</Label>
      {children}
    </div>
  )
}


function claimState (c) {
  if (c.kind !== 'team') return null
  if (c.claimed_user_id) return 'claimed'
  if (c.proposed_user_id) return 'proposed'
  return 'unclaimed'
}

function initials (name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

function Avatar ({ contact, size = 'sm' }) {
  const cls = size === 'lg' ? 'w-14 h-14 text-lg' : 'w-8 h-8 text-xs'
  if (contact.photo_url) return <img src={contact.photo_url} alt='' loading='lazy' className={cn('shrink-0 rounded-full object-cover border border-border', cls)} />
  return <span aria-hidden='true' className={cn('shrink-0 rounded-full bg-selected text-foreground/80 flex items-center justify-center font-semibold', cls)}>{initials(contact.name)}</span>
}

function Pill ({ children, tone }) {
  return <span className={cn('inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap', tone === 'accent' ? 'border-accent/60 bg-accent/10 text-foreground/80' : 'border-foreground/20 text-foreground/80')}>{children}</span>
}

// Stewards (who can make claim links) see Proposed; everyone else sees Unclaimed for those
function statusText (c, labels, t, canSeeProposed) {
  const s = claimState(c)
  if (!s) return labels.statuses[c.status] || c.status
  if (s === 'claimed') return t('Claimed')
  if (s === 'proposed' && canSeeProposed) return t('Proposed')
  return t('Unclaimed')
}

const COLUMNS = [
  { key: 'name', label: 'Name', cls: '' },
  { key: 'kind', label: 'Kind', cls: 'max-md:hidden' },
  { key: 'status', label: 'Status', cls: '' },
  { key: 'country', label: 'Country', cls: 'max-md:hidden' },
  { key: 'last', label: 'Last contact', cls: 'max-md:hidden' },
  { key: 'followup', label: 'Follow-up', cls: 'max-md:hidden' }
]

function sortValue (c, key, labels, t, canSeeProposed) {
  if (key === 'name') return (c.name || '').toLowerCase()
  if (key === 'kind') return (labels.kinds[c.kind] || c.kind || '').toLowerCase()
  if (key === 'status') return statusText(c, labels, t, canSeeProposed).toLowerCase()
  if (key === 'country') return (c.country || '').toLowerCase()
  if (key === 'last') return c.last_contact_at ? new Date(c.last_contact_at).toISOString() : ''
  return c.follow_up_on || ''
}

export function sortContacts (list, sort, labels, t, canSeeProposed) {
  const dir = sort.dir === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    const x = sortValue(a, sort.key, labels, t, canSeeProposed)
    const y = sortValue(b, sort.key, labels, t, canSeeProposed)
    if (x === y) return 0
    if (x === '') return 1 // empty values always last
    if (y === '') return -1
    return x < y ? -dir : dir
  })
}

function ContactsTable ({ contacts, labels, sort, onSort, selectedId, onOpen, canSeeProposed }) {
  const { t } = useTranslation()
  return (
    <table className='w-full text-sm border-collapse' aria-label={t('Contacts')}>
      <thead>
        <tr className='border-b border-border text-left text-xs text-muted-foreground'>
          {COLUMNS.map(col => (
            <th key={col.key} scope='col' className={cn('px-3 py-2 font-medium', col.cls)} aria-sort={sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button type='button' className='inline-flex items-center gap-1 hover:text-foreground' onClick={() => onSort(col.key)} aria-label={t('Sort by {{column}}', { column: t(col.label) })}>
                {t(col.label)}
                {sort.key === col.key && (sort.dir === 'asc' ? <ArrowUp className='w-3 h-3' /> : <ArrowDown className='w-3 h-3' />)}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {contacts.map(c => {
          const due = c.follow_up_on && c.follow_up_on <= today()
          const selected = String(c.id) === String(selectedId)
          return (
            <tr
              key={c.id}
              onClick={() => onOpen(c.id)}
              aria-selected={selected ? 'true' : undefined}
              className={cn('border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-selected/40', { 'bg-selected/60': selected })}
            >
              <td className='px-3 py-2'>
                <button type='button' className='flex items-center text-left w-full' onClick={e => { e.stopPropagation(); onOpen(c.id) }}>
                  <span className='min-w-0'>
                    <span className='block font-semibold text-foreground break-words'>{c.name}</span>
                    {c.organisation && <span className='block text-xs text-muted-foreground break-words'>{c.organisation}</span>}
                  </span>
                </button>
              </td>
              <td className='px-3 py-2 max-md:hidden'><Pill>{labels.kinds[c.kind] || c.kind}</Pill></td>
              <td className='px-3 py-2'><Pill tone={claimState(c) === 'claimed' ? 'accent' : undefined}>{statusText(c, labels, t, canSeeProposed)}</Pill></td>
              <td className='px-3 py-2 max-md:hidden text-foreground'>{c.country || '—'}</td>
              <td className='px-3 py-2 max-md:hidden text-foreground'>{c.last_contact_at ? formatDay(new Date(c.last_contact_at).toLocaleDateString('sv-SE')) : '—'}</td>
              <td className='px-3 py-2 max-md:hidden'>
                {c.follow_up_on
                  ? <span className={cn(due ? 'font-semibold text-destructive' : 'text-foreground')}>{formatDay(c.follow_up_on)}</span>
                  : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * Propose this profile to a member (stewards only): a searchable dropdown with
 * the members who share the first name first. Suggestions only, a person always
 * chooses. Change or clear a proposal here too.
 */
export function ProposeBox ({ contact, onChanged }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [choices, setChoices] = useState({ suggested: [], members: [] })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setQ(''); setError(null) }, [contact.id])

  useEffect(() => {
    let stopped = false
    contactsApi(`/${contact.id}/member-choices?q=${encodeURIComponent(q)}`)
      .then(data => { if (!stopped) setChoices(data) })
      .catch(e => { if (!stopped) setError(e.message) })
    return () => { stopped = true }
  }, [q, contact.id])

  const act = async (path, body) => {
    setBusy(true)
    setError(null)
    try {
      await contactsApi(`/${contact.id}/${path}`, body || {})
      onChanged && onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const suggestedIds = new Set(choices.suggested.map(m => m.id))
  const others = choices.members.filter(m => !suggestedIds.has(m.id))
  const pick = m => (
    <li key={m.id}>
      <button type='button' disabled={busy} className='w-full text-left rounded px-2 py-1.5 hover:bg-selected/60 text-foreground' onClick={() => act('propose', { userId: m.id })}>{m.name}</button>
    </li>
  )

  return (
    <div className='flex flex-col gap-2 text-sm' data-testid='propose-box'>
      {contact.proposed_user_id
        ? <p className='m-0 text-foreground'>{t('Proposed to {{name}}', { name: contact.proposed_user_name || t('a member') })}</p>
        : <p className='m-0 text-muted-foreground'>{t('Not proposed to anyone. Agora may still guess from the names when a name is unique.')}</p>}
      {error && <p role='alert' className='m-0 text-destructive'>{error}</p>}
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Search members')} aria-label={t('Search members')} />
      <div className='max-h-60 overflow-y-auto flex flex-col gap-1'>
        {choices.suggested.length > 0 && (
          <>
            <p className='m-0 px-2 text-xs font-semibold text-muted-foreground'>{t('Suggested (same first name)')}</p>
            <ul className='m-0 p-0 list-none' data-testid='suggested'>{choices.suggested.map(pick)}</ul>
          </>
        )}
        {others.length > 0 && (
          <>
            <p className='m-0 px-2 text-xs font-semibold text-muted-foreground'>{t('All members')}</p>
            <ul className='m-0 p-0 list-none' data-testid='all-members'>{others.map(pick)}</ul>
          </>
        )}
        {choices.suggested.length === 0 && others.length === 0 && <p className='m-0 px-2 text-muted-foreground'>{t('No members found.')}</p>}
      </div>
      {contact.proposed_user_id && (
        <Button type='button' variant='ghost' size='sm' className='text-destructive self-start' disabled={busy} onClick={() => act('propose/clear')}>{t('Clear proposal')}</Button>
      )}
      <p className='m-0 text-muted-foreground'>{t('Only that member sees the proposal and decides if it is theirs.')}</p>
    </div>
  )
}

/**
 * The claim link of a team member's profile: make one, copy it (it is shown
 * only once), make a new one or withdraw it. Once claimed, who claimed it.
 */
export function ClaimBox ({ contact, canMakeClaimLinks, onChanged }) {
  const { t } = useTranslation()
  const [link, setLink] = useState(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setLink(null); setCopied(false); setError(null) }, [contact.id])

  if (contact.claimed_user_id) {
    return (
      <p className='m-0 text-sm text-foreground' data-testid='claim-status'>
        {t('Claimed by')} <a href={`/members/${contact.claimed_user_id}`} className='font-semibold underline'>{contact.claimed_user_name || t('a member')}</a>
        {contact.claimed_at ? ', ' + formatMoment(contact.claimed_at) : ''}
      </p>
    )
  }

  const act = async (path) => {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const data = await contactsApi(`/${contact.id}/${path}`, {})
      setLink(data.link || null)
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch (e) {
      setError(t('Copying did not work. Select the link and copy it yourself.'))
    }
  }

  return (
    <div className='flex flex-col gap-2 text-sm'>
      <p className='m-0 text-muted-foreground'>{t('Not claimed yet. With a claim link the person makes an account with their own email address and makes this profile their own.')}</p>
      {link && (
        <div className='flex flex-col gap-1.5'>
          <div className='flex gap-2'>
            <Input readOnly value={link} aria-label={t('Claim link')} onFocus={e => e.target.select()} />
            <Button type='button' variant='outline' size='sm' className='h-10' onClick={copy}>{copied ? t('Copied') : t('Copy link')}</Button>
          </div>
          <p className='m-0 text-muted-foreground'>{t('Copy it now: for safety Agora shows it only once. Whoever has this link can claim this profile, so give it only to this person.')}</p>
        </div>
      )}
      {!link && contact.has_claim_link && (
        <p className='m-0 text-foreground'>{t('A claim link was made on {{date}}. Agora cannot show it again. If it is lost, make a new one: the old one then stops working.', { date: formatMoment(contact.claim_token_created_at) })}</p>
      )}
      {canMakeClaimLinks
        ? (
          <div className='flex flex-wrap gap-2'>
            <Button type='button' variant='outline' size='sm' disabled={busy} onClick={() => act('claim-link')}>
              {contact.has_claim_link || link ? t('Make a new claim link') : t('Make claim link')}
            </Button>
            {(contact.has_claim_link || link) && (
              <Button type='button' variant='ghost' size='sm' className='text-destructive' disabled={busy} onClick={() => { act('claim-link/withdraw'); setLink(null) }}>{t('Withdraw')}</Button>
            )}
          </div>)
        : <p className='m-0 text-muted-foreground'>{t('Stewards can make a claim link.')}</p>}
      {error && <p role='alert' className='m-0 text-destructive'>{error}</p>}
    </div>
  )
}

function emptyContact () {
  return { kind: 'partner', status: 'new', consent: false }
}

export function ContactForm ({ contact, meta, labels, onSaved, onCancel }) {
  const { t } = useTranslation()
  const [values, setValues] = useState(() => ({ ...emptyContact(), ...(contact || {}) }))
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const isNew = !contact || !contact.id
  const showProfile = values.kind === 'team' || PROFILE_FIELDS.some(f => values[f])

  useEffect(() => {
    setValues({ ...emptyContact(), ...(contact || {}) })
    setError(null)
    setSaved(false)
  }, [contact])

  const set = (name) => (value) => { setSaved(false); setValues(v => ({ ...v, [name]: value })) }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {}
      for (const f of CONTACT_FIELDS) body[f] = values[f] == null ? '' : values[f]
      body.consent = !!values.consent
      const { id } = await contactsApi(isNew ? '/create' : `/${contact.id}/update`, body)
      setSaved(true)
      onSaved(id)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} noValidate className='flex flex-col gap-4'>
      <div className='flex items-start gap-3'>
        {!isNew && contact.photo_url && (
          <a href={contact.photo_url} target='_blank' rel='noreferrer' className='shrink-0' title={t('Open the photo')}>
            <img src={contact.photo_url} alt={t('Photo of {{name}}', { name: contact.name })} className='w-20 h-20 rounded-md object-cover border border-border' />
          </a>
        )}
        <h2 className='text-xl font-bold text-foreground break-words'>{isNew ? t('New contact') : contact.name}</h2>
      </div>

      <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
        <Field label={t('Name')} htmlFor='contact-name' className='sm:col-span-2'>
          <Input id='contact-name' value={values.name || ''} onChange={e => set('name')(e.target.value)} maxLength={255} required autoFocus={isNew} />
        </Field>
        <Field label={t('Organisation')} htmlFor='contact-organisation'>
          <Input id='contact-organisation' value={values.organisation || ''} onChange={e => set('organisation')(e.target.value)} maxLength={255} />
        </Field>
        <Field label={t('Kind')} htmlFor='contact-kind'>
          <Select id='contact-kind' value={values.kind} onChange={set('kind')}>
            {meta.kinds.map(k => <option key={k} value={k}>{labels.kinds[k] || k}</option>)}
          </Select>
        </Field>
        <Field label={t('Email')} htmlFor='contact-email'>
          <Input id='contact-email' type='email' value={values.email || ''} onChange={e => set('email')(e.target.value)} maxLength={255} />
        </Field>
        <Field label={t('Phone')} htmlFor='contact-phone'>
          <Input id='contact-phone' value={values.phone || ''} onChange={e => set('phone')(e.target.value)} maxLength={50} />
        </Field>
        <Field label={t('Website')} htmlFor='contact-website'>
          <Input id='contact-website' value={values.website || ''} onChange={e => set('website')(e.target.value)} maxLength={255} />
        </Field>
        <Field label={t('Status')} htmlFor='contact-status'>
          <Select id='contact-status' value={values.status} onChange={set('status')}>
            {meta.statuses.map(s => <option key={s} value={s}>{labels.statuses[s] || s}</option>)}
          </Select>
        </Field>
        <Field label={t('Circle that mainly deals with them')} htmlFor='contact-circle' className='sm:col-span-2'>
          <Select id='contact-circle' value={values.circle_id} onChange={set('circle_id')}>
            <option value=''>{t('No circle')}</option>
            {meta.circles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t('Where the details came from')} htmlFor='contact-source' className='sm:col-span-2'>
          <Input id='contact-source' value={values.source || ''} onChange={e => set('source')(e.target.value)} maxLength={2000} placeholder={t('For example: met at the Utrecht event, business card')} />
        </Field>
        <div className='sm:col-span-2 flex items-center gap-2'>
          <Checkbox id='contact-consent' checked={!!values.consent} onCheckedChange={checked => set('consent')(checked === true)} />
          <Label htmlFor='contact-consent' className='text-foreground'>{t('They agreed that 7BP may contact them')}</Label>
        </div>
        {showProfile && (
          <>
            <h3 className='sm:col-span-2 font-semibold text-foreground mt-2'>{t('Profile')}</h3>
            <Field label={t('Country')} htmlFor='contact-country' className='sm:col-span-2'>
              <Input id='contact-country' value={values.country || ''} onChange={e => set('country')(e.target.value)} maxLength={255} />
            </Field>
            <Field label={t('What they do and can do')} htmlFor='contact-offers' className='sm:col-span-2'>
              <textarea id='contact-offers' className={cn(fieldClasses, 'min-h-[80px] h-auto')} value={values.offers || ''} onChange={e => set('offers')(e.target.value)} maxLength={5000} />
            </Field>
            <Field label={t('Why they are here')} htmlFor='contact-why-here' className='sm:col-span-2'>
              <textarea id='contact-why-here' className={cn(fieldClasses, 'min-h-[60px] h-auto')} value={values.why_here || ''} onChange={e => set('why_here')(e.target.value)} maxLength={5000} />
            </Field>
            <Field label={t('Skills, separated by commas')} htmlFor='contact-skills' className='sm:col-span-2'>
              <Input id='contact-skills' value={values.skills || ''} onChange={e => set('skills')(e.target.value)} placeholder={t('For example: facilitation, writing, video')} />
            </Field>
          </>
        )}
        <Field label={t('Next step on')} htmlFor='contact-follow-up-on'>
          <Input id='contact-follow-up-on' type='date' value={values.follow_up_on || ''} onChange={e => set('follow_up_on')(e.target.value)} />
        </Field>
        <Field label={t('Who does it')} htmlFor='contact-owner'>
          <Select id='contact-owner' value={values.follow_up_owner_id} onChange={set('follow_up_owner_id')}>
            <option value=''>{t('Nobody yet')}</option>
            {meta.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label={t('Next step')} htmlFor='contact-follow-up-what' className='sm:col-span-2'>
          <Input id='contact-follow-up-what' value={values.follow_up_what || ''} onChange={e => set('follow_up_what')(e.target.value)} maxLength={1000} placeholder={t('For example: send the playbook draft')} />
        </Field>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button type='submit' disabled={busy}>{t('Save')}</Button>
        <Button type='button' variant='outline' onClick={onCancel}>{t('Cancel')}</Button>
        {error && <span role='alert' className='text-sm text-destructive'>{error}</span>}
        {saved && !error && <span className='text-sm text-muted-foreground'>{t('Saved.')}</span>}
      </div>
    </form>
  )
}

function changeText (h, t, labels) {
  const fields = Array.isArray(h.fields) ? h.fields.map(f => labels.fields[f] || f).join(', ') : ''
  const who = h.user_name || t('Someone')
  if (h.action === 'created') return t('{{who}} added this contact', { who })
  if (h.action === 'updated') return t('{{who}} changed {{fields}}', { who, fields })
  if (h.action === 'note') return t('{{who}} added a note', { who })
  if (h.action === 'claim_link') return t('{{who}} made a claim link', { who })
  if (h.action === 'claim_link_withdrawn') return t('{{who}} withdrew the claim link', { who })
  if (h.action === 'claimed') return t('{{who}} claimed this profile', { who })
  if (h.action === 'claimed_by_proposal') return t('{{who}} claimed this profile (it was proposed to them)', { who })
  if (h.action === 'proposed') return t('{{who}} proposed this profile to a member', { who })
  if (h.action === 'proposal_cleared') return t('{{who}} took back the proposal', { who })
  if (h.action === 'proposal_declined') return t('{{who}} said this profile is not theirs', { who })
  return `${who}: ${h.action}`
}

/** Notes and change-log entries (claim events included) as one list, newest first. */
export function buildTimeline (contact, t, labels) {
  const items = []
  for (const n of contact.notes || []) items.push({ type: 'note', key: 'n' + n.id, at: n.created_at, who: n.author_name || t('Someone'), body: n.body })
  // a 'note' change only repeats the note itself
  ;(contact.changes || []).forEach((h, i) => {
    if (h.action === 'note') return
    items.push({ type: 'event', key: 'c' + i, at: h.created_at, text: changeText(h, t, labels) })
  })
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

function Detail ({ label, children }) {
  if (!children) return null
  return (
    <div className='flex flex-col gap-0.5'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='m-0 text-foreground break-words whitespace-pre-wrap'>{children}</dd>
    </div>
  )
}

function ContactPanel ({ contact, meta, labels, flash, onEdit, onClose, onChanged, onDeleted }) {
  const { t } = useTranslation()
  const [popover, setPopover] = useState(null) // 'claim' | 'propose' | 'menu'
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState(null)
  const isTeam = contact.kind === 'team'
  const skills = (contact.skills || '').split(',').map(s => s.trim()).filter(Boolean)
  const timeline = useMemo(() => buildTimeline(contact, t, labels), [contact, t, labels])
  const state = claimState(contact)
  const toggle = name => setPopover(p => p === name ? null : name)

  useEffect(() => { setPopover(null); setConfirmDelete(false); setNote(''); setNoteError(null) }, [contact.id])

  const addNote = async () => {
    setNoteError(null)
    try {
      await contactsApi(`/${contact.id}/notes`, { body: note })
      setNote('')
      onChanged()
    } catch (e) {
      setNoteError(e.message)
    }
  }

  const remove = async () => {
    try {
      await contactsApi(`/${contact.id}/delete`, {})
      onDeleted()
    } catch (e) {
      setDeleteError(e.message)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-start gap-3'>
        {contact.photo_url
          ? (
            <a href={contact.photo_url} target='_blank' rel='noreferrer' className='shrink-0' title={t('Open the photo')}>
              <img src={contact.photo_url} alt={t('Photo of {{name}}', { name: contact.name })} className='w-14 h-14 rounded-full object-cover border border-border' />
            </a>)
          : <Avatar contact={contact} size='lg' />}
        <div className='min-w-0 mr-auto'>
          <h2 className='text-xl font-bold text-foreground break-words m-0'>{contact.name}</h2>
          {contact.organisation && <p className='m-0 text-sm text-muted-foreground break-words'>{contact.organisation}</p>}
          <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
            <Pill>{labels.kinds[contact.kind] || contact.kind}</Pill>
            <Pill>{labels.statuses[contact.status] || contact.status}</Pill>
            {state && <Pill tone={state === 'claimed' ? 'accent' : undefined}>{state === 'claimed' ? t('Claimed') : state === 'proposed' ? t('Proposed') : t('Unclaimed')}</Pill>}
            {contact.country && <span className='text-xs text-muted-foreground'>{contact.country}</span>}
          </div>
        </div>
        <Button type='button' variant='ghost' size='icon' onClick={onClose} aria-label={t('Close')}><X /></Button>
      </div>

      <div className='relative flex flex-wrap items-center gap-2'>
        <Button type='button' variant='outline' size='sm' onClick={onEdit}><Pencil /> {t('Edit')}</Button>
        {isTeam && (
          <Button type='button' variant='outline' size='sm' aria-expanded={popover === 'claim'} onClick={() => toggle('claim')}>{t('Claim link')}</Button>
        )}
        {isTeam && meta.canMakeClaimLinks && !contact.claimed_user_id && (
          <Button type='button' variant='outline' size='sm' aria-expanded={popover === 'propose'} onClick={() => toggle('propose')}>{t('Propose')}</Button>
        )}
        <Button type='button' variant='ghost' size='icon' aria-label={t('More actions')} aria-expanded={popover === 'menu'} onClick={() => toggle('menu')}><MoreHorizontal /></Button>
        {popover === 'claim' && (
          <div className='absolute left-0 top-full mt-1 z-20 w-full max-w-[420px] rounded-md border border-border bg-card p-3 shadow-lg'>
            <ClaimBox contact={contact} canMakeClaimLinks={!!meta.canMakeClaimLinks} onChanged={onChanged} />
          </div>
        )}
        {popover === 'propose' && (
          <div className='absolute left-0 top-full mt-1 z-20 w-full max-w-[420px] rounded-md border border-border bg-card p-3 shadow-lg'>
            <ProposeBox contact={contact} onChanged={() => { setPopover(null); onChanged() }} />
          </div>
        )}
        {popover === 'menu' && (
          <div className='absolute right-0 top-full mt-1 z-20 rounded-md border border-border bg-card p-1 shadow-lg'>
            <Button type='button' variant='ghost' size='sm' className='text-destructive' onClick={() => { setPopover(null); setConfirmDelete(true) }}>
              <Trash2 /> {t('Delete this contact')}
            </Button>
          </div>
        )}
      </div>
      {flash && <p className='m-0 text-sm text-muted-foreground' role='status'>{flash}</p>}
      {confirmDelete && (
        <div className='flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground'>
          <span>{t('This removes the contact and all notes for good. Sure?')}</span>
          <Button type='button' variant='destructive' size='sm' onClick={remove}>{t('Yes, delete')}</Button>
          <Button type='button' variant='outline' size='sm' onClick={() => setConfirmDelete(false)}>{t('Keep')}</Button>
          {deleteError && <span role='alert' className='text-destructive'>{deleteError}</span>}
        </div>
      )}

      <section className='flex flex-col gap-3 border-t border-border pt-4'>
        <h3 className='font-semibold text-foreground m-0'>{t('Details')}</h3>
        <dl className='m-0 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm'>
          <Detail label={t('What they do and can do')}>{contact.offers}</Detail>
          <Detail label={t('Why they are here')}>{contact.why_here}</Detail>
          {skills.length > 0 && (
            <div className='sm:col-span-2 flex flex-col gap-1'>
              <dt className='text-xs text-muted-foreground'>{t('Skills')}</dt>
              <dd className='m-0 flex flex-wrap gap-1.5' data-testid='skills'>{skills.map(s => <Pill key={s}>{s}</Pill>)}</dd>
            </div>
          )}
          <Detail label={t('Circle')}>{contact.circle_name}</Detail>
          <Detail label={t('Owner of the next step')}>{contact.follow_up_owner_name}</Detail>
          <Detail label={t('Next step')}>{[contact.follow_up_what, contact.follow_up_on && formatDay(contact.follow_up_on)].filter(Boolean).join(' · ')}</Detail>
          <Detail label={t('Email')}>{contact.email && <a href={`mailto:${contact.email}`} className='underline'>{contact.email}</a>}</Detail>
          <Detail label={t('Phone')}>{contact.phone}</Detail>
          <Detail label={t('Website')}>{contact.website}</Detail>
          <Detail label={t('Where the details came from')}>{contact.source}</Detail>
        </dl>
        {state === 'claimed' && <ClaimBox contact={contact} canMakeClaimLinks={false} onChanged={onChanged} />}
      </section>

      <section className='flex flex-col gap-3 border-t border-border pt-4'>
        <h3 className='font-semibold text-foreground m-0'>{t('Activity')}</h3>
        <textarea
          className={cn(fieldClasses, 'min-h-[72px] h-auto')}
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={5000}
          placeholder={t('Write a note…')}
          aria-label={t('New note')}
        />
        <div className='flex items-center gap-2'>
          <Button type='button' size='sm' onClick={addNote} disabled={!note.trim()}>{t('Add')}</Button>
          {noteError && <span role='alert' className='text-sm text-destructive'>{noteError}</span>}
        </div>
        {timeline.length === 0 && <p className='m-0 text-sm text-muted-foreground'>{t('No notes yet.')}</p>}
        <ol className='m-0 p-0 list-none flex flex-col gap-3'>
          {timeline.map(item => (
            <li key={item.key} className='border-l-2 border-border pl-3'>
              {item.type === 'note'
                ? (
                  <>
                    <p className='m-0 whitespace-pre-wrap break-words text-foreground'>{item.body}</p>
                    <p className='m-0 text-xs text-muted-foreground'>{item.who + ', ' + formatMoment(item.at)}</p>
                  </>)
                : <p className='m-0 text-xs text-muted-foreground'>{item.text + ', ' + formatMoment(item.at)}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}


const VIEWS = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My follow-ups' },
  { key: 'council', label: 'Activist council' },
  { key: 'unclaimed', label: 'Unclaimed' }
]

export default function ContactsPage () {
  const { t } = useTranslation()
  const labels = useLabels(t)
  const navigate = useNavigate()
  const { contactId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('mine') === '1' ? 'mine' : (VIEWS.find(v => v.key === searchParams.get('view')) || VIEWS[0]).key
  const mine = view === 'mine'
  const [meta, setMeta] = useState(null)
  const [contacts, setContacts] = useState(null)
  const [listError, setListError] = useState(null)
  const [pageError, setPageError] = useState(null)
  const [contact, setContact] = useState(null)
  const [editing, setEditing] = useState(false)
  const [flash, setFlash] = useState(null)
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  const [filters, setFilters] = useState({ q: '', kind: '', status: '', circle: '' })
  const [dueCount, setDueCount] = useState(0)
  const searchTimer = useRef(null)
  const [query, setQuery] = useState('')

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Contacts'), icon: <BookUser /> })
  }, [setHeaderDetails, t])

  useEffect(() => {
    contactsApi('/meta')
      .then(data => { setMeta(data); setDueCount(data.dueCount || 0) })
      .catch(e => setPageError(e.message))
  }, [])

  const loadList = useCallback(async () => {
    const params = new URLSearchParams()
    if (mine) params.set('mine', '1')
    else {
      if (filters.q.trim()) params.set('q', filters.q.trim())
      if (filters.kind) params.set('kind', filters.kind)
      if (filters.status) params.set('status', filters.status)
      if (filters.circle) params.set('circle', filters.circle)
      if (view === 'council' || view === 'unclaimed') params.set('kind', 'team')
    }
    try {
      setListError(null)
      setContacts((await contactsApi('/list?' + params)).contacts)
    } catch (e) {
      setListError(e.message)
    }
  }, [mine, view, filters])

  useEffect(() => { if (meta) loadList() }, [meta, loadList])

  const loadContact = useCallback(async (id) => {
    if (!id || id === 'new') { setContact(null); return }
    try {
      setContact((await contactsApi('/' + encodeURIComponent(id))).contact)
    } catch (e) {
      setContact({ missing: true, message: e.message })
    }
  }, [])

  // Opening another contact always starts in read mode
  useEffect(() => { setEditing(false); setFlash(null); loadContact(contactId) }, [contactId, loadContact])

  const refreshDue = () => contactsApi('/due').then(d => setDueCount(d.count)).catch(() => {})

  const keepSearch = (path) => navigate({ pathname: path, search: searchParams.toString() ? '?' + searchParams.toString() : '' })

  const onSaved = async (id) => {
    setEditing(false)
    setFlash(t('Saved.'))
    if (String(id) !== String(contactId)) keepSearch(`/contacts/${id}`)
    else await loadContact(id)
    loadList()
    refreshDue()
  }

  const onChanged = async () => {
    await loadContact(contactId)
    loadList()
  }

  const onDeleted = () => {
    keepSearch('/contacts')
    loadList()
    refreshDue()
  }

  const setView = (key) => {
    const next = new URLSearchParams(searchParams)
    next.delete('mine')
    if (key === 'all') next.delete('view')
    else next.set('view', key)
    setSearchParams(next)
  }

  const onSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const onSearch = (value) => {
    setQuery(value)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setFilters(f => ({ ...f, q: value })), 250)
  }

  const canSeeProposed = !!(meta && meta.canMakeClaimLinks)
  const shown = useMemo(() => {
    if (!contacts) return null
    const rows = view === 'unclaimed' ? contacts.filter(c => c.kind === 'team' && !c.claimed_user_id) : contacts
    return sortContacts(rows, sort, labels, t, canSeeProposed)
  }, [contacts, view, sort, labels, t, canSeeProposed])

  if (pageError) {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <div className='text-center py-12 bg-destructive/10 rounded-lg border border-destructive/20'>
          <BookUser className='w-12 h-12 mx-auto mb-4 text-destructive' />
          <p className='text-foreground'>{pageError}</p>
        </div>
      </div>
    )
  }
  if (!meta) return <Loading />

  const isNew = contactId === 'new'
  const loaded = contact && !contact.missing && String(contact.id) === String(contactId)
  const panelOpen = !!contactId

  return (
    <div className='p-4 w-full max-w-[1400px] mx-auto flex flex-col gap-4'>
      <Helmet>
        <title>{(loaded && contact.name ? contact.name + ' | ' : '') + t('Contacts')} | Agora</title>
      </Helmet>
      <div className='rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm text-foreground'>
        {t('Everyone in Agora can see this list. It holds the people 7BP works with: team members as well as people outside Agora. Note only what 7BP needs to work together, say where the details came from, and delete anyone who asks to be removed. Every change is logged with who made it.')}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        {VIEWS.map(v => (
          <Button key={v.key} variant={view === v.key ? 'selectedOutline' : 'outline'} size='sm' onClick={() => setView(v.key)} aria-pressed={view === v.key}>
            {t(v.label === 'All' ? 'All contacts' : v.label)}
            {v.key === 'mine' && dueCount > 0 && <span className='ml-1 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground'>{dueCount}</span>}
          </Button>
        ))}
        <Button size='sm' className='ml-auto' onClick={() => keepSearch('/contacts/new')}><Plus /> {t('New contact')}</Button>
      </div>

      {!mine && (
        <div className='grid grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2'>
          <Input className='col-span-2 lg:col-span-1' type='search' value={query} onChange={e => onSearch(e.target.value)} placeholder={t('Search name, organisation or email')} aria-label={t('Search contacts')} />
          <Select value={filters.kind} onChange={kind => setFilters(f => ({ ...f, kind }))} aria-label={t('Kind')}>
            <option value=''>{t('Every kind')}</option>
            {meta.kinds.map(k => <option key={k} value={k}>{labels.kinds[k] || k}</option>)}
          </Select>
          <Select value={filters.status} onChange={status => setFilters(f => ({ ...f, status }))} aria-label={t('Status')}>
            <option value=''>{t('Every status')}</option>
            {meta.statuses.map(s => <option key={s} value={s}>{labels.statuses[s] || s}</option>)}
          </Select>
          <Select value={filters.circle} onChange={circle => setFilters(f => ({ ...f, circle }))} aria-label={t('Circle')}>
            <option value=''>{t('Every circle')}</option>
            {meta.circles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Button variant='outline' size='sm' className='h-10' onClick={() => { setQuery(''); setFilters({ q: '', kind: '', status: '', circle: '' }) }}>{t('Clear')}</Button>
        </div>
      )}

      <div className={cn('grid grid-cols-1 gap-4 items-start', { 'lg:grid-cols-[minmax(0,1fr)_440px]': panelOpen })}>
        <div className={cn('bg-card border border-border rounded-lg overflow-x-auto', { 'max-lg:hidden': panelOpen })}>
          {listError && <p role='alert' className='p-4 text-sm text-destructive'>{listError}</p>}
          {!listError && !shown && <Loading />}
          {shown && shown.length === 0 && (
            <p className='p-4 text-muted-foreground'>{mine ? t('You have no follow-ups.') : t('No contacts found.')}</p>
          )}
          {shown && shown.length > 0 && (
            <ContactsTable contacts={shown} labels={labels} sort={sort} onSort={onSort} selectedId={contactId} canSeeProposed={canSeeProposed} onOpen={id => keepSearch(`/contacts/${id}`)} />
          )}
        </div>

        {panelOpen && (
          <aside className='bg-card border border-border rounded-lg p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto' aria-label={t('Contact')}>
            {contact && contact.missing && <p role='alert' className='text-destructive'>{contact.message}</p>}
            {!isNew && !loaded && !(contact && contact.missing) && <Loading />}
            {isNew && (
              <ContactForm contact={null} meta={meta} labels={labels} onSaved={onSaved} onCancel={() => keepSearch('/contacts')} />
            )}
            {!isNew && loaded && editing && (
              <ContactForm contact={contact} meta={meta} labels={labels} onSaved={onSaved} onCancel={() => setEditing(false)} />
            )}
            {!isNew && loaded && !editing && (
              <ContactPanel
                contact={contact}
                meta={meta}
                labels={labels}
                flash={flash}
                onEdit={() => { setFlash(null); setEditing(true) }}
                onClose={() => keepSearch('/contacts')}
                onChanged={onChanged}
                onDeleted={onDeleted}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
