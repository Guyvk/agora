/**
 * Agora: the Files page of a circle or space, inside the app, at
 * /groups/<circle>/files (and /groups/<circle>/spaces/<space>/files).
 *
 * It shows the circle's folder in 7BP's kDrive: folders, files and links to
 * Google documents, with who added each and when. Members open folders,
 * download, add files (pick several or drop them), make folders, and add
 * links. The member who added something, and the stewards, rename, move and
 * delete it. Items can be dragged onto a folder or a part of the path, or
 * moved with "Move to…". Several items can be selected for Move, Download and
 * Delete. The server checks every permission again (AgoraKdriveController).
 *
 * The browser never talks to kDrive: files come and go through Agora.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ExternalLink, File as FileIcon, Folder, FolderOpen, Link2 } from 'lucide-react'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import FolderPicker from './FolderPicker'
import { downloadUrl, listFolder, post, sendFile } from './api'
import { SERVICES, formatDay, formatSize, googleUrl, selectionActions, sortItems } from './helpers'

const smallButton = 'text-xs px-2 py-1 h-auto'

export default function FilesPage ({ groupSlug: slugProp }) {
  const { t, i18n } = useTranslation()
  const params = useParams()
  const groupSlug = slugProp || params.groupSlug
  const locale = i18n && i18n.language
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = searchParams.get('folder') || null

  const [view, setView] = useState({ state: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [status, setStatus] = useState({ text: '', warn: false })
  const [progress, setProgress] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sort, setSort] = useState({ key: 'name', direction: 'asc' })
  const [selectedIds, setSelectedIds] = useState([])
  const [panel, setPanel] = useState(null) // 'folder', 'link', 'move' or null
  const [renaming, setRenaming] = useState(null) // { id, value }
  const [confirmDelete, setConfirmDelete] = useState(null) // the items to delete
  const [movingItems, setMovingItems] = useState([])
  const [dropTarget, setDropTarget] = useState(null)
  const [fileDrop, setFileDrop] = useState(false)
  const dragging = useRef(null)
  const fileInput = useRef(null)

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Files'), icon: <FolderOpen />, info: '', search: false })
  }, [setHeaderDetails, t])

  // Load a folder. A new folder or a new group starts clean.
  useEffect(() => {
    let stopped = false
    setView(old => (old.state === 'ready' ? { ...old, refreshing: true } : { state: 'loading' }))
    listFolder(groupSlug, folderId).then(res => {
      if (stopped) return
      if (res.status === 409 && !(res.data && res.data.folder)) return setView({ state: 'notConnected' })
      if (!res.ok) return setView({ state: 'error', message: res.data.error || t('The files could not be loaded. Try again in a minute.') })
      setView({ state: 'ready', data: res.data })
    })
    return () => { stopped = true }
  }, [groupSlug, folderId, reloadKey, t])

  useEffect(() => {
    setSelectedIds([])
    setPanel(null)
    setRenaming(null)
    setConfirmDelete(null)
  }, [groupSlug, folderId])

  // Leaving the page stops an upload halfway, so the browser asks first.
  useEffect(() => {
    if (!busy) return undefined
    const warn = e => { e.preventDefault(); e.returnValue = t('A file is still being added.') }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy, t])

  const data = view.state === 'ready' ? view.data : null
  const folder = data && data.folder
  const canAdd = Boolean(folder && folder.canAdd)
  const items = useMemo(() => (data ? sortItems(data.items || [], sort.key, sort.direction) : []), [data, sort])
  const selected = useMemo(() => items.filter(i => selectedIds.includes(i.id)), [items, selectedIds])
  const actions = selectionActions(selected)

  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  const say = (text, warn = false) => setStatus({ text, warn })
  const openFolder = id => setSearchParams(id ? { folder: id } : {})

  const failed = res => (res.data && res.data.error) || t('That did not work. Try again in a minute.')

  /* ---- adding ---- */

  const addFiles = async files => {
    if (busy || !canAdd || !files.length) return
    const maxMb = data.maxUploadMb || 100
    const limit = maxMb * 1048576
    const good = files.filter(f => f.size > 0 && f.size <= limit)
    const problems = [
      ...files.filter(f => f.size > limit).map(f => t('{{name}}: larger than {{mb}} MB, so not added.', { name: f.name, mb: maxMb })),
      ...files.filter(f => f.size === 0).map(f => t('{{name}}: empty, so not added.', { name: f.name }))
    ]
    setBusy(true)
    let added = 0
    for (let i = 0; i < good.length; i++) {
      const file = good[i]
      const label = good.length > 1
        ? t('Adding {{name}} ({{i}} of {{n}})…', { name: file.name, i: i + 1, n: good.length })
        : t('Adding {{name}}…', { name: file.name })
      say(label)
      setProgress(0)
      const result = await sendFile(groupSlug, file, folder.isCircleFolder ? null : folder.id, part => setProgress(part))
      if (result.ok) added++
      else problems.push(`${file.name}: ${result.error || t('That did not work. Try again in a minute.')}`)
    }
    setProgress(null)
    setBusy(false)
    if (problems.length) say(problems.join(' '), true)
    else if (good.length) say(good.length === 1 ? t('Added.') : t('Added {{n}} files.', { n: good.length }))
    if (added) reload()
  }

  const makeFolder = async e => {
    e.preventDefault()
    const name = e.target.elements.name.value.trim()
    if (busy || !name) return
    setBusy(true)
    say(t('Making the folder…'))
    const res = await post(groupSlug, '/folder', { name, folder: folder.isCircleFolder ? '' : folder.id })
    setBusy(false)
    if (!res.ok) return say(failed(res), true)
    setPanel(null)
    say(t('Folder made.'))
    reload()
  }

  const addLink = async e => {
    e.preventDefault()
    const url = e.target.elements.url.value.trim()
    const title = e.target.elements.title.value.trim()
    if (busy || !url) return
    setBusy(true)
    say(t('Adding the link…'))
    const res = await post(groupSlug, '/link', { url, title, folder: folder.isCircleFolder ? '' : folder.id })
    setBusy(false)
    if (!res.ok) return say(failed(res), true)
    setPanel(null)
    say(t('Link added.'))
    reload()
  }

  /* ---- rename, delete, move ---- */

  const saveRename = async e => {
    e.preventDefault()
    const { id, value } = renaming
    const item = items.find(i => i.id === id)
    const name = value.trim()
    if (!name || !item || name === item.name) return setRenaming(null)
    setBusy(true)
    const res = await post(groupSlug, '/rename', { item: id, name })
    setBusy(false)
    if (!res.ok) return say(failed(res), true)
    setRenaming(null)
    say(t('Renamed.'))
    reload()
  }

  const deleteItems = async list => {
    setBusy(true)
    const problems = []
    for (const item of list) {
      const res = await post(groupSlug, '/delete', { item: item.id })
      if (!res.ok) problems.push(`${item.name}: ${failed(res)}`)
    }
    setBusy(false)
    setConfirmDelete(null)
    setSelectedIds([])
    say(problems.length ? problems.join(' ') : t('Deleted.'), problems.length > 0)
    reload()
  }

  const moveItems = async (list, destination) => {
    if (busy || !list.length) return
    setBusy(true)
    const problems = []
    let moved = 0
    for (const item of list) {
      const res = await post(groupSlug, '/move', { item: item.id, folder: destination })
      if (res.ok) moved++
      else problems.push(`${item.name}: ${failed(res)}`)
    }
    setBusy(false)
    setPanel(null)
    setMovingItems([])
    setSelectedIds([])
    if (problems.length) say(problems.join(' '), true)
    else say(moved === 1 ? t('Moved.') : t('Moved {{n}} items.', { n: moved }))
    reload()
  }

  const startMove = list => {
    setMovingItems(list)
    setPanel('move')
    setConfirmDelete(null)
  }

  const downloadSelected = () => {
    // One by one, a moment apart, so the browser does not block them.
    selected.forEach((item, i) => {
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = downloadUrl(groupSlug, item.id)
        a.setAttribute('download', '')
        document.body.appendChild(a)
        a.click()
        a.remove()
      }, i * 400)
    })
  }

  /* ---- dragging ---- */

  const dragStart = (e, item) => {
    const list = selectedIds.includes(item.id) ? selected : [item]
    dragging.current = list.filter(i => i.canChange)
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      try { e.dataTransfer.setData('text/plain', item.name) } catch (err) {}
    }
  }
  const dragEnd = () => { dragging.current = null; setDropTarget(null) }
  // Folder rows and the parts of the path accept dragged items.
  const folderTarget = (key, destination, accepts = true) => ({
    onDragOver: e => {
      if (!dragging.current || !accepts || dragging.current.some(i => i.id === key)) return
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget(old => (old === key ? null : old)),
    onDrop: e => {
      if (!dragging.current || !accepts || dragging.current.some(i => i.id === key)) return
      e.preventDefault()
      e.stopPropagation()
      const list = dragging.current
      dragEnd()
      moveItems(list, destination)
    }
  })

  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')
  const panelDrop = {
    onDragOver: e => {
      if (busy || !canAdd || dragging.current || !hasFiles(e)) return
      e.preventDefault()
      setFileDrop(true)
    },
    onDragLeave: () => setFileDrop(false),
    onDrop: e => {
      setFileDrop(false)
      if (busy || !canAdd || dragging.current || !hasFiles(e)) return
      e.preventDefault()
      addFiles(Array.from(e.dataTransfer.files || []))
    }
  }

  /* ---- drawing ---- */

  const toggleSort = key => setSort(old => (old.key === key ? { key, direction: old.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }))
  const toggleOne = id => setSelectedIds(old => (old.includes(id) ? old.filter(x => x !== id) : [...old, id]))
  const allSelected = items.length > 0 && selected.length === items.length
  const toggleAll = () => setSelectedIds(allSelected ? [] : items.map(i => i.id))

  if (view.state === 'loading') return <Loading />
  if (view.state === 'notConnected' || view.state === 'error') {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <p role='alert' className={cn('text-center py-12 rounded-lg border', view.state === 'error' ? 'bg-destructive/10 border-destructive/20 text-foreground' : 'bg-card border-border text-foreground')}>
          {view.state === 'error' ? view.message : t('kDrive is not connected to Agora yet. Once it is, the files of this circle show up here.')}
        </p>
      </div>
    )
  }

  const sortHead = (sortKey, label, className) => (
    <th key={sortKey} scope='col' className={cn('text-left font-medium px-3 py-2', className)} aria-sort={sort.key === sortKey ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type='button' className='inline-flex items-center gap-1 text-muted-foreground hover:text-foreground' onClick={() => toggleSort(sortKey)}>
        {label}
        {sort.key === sortKey && (sort.direction === 'asc' ? <ArrowUp className='w-3 h-3' /> : <ArrowDown className='w-3 h-3' />)}
      </button>
    </th>
  )

  const fieldClasses = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const lastPart = folder.path.length - 1

  return (
    <div className='p-4 w-full max-w-[1000px] mx-auto flex flex-col gap-3' data-testid='agora-files-page'>
      <Helmet>
        <title>{t('Files')} | {folder.isCircleFolder ? folder.name : folder.path[0].name} | Agora</title>
      </Helmet>

      <nav className='flex flex-wrap items-center gap-1 text-sm text-muted-foreground' aria-label={t('Path')} data-testid='files-path'>
        {folder.path.map((part, i) => (
          <React.Fragment key={part.id}>
            {i > 0 && <span aria-hidden='true'>/</span>}
            {i === lastPart
              ? <span className='text-foreground font-medium'>{part.name}</span>
              : (
                <button
                  type='button'
                  data-testid='files-path-part'
                  className={cn('underline text-foreground rounded px-1', dropTarget === part.id && 'ring-2 ring-selected bg-selected/20')}
                  onClick={() => openFolder(part.isCircleFolder ? null : part.id)}
                  {...folderTarget(part.id, part.isCircleFolder ? '' : part.id)}
                >
                  {part.name}
                </button>
                )}
          </React.Fragment>
        ))}
      </nav>

      <div className='flex flex-wrap items-center gap-2'>
        {canAdd && (
          <>
            <Button size='sm' disabled={busy} onClick={() => fileInput.current && fileInput.current.click()}>{t('Add files')}</Button>
            <Button size='sm' variant='outline' disabled={busy} onClick={() => setPanel(panel === 'folder' ? null : 'folder')}>{t('New folder')}</Button>
            <Button size='sm' variant='outline' disabled={busy} onClick={() => setPanel(panel === 'link' ? null : 'link')}>{t('Add a Google Doc')}</Button>
            <input
              ref={fileInput}
              type='file'
              multiple
              hidden
              data-testid='files-input'
              onChange={e => { const list = Array.from(e.target.files || []); e.target.value = ''; addFiles(list) }}
            />
          </>
        )}
        <span className={cn('text-sm', status.warn ? 'text-destructive' : 'text-muted-foreground')} role='status' aria-live='polite'>{status.text}</span>
      </div>
      {progress !== null && (
        <div className='h-2 w-full bg-foreground/10 rounded' role='progressbar' aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className='h-2 bg-selected rounded' style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {!canAdd && <p className='text-sm text-muted-foreground'>{t('This folder is only for the meeting minutes.')}</p>}

      {panel === 'folder' && (
        <form onSubmit={makeFolder} className='bg-card border border-border rounded-lg p-3 flex flex-wrap items-end gap-2' aria-label={t('New folder')}>
          <label className='flex flex-col gap-1 text-sm text-muted-foreground grow'>
            {t('Name of the new folder')}
            <Input name='name' maxLength={240} required autoFocus autoComplete='off' />
          </label>
          <Button type='submit' size='sm' disabled={busy}>{t('Make folder')}</Button>
          <Button type='button' size='sm' variant='outline' onClick={() => setPanel(null)}>{t('Cancel')}</Button>
        </form>
      )}

      {panel === 'link' && (
        <form onSubmit={addLink} className='bg-card border border-border rounded-lg p-3 flex flex-col gap-2' aria-label={t('Add a Google Doc')}>
          <label className='flex flex-col gap-1 text-sm text-muted-foreground'>
            {t('Link to the Google document')}
            <Input name='url' type='url' maxLength={2000} required autoFocus autoComplete='off' spellCheck={false} placeholder={t('Paste the address from your browser')} />
          </label>
          <label className='flex flex-col gap-1 text-sm text-muted-foreground'>
            {t('Title (optional)')}
            <Input name='title' maxLength={200} autoComplete='off' />
          </label>
          <p className='text-sm text-muted-foreground'>{t('Comments and suggestions stay in Google Docs. Check the document\'s sharing setting: Commenter is usually right.')}</p>
          <div className='flex gap-2'>
            <Button type='submit' size='sm' disabled={busy}>{t('Add link')}</Button>
            <Button type='button' size='sm' variant='outline' onClick={() => setPanel(null)}>{t('Cancel')}</Button>
          </div>
        </form>
      )}

      {panel === 'move' && (
        <FolderPicker
          groupSlug={groupSlug}
          moving={movingItems}
          startFolderId={folderId}
          currentFolderId={folder.isCircleFolder ? null : folder.id}
          busy={busy}
          onPick={destination => moveItems(movingItems, destination)}
          onCancel={() => { setPanel(null); setMovingItems([]) }}
        />
      )}

      {selected.length > 0 && (
        <div className='flex flex-wrap items-center gap-2 bg-card border border-border rounded-lg px-3 py-2' data-testid='files-selection-bar'>
          <span className='text-sm text-foreground mr-2'>{t('{{n}} selected', { n: selected.length })}</span>
          {actions.move && <Button size='sm' variant='outline' disabled={busy} onClick={() => startMove(selected)}>{t('Move to…')}</Button>}
          {actions.download && <Button size='sm' variant='outline' disabled={busy} onClick={downloadSelected}>{t('Download')}</Button>}
          {actions.remove && <Button size='sm' variant='outline' className='text-destructive' disabled={busy} onClick={() => { setConfirmDelete(selected); setPanel(null) }}>{t('Delete')}</Button>}
          <Button size='sm' variant='ghost' onClick={() => setSelectedIds([])}>{t('Clear selection')}</Button>
        </div>
      )}

      {confirmDelete && (
        <div className='flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground' role='alertdialog'>
          <span>
            {confirmDelete.length > 1
              ? t('Delete these {{n}} items? Files and folders go to the kDrive bin, where an administrator can put them back for a while. Links are only removed from this list.', { n: confirmDelete.length })
              : confirmDelete[0].kind === 'link'
                ? t('Remove the link "{{name}}" from this list? The Google document itself is not deleted.', { name: confirmDelete[0].name })
                : t('Delete "{{name}}"? It goes to the kDrive bin, where an administrator can put it back for a while.', { name: confirmDelete[0].name })}
          </span>
          <Button type='button' variant='destructive' size='sm' disabled={busy} onClick={() => deleteItems(confirmDelete)}>{t('Yes, delete')}</Button>
          <Button type='button' variant='outline' size='sm' onClick={() => setConfirmDelete(null)}>{t('Keep')}</Button>
        </div>
      )}

      <div
        className={cn('bg-card border border-border rounded-lg overflow-x-auto', fileDrop && 'outline outline-2 outline-dashed outline-selected')}
        data-testid='files-list'
        {...panelDrop}
      >
        {items.length === 0
          ? <p className='p-5 text-muted-foreground'>{t('This folder is empty.')}</p>
          : (
            <table className='w-full text-sm'>
              <thead className='border-b border-border'>
                <tr>
                  <th scope='col' className='w-10 px-3 py-2'>
                    <input type='checkbox' aria-label={t('Select all')} checked={allSelected} onChange={toggleAll} />
                  </th>
                  {sortHead('name', t('Name'))}
                  {sortHead('addedBy', t('Added by'), 'hidden sm:table-cell')}
                  {sortHead('date', t('Date'), 'hidden sm:table-cell')}
                  {sortHead('size', t('Size'), 'hidden md:table-cell')}
                  <th scope='col' className='px-3 py-2'><span className='sr-only'>{t('Actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const isFolder = item.kind === 'folder'
                  const target = isFolder && !item.kept ? folderTarget(item.id, item.id) : {}
                  const service = item.kind === 'link' ? (SERVICES[item.service] || SERVICES.drive) : null
                  const openUrl = item.kind === 'link' ? googleUrl(item.url) : null
                  return (
                    <tr
                      key={item.id}
                      data-testid='files-row'
                      draggable={item.canChange}
                      onDragStart={e => dragStart(e, item)}
                      onDragEnd={dragEnd}
                      className={cn('border-t border-border first:border-t-0 hover:bg-foreground/5', selectedIds.includes(item.id) && 'bg-selected/10', dropTarget === item.id && 'ring-2 ring-inset ring-selected bg-selected/20')}
                      {...target}
                    >
                      <td className='px-3 py-2'>
                        <input type='checkbox' aria-label={t('Select {{name}}', { name: item.name })} checked={selectedIds.includes(item.id)} onChange={() => toggleOne(item.id)} />
                      </td>
                      <td className='px-3 py-2 min-w-0'>
                        {renaming && renaming.id === item.id
                          ? (
                            <form onSubmit={saveRename} className='flex flex-wrap items-center gap-2' aria-label={t('Rename')}>
                              <Input aria-label={t('New name')} value={renaming.value} onChange={e => setRenaming({ id: item.id, value: e.target.value })} maxLength={240} autoFocus className='h-8 max-w-xs' />
                              <Button type='submit' size='sm' disabled={busy}>{t('Save')}</Button>
                              <Button type='button' size='sm' variant='outline' onClick={() => setRenaming(null)}>{t('Cancel')}</Button>
                            </form>
                            )
                          : (
                            <span className='flex items-center gap-2 min-w-0'>
                              {isFolder && <Folder className='w-4 h-4 shrink-0 text-muted-foreground' aria-label={t('Folder')} />}
                              {item.kind === 'file' && <FileIcon className='w-4 h-4 shrink-0 text-muted-foreground' aria-label={t('File')} />}
                              {service && <span className='shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white' style={{ background: service.color }} title={service.name}>{service.label}</span>}
                              {isFolder && <button type='button' className='text-left text-foreground font-medium hover:underline break-words min-w-0' onClick={() => openFolder(item.id)}>{item.name}</button>}
                              {item.kind === 'file' && <a href={downloadUrl(groupSlug, item.id)} download className='text-foreground hover:underline break-words min-w-0'>{item.name}</a>}
                              {item.kind === 'link' && (openUrl
                                ? <a href={openUrl} target='_blank' rel='noopener noreferrer' className='text-foreground hover:underline break-words min-w-0'>{item.name} <Link2 className='inline w-3 h-3' /></a>
                                : <span className='text-foreground break-words min-w-0'>{item.name}</span>)}
                            </span>
                            )}
                      </td>
                      <td className='px-3 py-2 hidden sm:table-cell text-muted-foreground'>{item.addedBy || ''}</td>
                      <td className='px-3 py-2 hidden sm:table-cell text-muted-foreground whitespace-nowrap'>{formatDay(item.changedAt, locale)}</td>
                      <td className='px-3 py-2 hidden md:table-cell text-muted-foreground whitespace-nowrap'>{formatSize(item.size, locale)}</td>
                      <td className='px-3 py-2'>
                        <span className='flex flex-wrap gap-1 justify-end'>
                          {item.kind === 'link' && openUrl && (
                            <Button asChild size='sm' variant='outline' className={smallButton}>
                              <a href={openUrl} target='_blank' rel='noopener noreferrer'>{t('Open')} <ExternalLink className='w-3 h-3' /></a>
                            </Button>
                          )}
                          {item.kind === 'file' && (
                            <Button asChild size='sm' variant='outline' className={smallButton}>
                              <a href={downloadUrl(groupSlug, item.id)} download>{t('Download')}</a>
                            </Button>
                          )}
                          {item.canChange && (
                            <>
                              <Button size='sm' variant='outline' className={smallButton} disabled={busy} onClick={() => { setRenaming({ id: item.id, value: item.name }); setConfirmDelete(null) }}>{t('Rename')}</Button>
                              <Button size='sm' variant='outline' className={smallButton} disabled={busy} onClick={() => startMove([item])}>{t('Move to…')}</Button>
                              <Button size='sm' variant='outline' className={cn(smallButton, 'text-destructive')} disabled={busy} onClick={() => { setConfirmDelete([item]); setPanel(null) }}>{t('Delete')}</Button>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
      </div>

      <p className='text-sm text-muted-foreground'>
        {t('These files are kept in 7BP\'s kDrive at Infomaniak, in Switzerland. Only members of this circle see them here. The member who added a file, and the stewards of the circle, can rename, move and delete it.')}
      </p>
    </div>
  )
}
