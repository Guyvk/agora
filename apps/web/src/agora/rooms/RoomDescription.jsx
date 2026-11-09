import { Pencil } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import { updateSpace } from 'store/actions/groupViews'
import { useCanManageRoom } from './RoomHeaderControls'
import { plainDescription } from './roomNotifications'

const MAX_LENGTH = 200

/**
 * Agora: a short line at the top of a room, under the room name. The room's
 * stewards can change it; it is the room's ordinary description field.
 */
export default function RoomDescription ({ group, className = '' }) {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const canManage = useCanManageRoom(group)
  const current = plainDescription(group?.description)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(current)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (!editing) setDraft(current) }, [current, editing])

  if (!group || group.type !== 'space') return null
  if (!current && !canManage) return null

  const save = async () => {
    setSaving(true)
    try {
      await dispatch(updateSpace({ id: group.id, groupId: group.parentGroup?.id || group.parentId, description: draft.trim() }))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <form
        className={`flex items-center gap-2 px-3 py-1 ${className}`}
        onSubmit={e => { e.preventDefault(); save() }}
      >
        <input
          autoFocus
          type='text'
          maxLength={MAX_LENGTH}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
          placeholder={t('agoraRooms.descriptionPlaceholder')}
          aria-label={t('agoraRooms.description')}
          className='flex-1 min-w-0 text-sm rounded-md bg-input/60 border-none px-2 py-1 text-foreground'
        />
        <button type='submit' disabled={saving} className='text-sm font-semibold bg-transparent border-none cursor-pointer text-selected'>{t('agoraRooms.save')}</button>
        <button type='button' onClick={() => setEditing(false)} className='text-sm bg-transparent border-none cursor-pointer text-foreground/60'>{t('agoraRooms.cancel')}</button>
      </form>
    )
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1 text-sm text-foreground/70 ${className}`}>
      <span className='truncate' title={current}>{current || t('agoraRooms.addDescription')}</span>
      {canManage && (
        <button type='button' onClick={() => setEditing(true)} aria-label={t('agoraRooms.editDescription')} className='shrink-0 p-0.5 bg-transparent border-none cursor-pointer text-foreground/50 hover:text-foreground'>
          <Pencil className='w-3.5 h-3.5' />
        </button>
      )}
    </div>
  )
}
