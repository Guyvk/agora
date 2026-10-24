/**
 * Agora: the small folder picker of "Move to…" on the Files page.
 *
 * It shows the folders of the circle, one level at a time, with the path on
 * top. Folders that are being moved, and the Minutes folder, are not shown,
 * so nothing can be moved into itself or into Minutes. The server checks all
 * of this again.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder } from 'lucide-react'
import Button from 'components/ui/button'
import { listFolder } from './api'

export default function FolderPicker ({ groupSlug, moving, startFolderId, currentFolderId, busy, onPick, onCancel }) {
  const { t } = useTranslation()
  const [folderId, setFolderId] = useState(startFolderId || null)
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let stopped = false
    setView(null)
    setError(null)
    listFolder(groupSlug, folderId).then(res => {
      if (stopped) return
      if (res.ok) setView(res.data)
      else setError(res.data.error || t('The files could not be loaded. Try again in a minute.'))
    })
    return () => { stopped = true }
  }, [groupSlug, folderId, t])

  const movingIds = new Set(moving.map(i => i.id))
  const folders = view ? view.items.filter(i => i.kind === 'folder' && !movingIds.has(i.id) && !i.kept) : []
  const here = view && view.folder
  const same = here && ((here.isCircleFolder && !currentFolderId) || here.id === currentFolderId)
  const canMoveHere = Boolean(here && here.canAdd && !same)

  return (
    <div className='bg-card border border-selected rounded-lg p-4 flex flex-col gap-3' role='dialog' aria-label={t('Move to…')} data-testid='files-move-picker'>
      <h2 className='text-lg font-semibold text-foreground'>{t('Move to…')}</h2>
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
      {here && (
        <nav className='flex flex-wrap items-center gap-1 text-sm text-muted-foreground' aria-label={t('Path')}>
          {here.path.map((part, i) => (
            <React.Fragment key={part.id}>
              {i > 0 && <span aria-hidden='true'>/</span>}
              {i === here.path.length - 1
                ? <span className='text-foreground font-medium'>{part.name}</span>
                : <button type='button' className='underline text-foreground' onClick={() => setFolderId(part.isCircleFolder ? null : part.id)}>{part.name}</button>}
            </React.Fragment>
          ))}
        </nav>
      )}
      <ul className='border border-border rounded-md divide-y divide-border max-h-64 overflow-auto bg-background'>
        {!view && !error && <li className='p-3 text-sm text-muted-foreground'>{t('Loading the files…')}</li>}
        {view && folders.length === 0 && <li className='p-3 text-sm text-muted-foreground'>{t('No folders in here.')}</li>}
        {folders.map(f => (
          <li key={f.id}>
            <button type='button' className='flex items-center gap-2 w-full text-left p-2 text-foreground hover:bg-foreground/5' onClick={() => setFolderId(f.id)}>
              <Folder className='w-4 h-4 shrink-0' /> <span className='break-words min-w-0'>{f.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {here && !here.canAdd && <p className='text-sm text-muted-foreground'>{t('This folder is only for the meeting minutes.')}</p>}
      <div className='flex flex-wrap gap-2'>
        <Button type='button' disabled={!canMoveHere || busy} onClick={() => onPick(here.isCircleFolder ? '' : here.id)}>{t('Move here')}</Button>
        <Button type='button' variant='outline' onClick={onCancel}>{t('Cancel')}</Button>
      </div>
    </div>
  )
}
