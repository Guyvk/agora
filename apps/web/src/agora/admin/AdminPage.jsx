/**
 * Agora: the admin area, for the people who run Agora (AGORA_ADMINS on the
 * server). People in AGORA_HELPDESK_ADMINS only see the Help desk tab. The
 * server checks this for every request, see
 * apps/backend/lib/agora/adminDashboard.js and help.js.
 *
 *   /admin              Overview: the main numbers and the open Help desk requests
 *   /admin/help-desk    the Help desk (src/agora/help/HelpDeskPage.jsx); the old
 *                       /help-desk addresses send people here
 *   /admin/invitations  every circle invitation, join links, join requests
 *   /admin/accounts     everyone with an account, "Let someone in", and each
 *                       person's role (Member, Help desk, Admin), which an
 *                       admin can change after a confirm step on the page
 *   /admin/system       version, services, backups (never a key)
 *   /admin/activity     the latest important events
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Copy, Gauge } from 'lucide-react'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import { formatMoment, helpLabels, HELP_DESK_URL } from '@/agora/help/api'
import { fieldClasses } from '@/agora/help/HelpWindow'
import HelpDeskPage from '@/agora/help/HelpDeskPage'
import { adminApi, adminAccess, formatBytes, ADMIN_URL } from './api'

const TABS = ['overview', 'help-desk', 'invitations', 'accounts', 'system', 'activity']

function tabLabels (t) {
  return { overview: t('Overview'), 'help-desk': t('Help desk'), invitations: t('Invitations'), accounts: t('Accounts'), system: t('System'), activity: t('Activity log') }
}

/* ----------------------------------------------------------------------- */
/* Small parts                                                              */
/* ----------------------------------------------------------------------- */

function Card ({ title, children, className }) {
  return (
    <section className={cn('bg-card border border-border rounded-lg p-4 flex flex-col gap-3', className)}>
      {title && <h2 className='text-base font-semibold text-foreground m-0'>{title}</h2>}
      {children}
    </section>
  )
}

function Stat ({ label, value, note }) {
  return (
    <div className='bg-card border border-border rounded-lg p-4 flex flex-col gap-1'>
      <span className='text-sm text-muted-foreground'>{label}</span>
      <span className='text-2xl font-semibold text-foreground'>{value}</span>
      {note && <span className='text-xs text-muted-foreground'>{note}</span>}
    </div>
  )
}

function Notice ({ children, tone = 'info' }) {
  return (
    <p role='note' className={cn('text-sm rounded-lg px-3 py-2 m-0 border', tone === 'warning' ? 'bg-destructive/10 border-destructive/30 text-foreground' : 'bg-accent/10 border-accent/30 text-foreground')}>
      {children}
    </p>
  )
}

function NoEmailNotice ({ email }) {
  const { t } = useTranslation()
  if (!email || email.sends) return null
  return (
    <Notice tone='warning'>
      {t('Agora cannot send email yet: there is no mailbox, so emails only go into the server log. Copy the link and send it yourself.')}
    </Notice>
  )
}

function useCopy () {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(null)
  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied({ key, ok: true })
    } catch (e) {
      setCopied({ key, ok: false })
    }
  }
  const status = key => copied && copied.key === key
    ? <span role='status' className='text-xs text-muted-foreground'>{copied.ok ? t('Copied') : t('Copying did not work. Select the link and copy it yourself.')}</span>
    : null
  return { copy, status }
}

function Pager ({ page, hasMore, onPage }) {
  const { t } = useTranslation()
  if (page <= 1 && !hasMore) return null
  return (
    <div className='flex items-center gap-2'>
      <Button size='sm' variant='outline' disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('Newer')}</Button>
      <span className='text-sm text-muted-foreground'>{t('Page {{page}}', { page })}</span>
      <Button size='sm' variant='outline' disabled={!hasMore} onClick={() => onPage(page + 1)}>{t('Older')}</Button>
    </div>
  )
}

function useLoad (path) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    try {
      setError(null)
      setData(await adminApi(path))
    } catch (e) {
      setError(e)
    }
  }, [path])
  useEffect(() => { load() }, [load])
  return { data, error, reload: load }
}

function LoadError ({ error }) {
  return <p role='alert' className='text-destructive'>{error.message}</p>
}

const yesNo = (t, value) => value ? t('Yes') : t('No')

/* ----------------------------------------------------------------------- */
/* Overview                                                                 */
/* ----------------------------------------------------------------------- */

function HelpSummary ({ help, open }) {
  const { t } = useTranslation()
  const labels = helpLabels(t)
  if (!help) return null
  return (
    <Card title={t('Help desk: {{count}} open requests', { count: open })} className={open > 0 ? 'border-accent/50' : undefined}>
      <p className='text-sm m-0 flex flex-wrap gap-x-4 gap-y-1'>
        {Object.keys(labels.statuses).map(s => <span key={s}>{labels.statuses[s]}: <strong>{help.byStatus[s] || 0}</strong></span>)}
      </p>
      {help.newest.length > 0 && (
        <ul className='list-none m-0 p-0'>
          {help.newest.map(r => (
            <li key={r.id} className='py-2 border-b border-border last:border-b-0 text-sm flex flex-wrap items-baseline justify-between gap-2'>
              <Link className='font-semibold hover:underline break-words' to={`${HELP_DESK_URL}/${r.id}`}>{r.title}</Link>
              <span className='text-xs text-muted-foreground'>
                {r.from || t('Someone')} · {labels.shortTypes[r.type] || r.type} · {labels.statuses[r.status] || r.status} · {formatMoment(r.createdAt)}
                {r.urgency === 'urgent' && <span className='ml-1 text-destructive font-semibold'>{t('Urgent')}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to={HELP_DESK_URL} className='text-sm underline self-start'>{t('Open the Help desk')}</Link>
    </Card>
  )
}

function Overview () {
  const { t } = useTranslation()
  const { data, error } = useLoad('/overview')
  if (error) return <LoadError error={error} />
  if (!data) return <Loading />
  const m = data.meetings
  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
        <Stat label={t('Members')} value={data.members} note={t('Accounts that are switched on')} />
        <Stat label={t('New in the last 7 days')} value={data.signups.last7} note={t('{{count}} in the last 30 days', { count: data.signups.last30 })} />
        <Stat label={t('Circles')} value={data.circles} />
        <Stat label={t('Active in the last 7 days')} value={data.activeLast7} note={t('People who logged in or used Agora')} />
        <Stat label={t('Invitations waiting')} value={data.pendingInvitations} />
        <Stat label={t('Join requests waiting')} value={data.joinRequests} />
        <Stat label={t('Open Help desk requests')} value={data.helpRequests} />
        <Stat label={t('Meetings this month')} value={m.held} note={t('{{minutes}} minutes turned into text', { minutes: m.transcribedMinutes })} />
      </div>
      <HelpSummary help={data.help} open={data.helpRequests} />
      <Card title={t('Speech to text this month')}>
        <p className='text-sm m-0'>
          {t('{{minutes}} minutes of meeting sound were sent to speech to text. At {{price}} per minute that is about {{cost}}.', { minutes: m.transcribedMinutes, price: m.pricePerMinute, cost: m.estimatedCost.toFixed(2) })}
        </p>
        <p className='text-xs text-muted-foreground m-0'>{t('This is an estimate. The real bill comes from Infomaniak.')}</p>
      </Card>
      <NoEmailNotice email={data.email} />
    </div>
  )
}

/* ----------------------------------------------------------------------- */
/* Invitations                                                              */
/* ----------------------------------------------------------------------- */

function invitationStatusLabels (t) {
  return { waiting: t('Waiting'), accepted: t('Accepted'), revoked: t('Expired or withdrawn') }
}

function InvitationRow ({ invitation: i, onChanged, copy, copyStatus, email }) {
  const { t } = useTranslation()
  const labels = invitationStatusLabels(t)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const act = async (what) => {
    if (what === 'revoke' && !window.confirm(t('Withdraw the invitation of {{email}}? Its link stops working.', { email: i.email }))) return
    setBusy(true)
    setMessage(null)
    try {
      await adminApi(`/invitations/${encodeURIComponent(i.id)}/${what}`, {})
      setMessage(what === 'resend'
        ? (email && email.sends ? t('Sent again.') : t('Marked as sent again, but no email went out: Agora has no mailbox yet. Copy the link and send it yourself.'))
        : t('Withdrawn.'))
      onChanged()
    } catch (e) {
      setMessage(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className='py-3 border-b border-border last:border-b-0 flex flex-col gap-1'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <span className='font-semibold text-foreground break-all'>{i.email}</span>
        <span className='rounded-full border border-foreground/20 px-2 py-0.5 text-xs'>{labels[i.status]}</span>
      </div>
      <p className='text-sm text-muted-foreground m-0'>
        {t('To {{circle}}', { circle: i.circle.name })}{i.circle.deleted ? ` (${t('circle deleted')})` : ''}
        {i.invitedBy ? ` · ${t('invited by {{name}}', { name: i.invitedBy.name })}` : ''}
        {` · ${t('made {{when}}', { when: formatMoment(i.createdAt) })}`}
        {` · ${i.sentCount === 0 ? t('never sent') : t('sent {{count}} times, last {{when}}', { count: i.sentCount, when: formatMoment(i.lastSentAt) })}`}
      </p>
      {i.status === 'accepted' && <p className='text-sm m-0'>{t('Accepted by {{name}} on {{when}}', { name: (i.usedBy && i.usedBy.name) || t('someone'), when: formatMoment(i.usedAt) })}</p>}
      {i.status === 'revoked' && i.revokedAt && <p className='text-sm m-0'>{t('Withdrawn by {{name}} on {{when}}', { name: (i.revokedBy && i.revokedBy.name) || t('someone'), when: formatMoment(i.revokedAt) })}</p>}
      {i.status === 'waiting' && (
        <div className='flex flex-wrap items-center gap-2'>
          <Button size='sm' variant='outline' onClick={() => copy(i.link, 'inv' + i.id)}><Copy /> {t('Copy invitation link')}</Button>
          <Button size='sm' variant='outline' disabled={busy} onClick={() => act('resend')}>{t('Send again')}</Button>
          <Button size='sm' variant='outline' disabled={busy} onClick={() => act('revoke')}>{t('Withdraw')}</Button>
          {copyStatus('inv' + i.id)}
        </div>
      )}
      {message && <p role='status' className='text-sm m-0'>{message}</p>}
    </li>
  )
}

function Invitations () {
  const { t } = useTranslation()
  const labels = invitationStatusLabels(t)
  const [filters, setFilters] = useState({ status: '', circle: '', page: 1 })
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.circle) params.set('circle', filters.circle)
  if (filters.page > 1) params.set('page', String(filters.page))
  const { data, error, reload } = useLoad('/invitations' + (params.toString() ? '?' + params : ''))
  const joins = useLoad('/joins')
  const { copy, status } = useCopy()

  if (error) return <LoadError error={error} />
  if (!data) return <Loading />
  return (
    <div className='flex flex-col gap-4'>
      <NoEmailNotice email={data.email} />
      <Card title={t('Circle invitations')}>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-[600px]'>
          <select aria-label={t('Status')} className={cn(fieldClasses, 'h-10')} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}>
            <option value=''>{t('Every status')}</option>
            {Object.keys(labels).map(s => <option key={s} value={s}>{labels[s]}</option>)}
          </select>
          <select aria-label={t('Circle')} className={cn(fieldClasses, 'h-10')} value={filters.circle} onChange={e => setFilters(f => ({ ...f, circle: e.target.value, page: 1 }))}>
            <option value=''>{t('Every circle')}</option>
            {data.circles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <p className='text-sm text-muted-foreground m-0'>{t('{{count}} invitations', { count: data.total })}</p>
        {data.invitations.length === 0
          ? <p className='text-muted-foreground m-0'>{t('No invitations.')}</p>
          : (
            <ul className='list-none m-0 p-0'>
              {data.invitations.map(i => <InvitationRow key={i.id} invitation={i} onChanged={reload} copy={copy} copyStatus={status} email={data.email} />)}
            </ul>
            )}
        <Pager page={data.page} hasMore={data.page * data.pageSize < data.total} onPage={page => setFilters(f => ({ ...f, page }))} />
      </Card>

      <Card title={t('Join links')}>
        <p className='text-sm text-muted-foreground m-0'>
          {t('Anyone with a circle\'s join link can make an account and join. Agora does not record who used the link, so this shows how many members joined without an email invitation: through the join link, a join request, or added by a steward.')}
        </p>
        {joins.error && <LoadError error={joins.error} />}
        {!joins.data && !joins.error && <Loading />}
        {joins.data && (
          <ul className='list-none m-0 p-0'>
            {joins.data.circles.map(c => (
              <li key={c.id} className='py-2 border-b border-border last:border-b-0 flex flex-wrap items-center justify-between gap-2'>
                <span>
                  <span className='font-semibold'>{c.name}</span>
                  <span className='block text-sm text-muted-foreground'>{t('{{members}} members, {{without}} joined without an email invitation', { members: c.members, without: c.joinedWithoutInvitation })}</span>
                </span>
                <span className='flex items-center gap-2'>
                  {c.joinLink
                    ? <Button size='sm' variant='outline' onClick={() => copy(c.joinLink, 'join' + c.id)}><Copy /> {t('Copy join link')}</Button>
                    : <span className='text-sm text-muted-foreground'>{t('No join link')}</span>}
                  {status('join' + c.id)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('Join requests waiting')}>
        {joins.data && joins.data.joinRequests.length === 0 && <p className='text-muted-foreground m-0'>{t('No join requests are waiting.')}</p>}
        {joins.data && joins.data.joinRequests.length > 0 && (
          <ul className='list-none m-0 p-0'>
            {joins.data.joinRequests.map(r => (
              <li key={r.id} className='py-2 border-b border-border last:border-b-0 text-sm'>
                {t('{{name}} asked to join {{circle}} on {{when}}', { name: (r.person && r.person.name) || t('Someone'), circle: r.circle.name, when: formatMoment(r.createdAt) })}
                {' '}<Link className='underline' to={`/groups/${r.circle.slug}/settings/requests`}>{t('Answer in the circle\'s settings')}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

/* ----------------------------------------------------------------------- */
/* Accounts                                                                 */
/* ----------------------------------------------------------------------- */

function accountStateLabels (t) {
  return { active: t('Active'), deactivated: t('Switched off'), unfinished: t('Sign-up not finished') }
}

function LetIn ({ circles, onDone }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [circle, setCircle] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const { copy, status } = useCopy()

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await adminApi('/accounts/let-in', { email, circle: circle || undefined }))
      setEmail('')
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('Let someone in')}>
      <p className='text-sm text-muted-foreground m-0'>
        {t('Agora is by invitation. Give an email address and, if you like, a circle. With a circle, Agora makes an invitation to that circle; its link lets them make an account and join. Without a circle, Agora makes a sign-up link that works for 4 hours.')}
      </p>
      <form onSubmit={submit} className='grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end'>
        <div className='flex flex-col gap-1'>
          <Label htmlFor='agora-admin-letin-email' className='text-muted-foreground'>{t('Email address')}</Label>
          <Input id='agora-admin-letin-email' type='email' required value={email} onChange={e => setEmail(e.target.value)} placeholder='name@example.org' />
        </div>
        <div className='flex flex-col gap-1'>
          <Label htmlFor='agora-admin-letin-circle' className='text-muted-foreground'>{t('Circle (optional)')}</Label>
          <select id='agora-admin-letin-circle' className={cn(fieldClasses, 'h-10')} value={circle} onChange={e => setCircle(e.target.value)}>
            <option value=''>{t('No circle, only an account')}</option>
            {circles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Button type='submit' disabled={busy || !email.trim()}>{t('Make the link')}</Button>
      </form>
      {error && <p role='alert' className='text-sm text-destructive m-0'>{error}</p>}
      {result && result.kind === 'has_account' && (
        <p role='status' className='text-sm m-0'>{t('{{email}} already has an account. They can log in, or choose "Forgot password" on the login page.', { email: result.email })}</p>
      )}
      {result && result.link && (
        <div role='status' className='flex flex-col gap-2'>
          <p className='text-sm m-0'>
            {result.kind === 'invitation'
              ? t('Invitation to {{circle}} made for {{email}}. This is their link:', { circle: result.circle.name, email: result.email })
              : t('{{email}} may now make an account. This link works for 4 hours:', { email: result.email })}
          </p>
          <code className='block text-xs break-all bg-foreground/5 rounded px-2 py-1'>{result.link}</code>
          <div className='flex items-center gap-2'>
            <Button size='sm' variant='outline' onClick={() => copy(result.link, 'letin')}><Copy /> {t('Copy link')}</Button>
            {status('letin')}
          </div>
          {result.emailStatus && !result.emailStatus.sends
            ? <Notice tone='warning'>{t('Send it yourself: Agora cannot email yet.')}</Notice>
            : <p className='text-xs text-muted-foreground m-0'>{t('Agora also emails it to them.')}</p>}
          {result.kind === 'signup' && <p className='text-xs text-muted-foreground m-0'>{t('Keep the link private: whoever opens it can make the account for this address.')}</p>}
        </div>
      )}
    </Card>
  )
}

function roleLabels (t) {
  return { member: t('Member'), helpdesk: t('Help desk'), admin: t('Admin') }
}

function roleQuestion (t, role, name) {
  if (role === 'admin') return t('Make {{name}} an admin? Admins can open the whole admin area: every account, the invitations and the Help desk. They can also switch accounts off and change roles.', { name })
  if (role === 'helpdesk') return t('Let {{name}} run the Help desk? They can read and answer every Help request, but nothing else in the admin area.', { name })
  return t('Take away the role of {{name}}? They become a member and can no longer open the admin area.', { name })
}

/**
 * The role of one account: Member, Help desk or Admin. A change is asked
 * again on the page itself before it is sent; the server checks the rules too.
 * Roles from the server settings, and your own role, cannot be changed here.
 */
export function RoleControl ({ account: a, onChanged }) {
  const { t } = useTranslation()
  const labels = roleLabels(t)
  const [choice, setChoice] = useState(a.role)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { setChoice(a.role) }, [a.role])
  const name = a.name || a.email
  const selectId = `agora-admin-role-${a.id}`

  if (a.roleSetOnServer) {
    return (
      <span className='text-sm'>
        {t('Role')}: <strong>{a.role === 'admin' ? t('Admin (set on the server)') : t('Help desk (set on the server)')}</strong>
      </span>
    )
  }
  if (a.isMe) {
    return <span className='text-sm'>{t('Role')}: <strong>{labels[a.role]}</strong> <span className='text-muted-foreground'>{t('(you cannot change your own role)')}</span></span>
  }
  // Only an account that is on can get a role; a switched off account can only lose one
  const choices = a.state === 'active' ? ['member', 'helpdesk', 'admin'] : [...new Set([a.role, 'member'])]
  if (choices.length === 1) return <span className='text-sm'>{t('Role')}: <strong>{labels[a.role]}</strong></span>

  const asking = choice !== a.role
  const confirm = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await adminApi(`/accounts/${encodeURIComponent(a.id)}/role`, { role: choice })
      setMessage(t('Done: {{name}} is now {{role}}.', { name, role: labels[result.role] || labels[choice] }))
      onChanged()
    } catch (e) {
      setError(e.message)
      setChoice(a.role)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <Label htmlFor={selectId} className='text-sm text-muted-foreground'>{t('Role')}</Label>
        <select id={selectId} className={cn(fieldClasses, 'h-9 w-auto')} value={choice} disabled={busy} onChange={e => { setChoice(e.target.value); setMessage(null); setError(null) }}>
          {choices.map(r => <option key={r} value={r}>{labels[r]}</option>)}
        </select>
      </div>
      {asking && (
        <div role='group' aria-label={t('Confirm the new role')} className='flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3'>
          <p className='text-sm m-0'>{roleQuestion(t, choice, name)}</p>
          <div className='flex flex-wrap gap-2'>
            <Button size='sm' disabled={busy} onClick={confirm}>{t('Yes, make it {{role}}', { role: labels[choice] })}</Button>
            <Button size='sm' variant='outline' disabled={busy} onClick={() => setChoice(a.role)}>{t('Cancel')}</Button>
          </div>
        </div>
      )}
      {message && <p role='status' className='text-sm m-0'>{message}</p>}
      {error && <p role='alert' className='text-sm text-destructive m-0'>{error}</p>}
    </div>
  )
}

function AccountRow ({ account: a, onChanged }) {
  const { t } = useTranslation()
  const labels = accountStateLabels(t)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const act = async (what) => {
    const question = what === 'deactivate'
      ? t('Switch off the account of {{name}}? They are logged out and cannot log in until it is switched on again. Nothing is deleted.', { name: a.name || a.email })
      : t('Switch the account of {{name}} on again?', { name: a.name || a.email })
    if (!window.confirm(question)) return
    setBusy(true)
    setMessage(null)
    try {
      await adminApi(`/accounts/${encodeURIComponent(a.id)}/${what}`, {})
      onChanged()
    } catch (e) {
      setMessage(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className='py-3 border-b border-border last:border-b-0 flex flex-col gap-1'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <span className='font-semibold text-foreground'>
          {a.name ? <Link className='hover:underline' to={`/members/${a.id}`}>{a.name}</Link> : <span className='text-muted-foreground'>{t('(no name yet)')}</span>}
          {a.role === 'admin' && <span className='ml-2 text-xs rounded-full border border-accent/40 px-2 py-0.5'>{t('Agora admin')}</span>}
          {a.role === 'helpdesk' && <span className='ml-2 text-xs rounded-full border border-accent/40 px-2 py-0.5'>{t('Help desk')}</span>}
        </span>
        <span className={cn('rounded-full border px-2 py-0.5 text-xs', a.state === 'active' ? 'border-foreground/20' : 'border-destructive/40')}>{labels[a.state]}</span>
      </div>
      <p className='text-sm m-0 break-all'>{a.email}{a.emailConfirmed ? '' : ` (${t('email not confirmed')})`}</p>
      <p className='text-sm text-muted-foreground m-0'>
        {t('Joined {{when}}', { when: formatMoment(a.joinedAt) || '-' })}
        {` · ${a.lastActiveAt ? t('last active {{when}}', { when: formatMoment(a.lastActiveAt) }) : t('never active')}`}
        {` · ${a.circles.length ? a.circles.map(c => c.name).join(', ') : t('in no circle')}`}
      </p>
      <div className='flex flex-wrap items-center gap-2'>
        {a.state === 'active' && !a.isMe && <Button size='sm' variant='outline' disabled={busy} onClick={() => act('deactivate')}>{t('Switch off')}</Button>}
        {a.state === 'deactivated' && <Button size='sm' variant='outline' disabled={busy} onClick={() => act('reactivate')}>{t('Switch on again')}</Button>}
        {message && <span role='alert' className='text-sm text-destructive'>{message}</span>}
      </div>
      <RoleControl account={a} onChanged={onChanged} />
    </li>
  )
}

function Accounts () {
  const { t } = useTranslation()
  const labels = accountStateLabels(t)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ search: '', state: '', page: 1 })
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.state) params.set('state', filters.state)
  if (filters.page > 1) params.set('page', String(filters.page))
  const { data, error, reload } = useLoad('/accounts' + (params.toString() ? '?' + params : ''))

  if (error) return <LoadError error={error} />
  if (!data) return <Loading />
  return (
    <div className='flex flex-col gap-4'>
      <LetIn circles={data.circles} onDone={reload} />
      <Card title={t('People')}>
        <form className='grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 max-w-[700px]' onSubmit={e => { e.preventDefault(); setFilters(f => ({ ...f, search: search.trim(), page: 1 })) }}>
          <Input aria-label={t('Search by name or email')} placeholder={t('Search by name or email')} value={search} onChange={e => setSearch(e.target.value)} />
          <select aria-label={t('Which accounts')} className={cn(fieldClasses, 'h-10')} value={filters.state} onChange={e => setFilters(f => ({ ...f, state: e.target.value, page: 1 }))}>
            <option value=''>{t('Every account')}</option>
            {Object.keys(labels).map(s => <option key={s} value={s}>{labels[s]}</option>)}
          </select>
          <Button type='submit' variant='outline'>{t('Search')}</Button>
        </form>
        <p className='text-sm text-muted-foreground m-0'>{t('{{count}} accounts', { count: data.total })}</p>
        <ul className='list-none m-0 p-0'>
          {data.accounts.map(a => <AccountRow key={a.id} account={a} onChanged={reload} />)}
        </ul>
        <Pager page={data.page} hasMore={data.page * data.pageSize < data.total} onPage={page => setFilters(f => ({ ...f, page }))} />
      </Card>
    </div>
  )
}

/* ----------------------------------------------------------------------- */
/* System                                                                   */
/* ----------------------------------------------------------------------- */

function duration (t, seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return t('{{days}} days, {{hours}} hours', { days, hours })
  if (hours > 0) return t('{{hours}} hours, {{minutes}} minutes', { hours, minutes })
  return t('{{minutes}} minutes', { minutes })
}

function emailLabel (t, email) {
  if (!email) return '-'
  if (email.transport === 'log') return t('Not sent: emails only go into the server log')
  const name = { sendwithus: 'SendWithUs', brevo: 'Brevo', smtp: t('a mail server (SMTP)') }[email.transport] || t('unknown setting')
  return email.sends ? t('Sent through {{name}}', { name }) : t('Set to {{name}}, but not complete, so nothing is sent', { name })
}

function System () {
  const { t } = useTranslation()
  const { data, error } = useLoad('/system')
  if (error) return <LoadError error={error} />
  if (!data) return <Loading />
  const s = data.services
  const check = t('check on the server')
  const rows = [
    [t('Speech to text (meeting notes)'), yesNo(t, s.speechToText)],
    [t('Claude (summaries and the Help chat)'), yesNo(t, s.claude)],
    [t('Email'), emailLabel(t, s.email)],
    [t('Google Drive'), s.googleDrive ? (s.driveUploads ? t('Yes, members may add files') : t('Yes, read only')) : t('No')],
    [t('Video calls (AGORA_MEET_DOMAIN)'), s.meetDomain || t('Not set')],
    [t('Sign-up by invitation only'), yesNo(t, s.inviteOnly)]
  ]
  const b = data.backups
  return (
    <div className='flex flex-col gap-4'>
      <Card title={t('Agora itself')}>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm m-0'>
          <dt className='text-muted-foreground'>{t('Version')}</dt><dd className='m-0'>{data.version || '-'}</dd>
          <dt className='text-muted-foreground'>{t('Address')}</dt><dd className='m-0 break-all'>{data.address}</dd>
          <dt className='text-muted-foreground'>{t('Running since the last restart')}</dt><dd className='m-0'>{duration(t, data.serverUptimeSeconds)}</dd>
          <dt className='text-muted-foreground'>{t('Computer running for')}</dt><dd className='m-0'>{duration(t, data.machineUptimeSeconds)}</dd>
          <dt className='text-muted-foreground'>{t('Disk')}</dt>
          <dd className='m-0'>{data.disk ? t('{{used}}% used, {{free}} free of {{total}}', { used: data.disk.usedPercent, free: formatBytes(data.disk.freeBytes), total: formatBytes(data.disk.totalBytes) }) : check}</dd>
          <dt className='text-muted-foreground'>{t('Memory')}</dt><dd className='m-0'>{t('{{free}} free of {{total}}', { free: formatBytes(data.memory.freeBytes), total: formatBytes(data.memory.totalBytes) })}</dd>
          <dt className='text-muted-foreground'>{t('Database')}</dt><dd className='m-0'>{data.databaseBytes ? formatBytes(data.databaseBytes) : '-'}</dd>
          <dt className='text-muted-foreground'>Node</dt><dd className='m-0'>{data.node}</dd>
        </dl>
      </Card>
      <Card title={t('Connected services')}>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm m-0'>
          {rows.map(([label, value]) => <React.Fragment key={label}><dt className='text-muted-foreground'>{label}</dt><dd className='m-0 break-words'>{value}</dd></React.Fragment>)}
        </dl>
        <p className='text-xs text-muted-foreground m-0'>{t('Keys and passwords are never shown here.')}</p>
      </Card>
      <Card title={t('Backups')}>
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm m-0'>
          <dt className='text-muted-foreground'>{t('Last nightly backup')}</dt>
          <dd className='m-0'>{b.nightly ? (b.nightly.lastAt ? formatMoment(b.nightly.lastAt) : t('None yet')) : check}</dd>
          <dt className='text-muted-foreground'>{t('Copy away from the server')}</dt>
          <dd className='m-0'>{b.offsite.configured === true ? t('Set up') : b.offsite.configured === false ? t('Not set up') : check}</dd>
          <dt className='text-muted-foreground'>{t('Last copy away from the server')}</dt>
          <dd className='m-0'>{b.offsite.lastAt ? formatMoment(b.offsite.lastAt) : check}</dd>
        </dl>
      </Card>
    </div>
  )
}

/* ----------------------------------------------------------------------- */
/* Activity                                                                 */
/* ----------------------------------------------------------------------- */

function eventText (t, e) {
  const person = (e.person && e.person.name) || t('Someone')
  const circle = e.circle ? e.circle.name : t('a circle')
  const email = e.detail || ''
  switch (e.kind) {
    case 'signup': return t('{{person}} made an account', { person })
    case 'invited': return t('{{person}} invited {{email}} to {{circle}}', { person, email, circle })
    case 'invitation_accepted': return t('{{person}} accepted the invitation to {{circle}}', { person, circle })
    case 'invitation_revoked': return t('{{person}} withdrew the invitation of {{email}} to {{circle}}', { person, email, circle })
    case 'circle_created': return t('{{person}} made the circle {{circle}}', { person, circle })
    case 'joined': return t('{{person}} joined {{circle}}', { person, circle })
    case 'left': return t('{{person}} left {{circle}} or was removed', { person, circle })
    case 'join_request': return t('{{person}} asked to join {{circle}}', { person, circle })
    case 'meeting_ended': return t('The meeting "{{title}}" ended', { title: (e.meeting && e.meeting.title) || t('without a name') })
    case 'help_request': return t('{{person}} asked the Help desk: {{title}}', { person, title: e.detail || '' })
    case 'role_changed': {
      const roles = roleLabels(t)
      const role = e.role || {}
      return t('{{person}} changed the role of {{target}} from {{from}} to {{to}}', { person, target: (e.target && e.target.name) || t('someone'), from: roles[role.from] || role.from, to: roles[role.to] || role.to })
    }
    default: return e.kind
  }
}

function ActivityLog () {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const { data, error } = useLoad('/activity' + (page > 1 ? `?page=${page}` : ''))
  if (error) return <LoadError error={error} />
  if (!data) return <Loading />
  return (
    <Card title={t('Latest events')}>
      {data.events.length === 0 && <p className='text-muted-foreground m-0'>{t('Nothing has happened yet.')}</p>}
      <ul className='list-none m-0 p-0'>
        {data.events.map((e, i) => (
          <li key={i} className='py-2 border-b border-border last:border-b-0 flex flex-col sm:flex-row sm:gap-4'>
            <span className='text-xs text-muted-foreground shrink-0 sm:w-40'>{formatMoment(e.at)}</span>
            <span className='text-sm break-words'>{eventText(t, e)}</span>
          </li>
        ))}
      </ul>
      <Pager page={data.page} hasMore={data.hasMore} onPage={setPage} />
    </Card>
  )
}

/* ----------------------------------------------------------------------- */

/** The old Help desk addresses (/help-desk, /help-desk/<id>) send people to the Help desk tab. */
export function OldHelpDeskAddress () {
  const { requestId } = useParams()
  return <Navigate to={requestId ? `${HELP_DESK_URL}/${encodeURIComponent(requestId)}` : HELP_DESK_URL} replace />
}

/** tab: set by the route for /admin/help-desk; otherwise the :tab of the address. */
export default function AdminPage ({ tab: fixedTab }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { tab: rawTab } = useParams()
  const wanted = fixedTab || rawTab
  const labels = tabLabels(t)
  const [access, setAccess] = useState(null)

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Admin'), icon: <Gauge /> })
  }, [setHeaderDetails, t])

  useEffect(() => {
    let alive = true
    adminAccess().then(value => { if (alive) setAccess(value) })
    return () => { alive = false }
  }, [])

  if (access === null) return <Loading />
  if (!access.isAdmin && !access.helpDesk) {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <div className='text-center py-12 bg-destructive/10 rounded-lg border border-destructive/20'>
          <p className='text-foreground'>{t('This page does not exist.')}</p>
        </div>
      </div>
    )
  }

  // Help desk admins who are not Agora admins only see the Help desk tab
  const tabs = access.isAdmin ? TABS : ['help-desk']
  if (!access.isAdmin && wanted !== 'help-desk') return <Navigate to={HELP_DESK_URL} replace />
  const tab = tabs.includes(wanted) ? wanted : 'overview'
  const urlOf = name => name === 'overview' ? ADMIN_URL : name === 'help-desk' ? HELP_DESK_URL : `${ADMIN_URL}/${name}`

  return (
    <div className='p-4 w-full max-w-[1200px] mx-auto flex flex-col gap-4'>
      <Helmet><title>{labels[tab]} | {t('Admin')} | Agora</title></Helmet>
      <nav aria-label={t('Admin')} className='flex flex-wrap items-center gap-2'>
        {tabs.map(name => (
          <Button
            key={name}
            size='sm'
            variant={name === tab ? 'default' : 'outline'}
            aria-current={name === tab ? 'page' : undefined}
            onClick={() => navigate(urlOf(name))}
          >
            {labels[name]}
          </Button>
        ))}
      </nav>
      {tab === 'overview' && <Overview />}
      {tab === 'help-desk' && <HelpDeskPage embedded />}
      {tab === 'invitations' && <Invitations />}
      {tab === 'accounts' && <Accounts />}
      {tab === 'system' && <System />}
      {tab === 'activity' && <ActivityLog />}
    </div>
  )
}
