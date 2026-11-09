import { DoorOpen, Lock } from 'lucide-react'
import React, { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import { spaceHomeUrl } from '@hylo/navigation'
import { createSpace } from 'store/actions/groupViews'
import fetchForCurrentUser from 'store/actions/fetchForCurrentUser'
import fetchGroupViews from 'store/actions/fetchGroupViews'
import { GROUP_ACCESSIBILITY, GROUP_VISIBILITY } from 'store/models/Group'
import { cn } from 'util/index'

// The two choices of a member-made room. Same values as the 'open' and 'invite'
// presets in routes/AuthLayoutRouter/components/ContextMenu/spaceFormConstants.js
export const ROOM_CHOICES = [
  { value: 'open', icon: DoorOpen, labelKey: 'agoraRooms.open', helpKey: 'agoraRooms.openHelp', visibility: GROUP_VISIBILITY.Public, accessibility: GROUP_ACCESSIBILITY.Open },
  { value: 'private', icon: Lock, labelKey: 'agoraRooms.private', helpKey: 'agoraRooms.privateHelp', visibility: GROUP_VISIBILITY.Hidden, accessibility: GROUP_ACCESSIBILITY.Closed }
]

/**
 * Agora: the simple dialog for a member who makes a room in their circle:
 * a name, a short description, and open or private. It opens on top of the
 * current page, so the menu and top bar stay.
 */
export default function AddRoomDialog ({ group, onClose }) {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [access, setAccess] = useState('open')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(async (e) => {
    e?.preventDefault()
    if (!name.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const choice = ROOM_CHOICES.find(c => c.value === access)
      const result = await dispatch(createSpace({
        parentGroupId: group.id,
        name: name.trim(),
        description: description.trim() || null,
        icon: 'MessageCircleMore',
        acceptedPostTypes: [],
        viewTypes: ['chat'],
        visibility: choice.visibility,
        accessibility: choice.accessibility
      }))
      const room = result?.payload?.data?.createSpace
      if (!room?.id) {
        setError(t('agoraRooms.createFailed'))
        return
      }
      await Promise.all([
        dispatch(fetchGroupViews(group.id)),
        dispatch(fetchGroupViews(room.id)),
        dispatch(fetchForCurrentUser())
      ])
      onClose()
      navigate(spaceHomeUrl(group.slug, room))
    } catch (err) {
      setError(t('agoraRooms.createFailed'))
    } finally {
      setCreating(false)
    }
  }, [name, description, access, creating, dispatch, group, navigate, onClose, t])

  return createPortal(
    <div
      className='fixed inset-0 z-[1100] flex items-center justify-center bg-darkening/50 pointer-events-auto'
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form onSubmit={submit} className='bg-midground rounded-lg shadow-lg p-4 w-full max-w-md max-h-[85vh] overflow-y-auto flex flex-col gap-3'>
        <h2 className='text-lg font-semibold m-0'>{t('agoraRooms.createTitle', { name: group?.name })}</h2>
        <label className='flex flex-col gap-1 text-sm font-semibold'>
          {t('agoraRooms.name')}
          <Input autoFocus value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        </label>
        <label className='flex flex-col gap-1 text-sm font-semibold'>
          {t('agoraRooms.description')}
          <Input value={description} maxLength={200} placeholder={t('agoraRooms.descriptionPlaceholder')} onChange={e => setDescription(e.target.value)} />
        </label>
        <div role='radiogroup' className='flex flex-col gap-2'>
          {ROOM_CHOICES.map(option => {
            const OptionIcon = option.icon
            const selected = option.value === access
            return (
              <button
                key={option.value}
                type='button'
                role='radio'
                aria-checked={selected}
                onClick={() => setAccess(option.value)}
                className={cn('flex items-start gap-3 text-left rounded-md p-3 border-2 border-transparent bg-background/40 cursor-pointer text-foreground', { 'border-selected': selected })}
              >
                <OptionIcon className='w-5 h-5 mt-0.5 shrink-0' />
                <span>
                  <span className='block font-semibold'>{t(option.labelKey)}</span>
                  <span className='block text-sm text-foreground/60'>{t(option.helpKey)}</span>
                </span>
              </button>
            )
          })}
        </div>
        {error && <p role='alert' className='text-sm text-destructive m-0'>{error}</p>}
        <div className='flex justify-end gap-2'>
          <Button type='button' variant='secondary' onClick={onClose}>{t('agoraRooms.cancel')}</Button>
          <Button type='submit' disabled={!name.trim() || creating}>{creating ? t('agoraRooms.creating') : t('agoraRooms.create')}</Button>
        </div>
      </form>
    </div>,
    document.body
  )
}
