import { Archive, Bell, BellOff, AtSign } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { Popover, PopoverContent, PopoverTrigger } from 'components/ui/popover'
import { updateMembershipSettings } from 'routes/UserSettings/UserSettings.store'
import { archiveSpace } from 'store/actions/groupViews'
import fetchGroupViews from 'store/actions/fetchGroupViews'
import getMyMemberships from 'store/selectors/getMyMemberships'
import hasResponsibilityForGroup from 'store/selectors/hasResponsibilityForGroup'
import { RESP_ADMINISTRATION } from 'store/constants'
import { isSpaceGroup } from 'store/selectors/getMyGroups'
import { cn } from 'util/index'
import { ROOM_NOTIFICATION_CHOICES, roomNotificationChoice } from './roomNotifications'

const ICONS = { all: Bell, important: AtSign, none: BellOff }

/** Whether the current user may change this room: its maker, or a steward of the circle. */
export function useCanManageRoom (group) {
  const isCircleSteward = useSelector(state => hasResponsibilityForGroup(state, { responsibility: RESP_ADMINISTRATION, groupId: group?.id }))
  return Boolean(isSpaceGroup(group) && (group?.agoraIAmRoomSteward || isCircleSteward))
}

/**
 * Agora: the bell in the room header. One choice per member per room:
 * All messages, Mentions only or Muted. Stewards of a room also get Archive here.
 */
export default function RoomHeaderControls ({ group }) {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const memberships = useSelector(getMyMemberships)
  const membership = useMemo(() => memberships.find(m => m.group?.id === group?.id), [memberships, group?.id])
  const canManage = useCanManageRoom(group)
  const [open, setOpen] = useState(false)

  if (!membership) return null
  const choice = roomNotificationChoice(membership)
  const Icon = ICONS[choice]

  const choose = value => dispatch(updateMembershipSettings(group.id, { postNotifications: value }))

  const archive = async () => {
    if (!window.confirm(t('agoraRooms.archiveConfirm'))) return
    await dispatch(archiveSpace(group.id))
    const parentId = group.parentGroup?.id || group.parentId
    if (parentId) await dispatch(fetchGroupViews(parentId))
    setOpen(false)
    navigate('/')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type='button'
        aria-label={t('agoraRooms.notifications')}
        title={t(ROOM_NOTIFICATION_CHOICES.find(c => c.value === choice).labelKey)}
        className='inline-flex items-center justify-center p-1 leading-none bg-transparent border-none cursor-pointer text-foreground/70 hover:text-foreground'
      >
        <Icon className='w-5 h-5' />
      </PopoverTrigger>
      <PopoverContent align='end' className='w-72'>
        <h3 className='text-base font-bold mb-2'>{t('agoraRooms.notifications')}</h3>
        <div role='radiogroup' className='flex flex-col gap-1'>
          {ROOM_NOTIFICATION_CHOICES.map(option => {
            const OptionIcon = ICONS[option.value]
            const selected = option.value === choice
            return (
              <button
                key={option.value}
                type='button'
                role='radio'
                aria-checked={selected}
                onClick={() => choose(option.value)}
                className={cn('flex items-start gap-2 text-left rounded-md p-2 border-2 border-transparent bg-transparent cursor-pointer text-foreground', { 'border-selected bg-selected/10': selected })}
              >
                <OptionIcon className='w-4 h-4 mt-0.5 shrink-0' />
                <span>
                  <span className='block font-semibold text-sm'>{t(option.labelKey)}</span>
                  <span className='block text-xs text-foreground/60'>{t(option.helpKey)}</span>
                </span>
              </button>
            )
          })}
        </div>
        {canManage && group.status !== 'archived' && (
          <button
            type='button'
            onClick={archive}
            className='mt-3 flex items-center gap-2 w-full text-left rounded-md p-2 bg-transparent border-none cursor-pointer text-foreground/70 hover:text-foreground text-sm'
          >
            <Archive className='w-4 h-4' />
            {t('agoraRooms.archive')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
