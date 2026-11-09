/**
 * Agora: the Resources page of a circle or space, inside the app, at
 * /groups/<circle>/resources (and /groups/<circle>/spaces/<space>/resources).
 *
 * One list for everything the circle keeps. It joins two stores that stay
 * where they are:
 *   - the circle's folder in 7BP's kDrive: folders, files and links to Google
 *     documents (files/api.js, AgoraKdriveController);
 *   - the library: documents, pictures, recordings with their transcript,
 *     meeting notes and links, kept in Agora and searchable inside the text
 *     (library/api.js, AgoraLibraryController).
 * At the top level both show together, sortable by name, who added it, date
 * and size. Inside a kDrive folder only that folder shows. Files dropped or
 * added at the top level go to the library, inside a folder to that folder.
 * If one of the two cannot be reached, the other still shows.
 *
 * The browser never talks to kDrive: files come and go through Agora. The
 * server checks every permission again.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Download, ExternalLink, Eye, File as FileIcon, FileText, Folder, FolderInput, FolderOpen, Link2, MessageSquare, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
import Button from 'components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from 'components/ui/dropdown-menu'
import { Input } from 'components/ui/input'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import FileViewer from '../files/FileViewer'
import FolderPicker from '../files/FolderPicker'
import { downloadUrl, listFolder, post, sendFile } from '../files/api'
import { SERVICES, formatDay, formatSize, googleUrl, selectionActions, sortItems, viewKind } from '../files/helpers'
import { libraryApi, circlePath, uploadFile, createItem } from '../library/api'
import { AddPanel, ItemDetail, KIND_ICONS, TextStatus, fieldClasses as selectClasses, useKindLabels } from './LibraryParts'

const KINDS = ['document', 'image', 'audio', 'video', 'meeting', 'link']
const MEDIA_NAME = /\.(mp3|m4a|wav|ogg|opus|flac|mp4|mov|webm|mkv)$/i

/** A library item, shaped like a kDrive row so one table and one sort can show both. */
const libraryRow = item => ({
  id: `lib-${item.id}`,
  libId: item.id,
  lib: true,
  name: item.title,
  kind: 'library',
  libKind: item.kind,
  addedBy: item.addedBy ? item.addedBy.name : '',
  changedAt: item.createdAt,
  size: item.size || null,
  canChange: false,
  tags: item.tags || [],
  snippet: item.snippet,
  description: item.description,
  textStatus: item.textStatus,
  link: item.link
})

export default function ResourcesPage ({ groupSlug: slugProp }) {
  const { t, i18n } = useTranslation()
  const params = useParams()
  const groupSlug = slugProp || params.groupSlug
  const locale = i18n && i18n.language
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = searchParams.get('folder') || null
  const openId = searchParams.get('item')
  const kinds = useKindLabels()

  const [view, setView] = useState({ state: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [status, setStatus] = useState({ text: '', warn: false })
  const [progress, setProgress] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sort, setSort] = useState({ key: 'name', direction: 'asc' })
  const [selectedIds, setSelectedIds] = useState([])
  const [panel, setPanel] = useState(null) // 'folder', 'link', 'details', 'move' or null
  const [linkForm, setLinkForm] = useState({ url: '', title: '', description: '', tags: '' })
  const [libSettings, setLibSettings] = useState(undefined) // undefined: loading, null: could not be loaded
  const [libResult, setLibResult] = useState(null)
  const [libError, setLibError] = useState(null)
  const [libKey, setLibKey] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [renaming, setRenaming] = useState(null) // { id, value }
  const [confirmDelete, setConfirmDelete] = useState(null) // the items to delete
  const [movingItems, setMovingItems] = useState([])
  const [viewing, setViewing] = useState(null) // the file shown in the viewer
  const [dropTarget, setDropTarget] = useState(null)
  const [fileDrop, setFileDrop] = useState(false)
  const dragging = useRef(null)
  const fileInput = useRef(null)

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Resources'), icon: <FolderOpen />, info: '', search: false })
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

  // The library: its settings, then its items.
  useEffect(() => {
    let stopped = false
    setLibSettings(undefined)
    setLibResult(null)
    setLibError(null)
    libraryApi(circlePath(groupSlug, '/settings'))
      .then(s => { if (!stopped) setLibSettings(s) })
      .catch(err => { if (!stopped) { setLibSettings(null); setLibError(err.message) } })
    return () => { stopped = true }
  }, [groupSlug])

  // The search starts a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const loadLibrary = useCallback(async (offset = 0) => {
    try {
      setLibError(null)
      const params = new URLSearchParams()
      if (query) params.set('search', query)
      if (kindFilter) params.set('kind', kindFilter)
      if (offset) params.set('offset', String(offset))
      const data = await libraryApi(circlePath(groupSlug, `/items${params.toString() ? `?${params}` : ''}`))
      setLibResult(old => offset && old ? { ...data, items: [...old.items, ...data.items] } : data)
    } catch (err) {
      setLibError(err.message)
    }
  }, [groupSlug, query, kindFilter])

  useEffect(() => { if (libSettings && !folderId) loadLibrary(0) }, [loadLibrary, libSettings, folderId, libKey])

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
  const atTop = !folderId
  const libOk = Boolean(libSettings) && !libError
  const kdOff = view.state === 'notConnected' || view.state === 'error'
  const kdCanAdd = Boolean(folder && folder.canAdd)
  // Where new files and links go: the library at the top level, otherwise the open kDrive folder.
  const addDest = atTop && libOk && libSettings.canAdd !== false ? 'library' : (kdCanAdd ? 'kdrive' : null)
  const canAdd = Boolean(addDest)
  const lowerQuery = query.toLowerCase()
  const items = useMemo(() => {
    const kd = ((data && data.items) || []).filter(i => {
      if (kindFilter && !(kindFilter === 'link' && i.kind === 'link')) return false
      return !lowerQuery || i.name.toLowerCase().includes(lowerQuery)
    })
    const lib = atTop && libOk && libResult ? libResult.items.map(libraryRow) : []
    return sortItems([...kd, ...lib], sort.key, sort.direction)
  }, [data, atTop, libOk, libResult, sort, kindFilter, lowerQuery])
  const selectable = useMemo(() => items.filter(i => !i.lib), [items])
  const selected = useMemo(() => selectable.filter(i => selectedIds.includes(i.id)), [selectable, selectedIds])
  const actions = selectionActions(selected)

  const reload = useCallback(() => { setReloadKey(k => k + 1); setLibKey(k => k + 1) }, [])
  const say = (text, warn = false) => setStatus({ text, warn })
  const openFolder = id => setSearchParams(id ? { folder: id } : {})
  const openItem = id => setSearchParams(id ? { item: id } : {})

  const failed = res => (res.data && res.data.error) || t('That did not work. Try again in a minute.')

  /* ---- adding ---- */

  // At the top level: one library item per file, with the library's size limits.
  const addToLibrary = async files => {
    const good = []
    const problems = []
    for (const file of files) {
      const media = /^(audio|video)\//.test(file.type) || MEDIA_NAME.test(file.name)
      const maxMb = media ? libSettings.maxMediaMb : libSettings.maxDocumentMb
      if (file.size === 0) problems.push(t('{{name}}: empty, so not added.', { name: file.name }))
      else if (file.size > maxMb * 1048576) problems.push(t('{{name}}: larger than {{mb}} MB, so not added.', { name: file.name, mb: maxMb }))
      else good.push(file)
    }
    setBusy(true)
    let added = 0
    for (let i = 0; i < good.length; i++) {
      const file = good[i]
      say(good.length > 1
        ? t('Adding {{name}} ({{i}} of {{n}})…', { name: file.name, i: i + 1, n: good.length })
        : t('Adding {{name}}…', { name: file.name }))
      setProgress(0)
      try {
        const id = await uploadFile({ groupSlug, file, onProgress: p => setProgress(p) })
        await createItem(groupSlug, { title: file.name, description: '', tags: '', link: '', fileIds: [id] })
        added++
      } catch (err) {
        problems.push(`${file.name}: ${err.message}`)
      }
    }
    setProgress(null)
    setBusy(false)
    if (problems.length) say(problems.join(' '), true)
    else if (good.length) say(good.length === 1 ? t('Added.') : t('Added {{n}} files.', { n: good.length }))
    if (added) reload()
  }

  const addFiles = async files => {
    if (busy || !canAdd || !files.length) return
    if (addDest === 'library') return addToLibrary(files)
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
    const url = linkForm.url.trim()
    const title = linkForm.title.trim()
    if (busy || !url) return
    setBusy(true)
    say(t('Adding the link…'))
    let res
    if (addDest === 'library') {
      try {
        await createItem(groupSlug, { title, description: linkForm.description, tags: linkForm.tags, link: url, fileIds: [] })
        res = { ok: true }
      } catch (err) {
        res = { ok: false, data: { error: err.message } }
      }
    } else {
      res = await post(groupSlug, '/link', { url, title, folder: folder.isCircleFolder ? '' : folder.id })
    }
    setBusy(false)
    if (!res.ok) return say(failed(res), true)
    setPanel(null)
    setLinkForm({ url: '', title: '', description: '', tags: '' })
    say(t('Link added.'))
    reload()
  }

  // Downloads every file of a library item, one by one, a moment apart.
  const downloadLibraryItem = async row => {
    try {
      const { item } = await libraryApi(circlePath(groupSlug, `/items/${encodeURIComponent(row.libId)}`))
      item.files.forEach((file, i) => {
        setTimeout(() => {
          const a = document.createElement('a')
          a.href = `${file.url}${file.url.includes('?') ? '&' : '?'}download=1`
          a.setAttribute('download', '')
          document.body.appendChild(a)
          a.click()
          a.remove()
        }, i * 400)
      })
      if (!item.files.length) say(t('This item has no file to download.'), true)
    } catch (err) {
      say(err.message, true)
    }
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
  const allSelected = selectable.length > 0 && selected.length === selectable.length
  const toggleAll = () => setSelectedIds(allSelected ? [] : selectable.map(i => i.id))

  const circleName = (libSettings && libSettings.circleName) || (folder && (folder.isCircleFolder ? folder.name : folder.path[0].name)) || ''

  // One item of the library, opened inside the page.
  if (openId) {
    if (libSettings === undefined) return <Loading />
    return (
      <div className='p-4 w-full max-w-[960px] mx-auto flex flex-col gap-3' data-testid='agora-resources-page'>
        <Helmet><title>{t('Resources')} | {circleName} | Agora</title></Helmet>
        {libSettings
          ? <ItemDetail groupSlug={groupSlug} itemId={openId} onBack={() => openItem(null)} />
          : <p className='text-destructive' role='alert'>{libError}</p>}
      </div>
    )
  }

  if (view.state === 'loading' || libSettings === undefined) return <Loading />

  // Only when nothing at all can be shown is it an error.
  if ((!atTop && kdOff) || (atTop && kdOff && !libOk)) {
    const message = view.state === 'error' ? view.message : (libError || t('kDrive is not connected to Agora yet. Once it is, the files of this circle show up here.'))
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <p role='alert' className='text-center py-12 rounded-lg border bg-destructive/10 border-destructive/20 text-foreground'>{message}</p>
      </div>
    )
  }

  const sortHead = (sortKey, label, className) => (
    <th key={sortKey} scope='col' className={cn('text-left font-medium px-3 py-2 whitespace-nowrap', className)} aria-sort={sort.key === sortKey ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type='button' className='inline-flex items-center gap-1 text-muted-foreground hover:text-foreground' onClick={() => toggleSort(sortKey)}>
        {label}
        {sort.key === sortKey && (sort.direction === 'asc' ? <ArrowUp className='w-3 h-3' /> : <ArrowDown className='w-3 h-3' />)}
      </button>
    </th>
  )

  const lastPart = folder ? folder.path.length - 1 : -1
  const googleHint = Boolean(googleUrl(linkForm.url.trim()))
  const hasQuery = Boolean(query || kindFilter)

  const libraryRowView = item => {
    const Icon = KIND_ICONS[item.libKind] || FileText
    return (
      <tr key={item.id} data-testid='files-row' data-source='library' className='border-t border-border first:border-t-0 hover:bg-foreground/5'>
        <td className='px-3 py-2' />
        <td className='px-3 py-2 min-w-0'>
          <span className='flex items-start gap-2 min-w-0'>
            <Icon className='w-4 h-4 mt-0.5 shrink-0 text-muted-foreground' aria-label={kinds[item.libKind]} />
            <span className='flex flex-col gap-0.5 min-w-0'>
              <button type='button' className='text-left text-foreground hover:underline break-words min-w-0' onClick={() => openItem(item.libId)}>{item.name}</button>
              {item.snippet && <span className='text-xs text-muted-foreground italic break-words'>…{item.snippet}…</span>}
              {!item.snippet && item.description && <span className='text-xs text-muted-foreground break-words line-clamp-2'>{item.description}</span>}
              <span className='flex flex-wrap gap-1.5 items-center'>
                {item.tags.map(tag => <span key={tag} className='text-xs rounded-full border border-border px-2 py-0.5 text-foreground/80'>#{tag}</span>)}
                <TextStatus status={item.textStatus} />
              </span>
            </span>
          </span>
        </td>
        <td className='px-3 py-2 hidden sm:table-cell text-muted-foreground'>{item.addedBy}</td>
        <td className='px-3 py-2 hidden sm:table-cell text-muted-foreground whitespace-nowrap'>{formatDay(item.changedAt, locale)}</td>
        <td className='px-3 py-2 hidden md:table-cell text-muted-foreground whitespace-nowrap'>{formatSize(item.size, locale)}</td>
        <td className='px-3 py-2 w-12 text-right'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size='sm' variant='ghost' className='h-8 w-8 p-0' aria-label={t('Actions for {{name}}', { name: item.name })}>
                <MoreHorizontal className='w-4 h-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => openItem(item.libId)}><Eye className='w-4 h-4' />{t('Open')}</DropdownMenuItem>
              {item.link && (
                <DropdownMenuItem asChild>
                  <a href={item.link} target='_blank' rel='noopener noreferrer'><ExternalLink className='w-4 h-4' />{t('Open the link')}</a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => downloadLibraryItem(item)}><Download className='w-4 h-4' />{t('Download')}</DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/post/${item.libId}`}><MessageSquare className='w-4 h-4' />{t('Open the post')}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
    )
  }

  return (
    <div className='p-4 w-full max-w-[1000px] mx-auto flex flex-col gap-3' data-testid='agora-resources-page'>
      <Helmet>
        <title>{t('Resources')} | {circleName} | Agora</title>
      </Helmet>

      {folder && (
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
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative flex-1 min-w-[200px]'>
          <Search className='w-4 h-4 absolute left-3 top-3 text-foreground/50' aria-hidden='true' />
          <Input
            className='pl-9'
            type='search'
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Search names, tags and the text inside files')}
            aria-label={t('Search resources')}
          />
        </div>
        <select className={cn(selectClasses, 'w-auto h-10')} value={kindFilter} onChange={e => setKindFilter(e.target.value)} aria-label={t('Kind')}>
          <option value=''>{t('All kinds')}</option>
          {KINDS.map(k => <option key={k} value={k}>{kinds[k]}</option>)}
        </select>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        {canAdd && (
          <>
            <Button size='sm' disabled={busy} onClick={() => fileInput.current && fileInput.current.click()}>{t('Add files')}</Button>
            {kdCanAdd && <Button size='sm' variant='outline' disabled={busy} onClick={() => setPanel(panel === 'folder' ? null : 'folder')}>{t('New folder')}</Button>}
            <Button size='sm' variant='outline' disabled={busy} onClick={() => setPanel(panel === 'link' ? null : 'link')}>{t('Add a link')}</Button>
            {addDest === 'library' && <Button size='sm' variant='outline' disabled={busy} onClick={() => setPanel(panel === 'details' ? null : 'details')}>{t('Add with details')}</Button>}
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
      {folder && !canAdd && <p className='text-sm text-muted-foreground'>{t('This folder is only for the meeting minutes.')}</p>}
      {atTop && kdOff && <p className='text-sm text-muted-foreground'>{t('Folders are not available for this circle right now. Only what is kept in Agora shows.')}</p>}
      {atTop && !kdOff && !libOk && <p className='text-sm text-muted-foreground'>{t('What is kept in Agora could not be loaded right now. Only the folders show.')}</p>}

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
        <form onSubmit={addLink} className='bg-card border border-border rounded-lg p-3 flex flex-col gap-2' aria-label={t('Add a link')}>
          <label className='flex flex-col gap-1 text-sm text-muted-foreground'>
            {t('Link address')}
            <Input name='url' type='url' maxLength={2000} required autoFocus autoComplete='off' spellCheck={false} value={linkForm.url} onChange={e => setLinkForm({ ...linkForm, url: e.target.value })} placeholder={t('Paste the address from your browser')} />
          </label>
          <label className='flex flex-col gap-1 text-sm text-muted-foreground'>
            {t('Title (optional)')}
            <Input name='title' maxLength={200} autoComplete='off' value={linkForm.title} onChange={e => setLinkForm({ ...linkForm, title: e.target.value })} />
          </label>
          {addDest === 'library' && (
            <>
              <label className='flex flex-col gap-1 text-sm text-muted-foreground'>
                {t('Description (optional)')}
                <Input name='description' autoComplete='off' value={linkForm.description} onChange={e => setLinkForm({ ...linkForm, description: e.target.value })} />
              </label>
              <label className='flex flex-col gap-1 text-sm text-muted-foreground'>
                {t('Tags, separated by commas')}
                <Input name='tags' autoComplete='off' value={linkForm.tags} onChange={e => setLinkForm({ ...linkForm, tags: e.target.value })} placeholder={t('for example: budget, playbook')} />
              </label>
            </>
          )}
          {googleHint && <p className='text-sm text-muted-foreground'>{t('Comments and suggestions stay in Google Docs. Check the document\'s sharing setting: Commenter is usually right.')}</p>}
          <div className='flex gap-2'>
            <Button type='submit' size='sm' disabled={busy}>{t('Add link')}</Button>
            <Button type='button' size='sm' variant='outline' onClick={() => setPanel(null)}>{t('Cancel')}</Button>
          </div>
        </form>
      )}

      {panel === 'details' && libOk && (
        <AddPanel
          groupSlug={groupSlug}
          settings={libSettings}
          onCancel={() => setPanel(null)}
          onDone={item => { setPanel(null); reload(); openItem(item.id) }}
        />
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
          ? <p className='p-5 text-muted-foreground'>{hasQuery ? t('Nothing matches your search.') : atTop ? t('Nothing here yet. Add the first file, folder or link.') : t('This folder is empty.')}</p>
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
                  if (item.lib) return libraryRowView(item)
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
                              {item.kind === 'file' && (viewKind(item.name)
                                ? <button type='button' className='text-left text-foreground hover:underline break-words min-w-0' onClick={() => setViewing(item)}>{item.name}</button>
                                : <a href={downloadUrl(groupSlug, item.id)} download className='text-foreground hover:underline break-words min-w-0'>{item.name}</a>)}
                              {item.kind === 'link' && (openUrl
                                ? <a href={openUrl} target='_blank' rel='noopener noreferrer' className='text-foreground hover:underline break-words min-w-0'>{item.name} <Link2 className='inline w-3 h-3' /></a>
                                : <span className='text-foreground break-words min-w-0'>{item.name}</span>)}
                            </span>
                            )}
                      </td>
                      <td className='px-3 py-2 hidden sm:table-cell text-muted-foreground'>{item.addedBy || ''}</td>
                      <td className='px-3 py-2 hidden sm:table-cell text-muted-foreground whitespace-nowrap'>{formatDay(item.changedAt, locale)}</td>
                      <td className='px-3 py-2 hidden md:table-cell text-muted-foreground whitespace-nowrap'>{formatSize(item.size, locale)}</td>
                      <td className='px-3 py-2 w-12 text-right'>
                        {(openUrl || item.kind === 'file' || item.canChange) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size='sm' variant='ghost' className='h-8 w-8 p-0' aria-label={t('Actions for {{name}}', { name: item.name })}>
                                <MoreHorizontal className='w-4 h-4' />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              {item.kind === 'link' && openUrl && (
                                <DropdownMenuItem asChild>
                                  <a href={openUrl} target='_blank' rel='noopener noreferrer'><ExternalLink className='w-4 h-4' />{t('Open')}</a>
                                </DropdownMenuItem>
                              )}
                              {item.kind === 'file' && viewKind(item.name) && (
                                <DropdownMenuItem onSelect={() => setViewing(item)}><Eye className='w-4 h-4' />{t('View')}</DropdownMenuItem>
                              )}
                              {item.kind === 'file' && (
                                <DropdownMenuItem asChild>
                                  <a href={downloadUrl(groupSlug, item.id)} download><Download className='w-4 h-4' />{t('Download')}</a>
                                </DropdownMenuItem>
                              )}
                              {item.canChange && (
                                <>
                                  {(openUrl || item.kind === 'file') && <DropdownMenuSeparator />}
                                  <DropdownMenuItem disabled={busy} onSelect={() => { setRenaming({ id: item.id, value: item.name }); setConfirmDelete(null) }}><Pencil className='w-4 h-4' />{t('Rename')}</DropdownMenuItem>
                                  <DropdownMenuItem disabled={busy} onSelect={() => startMove([item])}><FolderInput className='w-4 h-4' />{t('Move to…')}</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem disabled={busy} className='text-destructive focus:text-destructive' onSelect={() => { setConfirmDelete([item]); setPanel(null) }}><Trash2 className='w-4 h-4' />{t('Delete')}</DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
      </div>

      {atTop && libOk && libResult && libResult.hasMore && (
        <div><Button variant='outline' onClick={() => loadLibrary(libResult.items.length)}>{t('Show more')}</Button></div>
      )}

      <p className='text-sm text-muted-foreground'>
        {t('Files in folders are kept in 7BP\'s kDrive at Infomaniak, in Switzerland. Files added at the top level are kept in Agora, which reads their text so search finds words inside them and recordings get a transcript. Only members of this circle see them. The member who added a file, and the stewards of the circle, can rename, move and delete files in folders.')}
      </p>

      {viewing && <FileViewer groupSlug={groupSlug} item={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
