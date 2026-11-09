import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import fetchGroupViews from 'store/actions/fetchGroupViews'
import { ADD_PEOPLE_MUTATION, PEOPLE_TO_ADD_QUERY, roomPeopleApi } from '@/agora/rooms/roomPeopleApi'

/**
 * Agora: the room's maker picks people from the room's circle to add to the room.
 * Opens on top of the current page, so the menu and top bar stay.
 */
export default function AddRoomPeopleDialog ({ room, onClose }) {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const [people, setPeople] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    roomPeopleApi(PEOPLE_TO_ADD_QUERY, { roomId: room.id })
      .then(data => { if (!cancelled) setPeople(data.agoraRoomPeopleToAdd || []) })
      .catch(err => { if (!cancelled) { setPeople([]); setError(err.message) } })
    return () => { cancelled = true }
  }, [room.id])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (people || []).filter(p => !q || (p.name || '').toLowerCase().includes(q))
  }, [people, filter])

  const toggle = id => setPicked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const save = useCallback(async (e) => {
    e?.preventDefault()
    if (!picked.size || saving) return
    setSaving(true)
    setError(null)
    try {
      await roomPeopleApi(ADD_PEOPLE_MUTATION, { roomId: room.id, userIds: [...picked] })
      const parentId = room.parentGroup?.id || room.parentId
      if (parentId) await dispatch(fetchGroupViews(parentId))
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [picked, saving, room, dispatch, onClose])

  return createPortal(
    <div
      className='fixed inset-0 z-[1100] flex items-center justify-center bg-darkening/50 pointer-events-auto'
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <form onSubmit={save} className='bg-midground rounded-lg shadow-lg p-4 w-full max-w-md max-h-[85vh] flex flex-col gap-3'>
        <h2 className='text-lg font-semibold m-0'>{t('agoraRooms.addPeopleTitle', { name: room.name })}</h2>
        <Input autoFocus value={filter} placeholder={t('agoraRooms.searchPeople')} onChange={e => setFilter(e.target.value)} />
        <div className='flex flex-col gap-1 overflow-y-auto min-h-[8rem]'>
          {people === null && <p className='text-sm text-foreground/60 m-0'>{t('agoraRooms.loadingPeople')}</p>}
          {people !== null && shown.length === 0 && <p className='text-sm text-foreground/60 m-0'>{t('agoraRooms.nobodyToAdd')}</p>}
          {shown.map(person => (
            <label key={person.id} className='flex items-center gap-2 rounded-md p-2 cursor-pointer hover:bg-background/40'>
              <input type='checkbox' checked={picked.has(person.id)} onChange={() => toggle(person.id)} />
              {person.avatarUrl && <img src={person.avatarUrl} alt='' className='w-6 h-6 rounded-full object-cover' />}
              <span className='text-sm'>{person.name}</span>
            </label>
          ))}
        </div>
        {error && <p role='alert' className='text-sm text-destructive m-0'>{error}</p>}
        <div className='flex justify-end gap-2'>
          <Button type='button' variant='secondary' onClick={onClose}>{t('agoraRooms.cancel')}</Button>
          <Button type='submit' disabled={!picked.size || saving}>{saving ? t('agoraRooms.adding') : t('agoraRooms.addPeopleButton', { count: picked.size })}</Button>
        </div>
      </form>
    </div>,
    document.body
  )
}
