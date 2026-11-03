/**
 * Agora: shows a file of the Files page in a pop-up, so plain files (PDF,
 * pictures, text, sound and video) open without a download. Which files may
 * be shown is decided by the server (VIEWABLE in AgoraKdriveController); the
 * pop-up only offers it for the same kinds (viewKind in helpers.js).
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import Button from 'components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from 'components/ui/dialog'
import { downloadUrl, viewUrl } from './api'
import { viewKind } from './helpers'

export default function FileViewer ({ groupSlug, item, onClose }) {
  const { t } = useTranslation()
  if (!item) return null
  const kind = viewKind(item.name)
  const src = viewUrl(groupSlug, item.id)

  let body = null
  if (kind === 'image') {
    body = <img src={src} alt={item.name} className='max-w-full max-h-full object-contain mx-auto' />
  } else if (kind === 'audio') {
    body = <audio src={src} controls className='w-full' />
  } else if (kind === 'video') {
    body = <video src={src} controls className='max-w-full max-h-full mx-auto' />
  } else if (kind === 'pdf' || kind === 'text') {
    body = <iframe src={src} title={item.name} className='w-full h-full rounded border-0 bg-white' />
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className='max-w-5xl w-[95vw] h-[90vh] flex flex-col gap-3' data-testid='file-viewer'>
        <DialogHeader className='pr-8'>
          <DialogTitle className='break-words'>{item.name}</DialogTitle>
          <DialogDescription className='sr-only'>{t('A preview of this file')}</DialogDescription>
        </DialogHeader>
        <div className='flex-1 min-h-0 flex items-center justify-center overflow-auto'>{body}</div>
        <div className='flex justify-end'>
          <Button asChild size='sm' variant='outline'>
            <a href={downloadUrl(groupSlug, item.id)} download>{t('Download')}</a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
