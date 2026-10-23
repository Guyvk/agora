/**
 * Agora: the Files line in a circle's or space's menu, above the Playbook line.
 *
 * It opens the group's Files page (served by Agora's backend at
 * /noo/agora/files/<group>) in the same tab. It shows for members of the
 * group only; the page and its calls check membership again on the server.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen } from 'lucide-react'

export const FILES_URL = groupSlug => `/noo/agora/files/${encodeURIComponent(groupSlug)}`

export default function FilesMenuLink ({ groupSlug, isMember }) {
  const { t } = useTranslation()
  if (!groupSlug || !isMember) return null
  return (
    <div className='px-1.5 pb-2 border-t border-foreground/10 pt-2'>
      {/* A plain link on purpose: the Files page is not part of this app, so the browser loads it. */}
      <a
        href={FILES_URL(groupSlug)}
        data-testid='agora-files-menu-link'
        className='flex items-center gap-2 text-base font-medium text-foreground hover:text-foreground border-2 border-transparent hover:border-foreground/50 hover:bg-card rounded-md p-1 pl-2 w-full transition-all opacity-85 hover:opacity-100'
      >
        <FolderOpen className='w-4 h-4 shrink-0' />
        <span>{t('Files')}</span>
      </a>
    </div>
  )
}
