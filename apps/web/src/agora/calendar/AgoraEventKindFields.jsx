import React from 'react'
import { useTranslation } from 'react-i18next'
import { Users, CalendarDays } from 'lucide-react'
import { cn } from 'util/index'
import { MEETING, EVENT, useCalendarMe } from './api'

/**
 * Agora: in the post editor, for an event post. Chooses between a Meeting
 * (for the team: meeting room and minutes, never public) and an Event (a
 * gathering with a place, may be public). Stewards of the main 7BP circle
 * also see "For all of 7BP" and, when making it, "Also send everyone a
 * calendar invitation by email". The server checks all of this again.
 */
export default function AgoraEventKindFields ({ post, setPost, editing = false, disabled = false }) {
  const { t } = useTranslation()
  const { canMarkForAll } = useCalendarMe()
  const kind = post.agoraKind === EVENT ? EVENT : MEETING

  const choose = value => setPost(prev => ({
    ...prev,
    agoraKind: value,
    // A Meeting is never public
    isPublic: value === MEETING ? false : prev.isPublic
  }))

  const option = (value, Icon, label) => (
    <button
      type='button'
      role='radio'
      aria-checked={kind === value}
      data-testid={`agora-kind-${value}`}
      disabled={disabled}
      onClick={() => choose(value)}
      className={cn(
        'flex items-center gap-1 rounded-md px-3 py-1 text-sm border-2 transition-all',
        kind === value ? 'border-selected bg-selected/20 text-foreground font-bold' : 'border-foreground/20 text-foreground/70 hover:border-foreground/50'
      )}
    >
      <Icon className='w-4 h-4' />
      {label}
    </button>
  )

  return (
    <div className='flex flex-col gap-2 bg-input rounded-md p-2' data-testid='agora-event-kind'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='text-xs text-foreground/50 w-[100px]'>{t('agoraKind.label')}</div>
        <div role='radiogroup' aria-label={t('agoraKind.label')} className='flex gap-2'>
          {option(MEETING, Users, t('Meeting'))}
          {option(EVENT, CalendarDays, t('Event'))}
        </div>
      </div>
      <div className='text-xs text-foreground/60'>
        {kind === MEETING ? t('agoraKind.meetingHelp') : t('agoraKind.eventHelp')}
      </div>
      {canMarkForAll && (
        <label className='flex items-center gap-2 text-sm text-foreground/80'>
          <input
            type='checkbox'
            data-testid='agora-for-all'
            checked={!!post.agoraForAll}
            disabled={disabled}
            onChange={e => {
              const checked = e.target.checked
              setPost(prev => ({ ...prev, agoraForAll: checked, agoraInviteEveryone: checked ? prev.agoraInviteEveryone : false }))
            }}
          />
          {t('agoraKind.forAll')}
        </label>
      )}
      {canMarkForAll && post.agoraForAll && !editing && (
        <label className='flex items-center gap-2 text-sm text-foreground/80 ml-6'>
          <input
            type='checkbox'
            data-testid='agora-invite-everyone'
            checked={!!post.agoraInviteEveryone}
            disabled={disabled}
            onChange={e => {
              const checked = e.target.checked
              setPost(prev => ({ ...prev, agoraInviteEveryone: checked }))
            }}
          />
          {t('agoraKind.inviteEveryone')}
        </label>
      )}
    </div>
  )
}
