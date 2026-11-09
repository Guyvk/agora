/**
 * Agora: the parts of the circle library that the Resources page shares:
 * kind icons and labels, the text status, the "add with details" form
 * (title, description, tags, several files as one item) and the item
 * detail with its preview and transcript.
 *
 * They talk to the library API (library/api.js); the server checks for every
 * call that the person is a member of the circle.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileText, Image as ImageIcon, Link2, Mic, NotebookPen, Upload, Video, X } from 'lucide-react'
import Button from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import Loading from 'components/Loading'
import { cn } from 'util/index'
import { libraryApi, circlePath, uploadFile, createItem } from '../library/api'

export const fieldClasses = 'flex w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export const KIND_ICONS = {
  document: FileText,
  image: ImageIcon,
  audio: Mic,
  video: Video,
  meeting: NotebookPen,
  link: Link2,
  other: FileText
}

export function useKindLabels () {
  const { t } = useTranslation()
  return {
    document: t('Document'),
    image: t('Picture'),
    audio: t('Recording'),
    video: t('Video'),
    meeting: t('Meeting notes'),
    link: t('Link'),
    other: t('File')
  }
}

export function formatDay (iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

export function formatSize (bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`
}

export function TextStatus ({ status }) {
  const { t } = useTranslation()
  const labels = {
    done: t('Text ready'),
    pending: t('Reading the text...'),
    failed: t('Text could not be read'),
    too_big: t('Too long to read'),
    empty: t('No text found')
  }
  if (!labels[status]) return null
  return <span className='text-xs text-foreground/60'>{labels[status]}</span>
}

/** The form for adding files or a link, with a bar per file while it is sent. */
export function AddPanel ({ groupSlug, settings, initialFiles, onDone, onCancel }) {
  const { t } = useTranslation()
  const [files, setFiles] = useState(initialFiles || [])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [link, setLink] = useState('')
  const [progress, setProgress] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const picker = useRef(null)

  useEffect(() => { if (initialFiles && initialFiles.length) setFiles(initialFiles) }, [initialFiles])

  const tooBig = file => {
    const media = /^(audio|video)\//.test(file.type) || /\.(mp3|m4a|wav|ogg|opus|flac|mp4|mov|webm|mkv)$/i.test(file.name)
    const limit = (media ? settings.maxMediaMb : settings.maxDocumentMb) * 1048576
    return file.size > limit ? (media ? settings.maxMediaMb : settings.maxDocumentMb) : null
  }

  const addFiles = list => setFiles(current => [...current, ...Array.from(list || [])])

  const submit = async e => {
    e.preventDefault()
    setError(null)
    if (!files.length && !link.trim()) return setError(t('Add a file or a link.'))
    const big = files.find(tooBig)
    if (big) return setError(t('{{name}} is larger than {{mb}} MB, the most the library accepts.', { name: big.name, mb: tooBig(big) }))
    setBusy(true)
    window.onbeforeunload = () => true
    try {
      const ids = []
      for (const [i, file] of files.entries()) {
        ids.push(await uploadFile({ groupSlug, file, onProgress: p => setProgress(old => ({ ...old, [i]: p })) }))
      }
      const { item } = await createItem(groupSlug, { title: title.trim(), description, tags, link: link.trim(), fileIds: ids })
      onDone(item)
    } catch (err) {
      setError(err.message)
    } finally {
      window.onbeforeunload = null
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className='bg-card border border-border rounded-lg p-4 flex flex-col gap-3' data-testid='library-add'>
      <h2 className='text-lg font-semibold text-foreground'>{t('Add to the library')}</h2>
      <div className='flex flex-col gap-1.5'>
        <span className='text-sm text-muted-foreground'>{t('Files')}</span>
        {files.length > 0 && (
          <ul className='flex flex-col gap-1.5'>
            {files.map((file, i) => (
              <li key={`${file.name}-${i}`} className='flex flex-col gap-1 text-sm'>
                <span className='flex justify-between gap-2'>
                  <span className='break-all text-foreground'>{file.name} <span className='text-foreground/60'>({formatSize(file.size)})</span></span>
                  {!busy && (
                    <button type='button' aria-label={t('Remove {{name}}', { name: file.name })} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                      <X className='w-4 h-4' />
                    </button>
                  )}
                </span>
                {busy && (
                  <span className='h-2 w-full rounded bg-foreground/10 overflow-hidden' role='progressbar' aria-label={file.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress[i] || 0) * 100)}>
                    <span className='block h-full bg-selected' style={{ width: `${Math.round((progress[i] || 0) * 100)}%` }} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <input ref={picker} type='file' multiple className='hidden' data-testid='library-file-input' onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        <div>
          <Button type='button' variant='outline' size='sm' disabled={busy} onClick={() => picker.current && picker.current.click()}>
            <Upload className='w-4 h-4 mr-1' /> {t('Choose files')}
          </Button>
        </div>
        <span className='text-xs text-foreground/60'>
          {t('Recordings and videos up to {{media}} MB, other files up to {{docs}} MB. You can also drop files on this page.', { media: settings.maxMediaMb, docs: settings.maxDocumentMb })}
        </span>
      </div>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='library-title' className='text-muted-foreground'>{t('Title')}</Label>
        <Input id='library-title' value={title} onChange={e => setTitle(e.target.value)} placeholder={files[0] ? files[0].name : ''} maxLength={200} />
      </div>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='library-description' className='text-muted-foreground'>{t('Description')}</Label>
        <textarea id='library-description' className={cn(fieldClasses, 'min-h-[70px]')} value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='library-tags' className='text-muted-foreground'>{t('Tags, separated by commas')}</Label>
        <Input id='library-tags' value={tags} onChange={e => setTags(e.target.value)} placeholder={t('for example: budget, playbook')} />
      </div>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='library-link' className='text-muted-foreground'>{t('Link (instead of or next to files)')}</Label>
        <Input id='library-link' type='url' value={link} onChange={e => setLink(e.target.value)} placeholder='https://' />
      </div>
      {error && <p className='text-sm text-destructive' role='alert'>{error}</p>}
      <div className='flex gap-2'>
        <Button type='submit' disabled={busy}>{busy ? t('Sending...') : t('Add')}</Button>
        <Button type='button' variant='outline' disabled={busy} onClick={onCancel}>{t('Cancel')}</Button>
      </div>
    </form>
  )
}

function FilePreview ({ file }) {
  const { t } = useTranslation()
  const download = `${file.url}${file.url.includes('?') ? '&' : '?'}download=1`
  const isPdf = file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name)
  return (
    <div className='flex flex-col gap-2' data-testid='library-file'>
      {file.kind === 'image' && <img src={file.url} alt={file.name} className='max-w-full max-h-[480px] rounded-md border border-border object-contain self-start' />}
      {file.kind === 'audio' && <audio controls preload='metadata' src={file.url} className='w-full'>{file.name}</audio>}
      {file.kind === 'video' && <video controls preload='metadata' src={file.url} className='w-full max-h-[480px] rounded-md'>{file.name}</video>}
      <div className='flex flex-wrap gap-3 text-sm items-center'>
        <span className='text-foreground break-all'>{file.name}{file.size ? ` (${formatSize(file.size)})` : ''}</span>
        {isPdf && <a className='text-selected underline' href={file.url} target='_blank' rel='noreferrer'>{t('Open PDF')}</a>}
        <a className='text-selected underline' href={download}>{t('Download')}</a>
      </div>
    </div>
  )
}

function TextBlock ({ text }) {
  const { t } = useTranslation()
  const heading = text.kind === 'audio' ? t('Transcript') : text.kind === 'meeting' ? t('Meeting notes and transcript') : t('Text read from {{name}}', { name: text.title || t('the file') })
  let body
  if (text.status === 'done') {
    body = text.text
      ? <pre className='whitespace-pre-wrap break-words font-sans text-sm text-foreground max-h-[480px] overflow-y-auto bg-foreground/5 rounded-md p-3'>{text.text}{text.cut ? `\n\n${t('(The rest is too long to show here.)')}` : ''}</pre>
      : <p className='text-sm text-foreground/70'>{t('No text was found in this file.')}</p>
  } else if (text.status === 'pending') {
    body = <p className='text-sm text-foreground/70'>{text.kind === 'image' ? t('Text in pictures is not read yet. That comes later.') : t('Agora is reading the text. This can take a few minutes for a long recording.')}</p>
  } else {
    body = <p className='text-sm text-foreground/70'>{text.error || t('The text could not be read.')}</p>
  }
  return (
    <section className='flex flex-col gap-1.5' data-testid='library-text'>
      <h3 className='font-semibold text-foreground'>{heading}</h3>
      {body}
    </section>
  )
}

export function ItemDetail ({ groupSlug, itemId, onBack }) {
  const { t } = useTranslation()
  const kinds = useKindLabels()
  const [item, setItem] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setItem(undefined)
    libraryApi(circlePath(groupSlug, `/items/${encodeURIComponent(itemId)}`))
      .then(data => alive && setItem(data.item))
      .catch(err => alive && setError(err.message))
    return () => { alive = false }
  }, [groupSlug, itemId])

  return (
    <div className='flex flex-col gap-4'>
      <div>
        <Button variant='outline' size='sm' onClick={onBack}><ArrowLeft className='w-4 h-4 mr-1' /> {t('Back to the library')}</Button>
      </div>
      {error && <p className='text-destructive' role='alert'>{error}</p>}
      {!error && item === undefined && <Loading />}
      {item && (
        <article className='bg-card border border-border rounded-lg p-4 flex flex-col gap-4' data-testid='library-detail'>
          <header className='flex flex-col gap-1'>
            <h2 className='text-xl font-semibold text-foreground break-words'>{item.title}</h2>
            <p className='text-sm text-foreground/70'>
              {kinds[item.kind]} · {t('{{date}} by {{name}}', { date: formatDay(item.createdAt), name: item.addedBy.name })}
            </p>
            {item.tags.length > 0 && (
              <p className='flex flex-wrap gap-1.5'>
                {item.tags.map(tag => <span key={tag} className='text-xs rounded-full border border-border px-2 py-0.5 text-foreground/80'>#{tag}</span>)}
              </p>
            )}
          </header>
          {item.description && <p className='text-foreground whitespace-pre-wrap break-words'>{item.description}</p>}
          {item.link && <p><a className='text-selected underline break-all' href={item.link} target='_blank' rel='noreferrer'>{item.link}</a></p>}
          {item.files.map(file => <FilePreview key={file.mediaId} file={file} />)}
          {item.texts.map(text => <TextBlock key={text.id} text={text} />)}
          <p><Link className='text-selected underline' to={item.postUrl}>{t('Open the post, with its comments')}</Link></p>
        </article>
      )}
    </div>
  )
}
