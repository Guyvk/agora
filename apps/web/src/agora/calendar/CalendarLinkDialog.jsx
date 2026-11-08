/**
 * Agora: the "Add to my calendar" button of the Calendar page, and the popup
 * behind it. The popup holds the private calendar link (an iCalendar feed that
 * Google Calendar, Apple Calendar or Outlook follows by itself): make it, copy
 * it, replace it, switch it off, and how to add it to each calendar app.
 * The server part is apps/backend/lib/agora/calendar.js.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarPlus, Copy } from 'lucide-react'
import Button from 'components/ui/button'
import Loading from 'components/Loading'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from 'components/ui/dialog'
import { calendarApi } from './api'

/** The same link, in the form that opens Apple Calendar's own "subscribe" question. */
export function webcalUrl (url) {
  return String(url || '').replace(/^https?:\/\//i, 'webcal://')
}

function LinkPanel () {
  const { t } = useTranslation()
  const [feed, setFeed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    calendarApi('/feed').then(r => { if (alive) setFeed(r) }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [])

  const run = useCallback(async (path, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      setFeed(await calendarApi(path, {}))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(feed.url)
      setCopied(true)
    } catch (e) {
      setCopied(false)
    }
  }, [feed])

  return (
    <div className='flex flex-col gap-3' data-testid='calendar-subscribe'>
      {error && <p role='alert' className='text-sm text-destructive m-0'>{error}</p>}
      {feed === null && !error && <Loading type='inline' />}
      {feed && !feed.url && (
        <Button variant='secondary' disabled={busy} onClick={() => run('/feed/renew')} data-testid='calendar-make-link'>{t('agoraCalendar.makeLink')}</Button>
      )}
      {feed && feed.url && (
        <>
          <div className='flex flex-col sm:flex-row gap-2'>
            <input
              readOnly
              aria-label={t('agoraCalendar.linkLabel')}
              value={feed.url}
              onFocus={e => e.target.select()}
              className='flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground'
              data-testid='calendar-link'
            />
            <Button variant='secondary' onClick={copy} data-testid='calendar-copy'><Copy className='w-4 h-4 mr-1' />{copied ? t('Copied!') : t('Copy')}</Button>
          </div>
          <Button variant='secondary' asChild data-testid='calendar-open-apple'>
            <a href={webcalUrl(feed.url)}>{t('agoraCalendar.openApple')}</a>
          </Button>
          <p className='text-xs text-foreground/70 m-0'>{t('agoraCalendar.secret')}</p>
          <ul className='text-sm text-foreground/80 list-disc pl-5 m-0 flex flex-col gap-1'>
            <li>{t('agoraCalendar.howApple')}</li>
            <li>{t('agoraCalendar.howGoogle')}</li>
            <li>{t('agoraCalendar.howOutlook')}</li>
          </ul>
          <p className='text-xs text-foreground/70 m-0'>{t('agoraCalendar.refresh')}</p>
          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' size='sm' disabled={busy} onClick={() => run('/feed/renew', t('agoraCalendar.confirmRenew'))} data-testid='calendar-renew'>{t('agoraCalendar.renew')}</Button>
            <Button variant='outline' size='sm' disabled={busy} onClick={() => run('/feed/revoke', t('agoraCalendar.confirmRevoke'))} data-testid='calendar-revoke'>{t('agoraCalendar.revoke')}</Button>
          </div>
        </>
      )}
    </div>
  )
}

/** The button for the calendar's header row. */
export function CalendarLinkButton ({ onClick }) {
  const { t } = useTranslation()
  return (
    <Button
      variant='outline'
      className='rounded-sm h-auto py-2 px-3 gap-2 text-base whitespace-nowrap shadow-sm'
      onClick={onClick}
      data-testid='calendar-add-button'
    >
      <CalendarPlus className='w-4 h-4' />{t('agoraCalendar.addButton')}
    </Button>
  )
}

/** The popup. Closes with Esc, the X and a click outside. */
export default function CalendarLinkDialog ({ open, onOpenChange }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto max-w-[calc(100vw-1rem)] sm:max-w-lg p-4 sm:p-6' data-testid='calendar-dialog'>
        <DialogHeader>
          <DialogTitle>{t('agoraCalendar.subscribeTitle')}</DialogTitle>
          <DialogDescription>{t('agoraCalendar.subscribeIntro')}</DialogDescription>
        </DialogHeader>
        <LinkPanel />
      </DialogContent>
    </Dialog>
  )
}
