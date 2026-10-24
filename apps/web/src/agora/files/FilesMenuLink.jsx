/**
 * Agora: the Files line in a circle's or space's menu, above the Playbook line.
 *
 * It opens the group's Files page, which is part of this app (FilesPage), in
 * the same page, with the menu and the top bar still there, like Hylo's own
 * menu lines. It shows for members of the group only; the page and its calls
 * check membership again on the server.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen } from 'lucide-react'
import MenuLink from 'routes/AuthLayoutRouter/components/ContextMenu/MenuLink'

/** The Files page of a circle. A space has its own, under its circle: pass `to` for that. */
export const FILES_URL = groupSlug => `/groups/${encodeURIComponent(groupSlug)}/files`

export default function FilesMenuLink ({ groupSlug, isMember, to }) {
  const { t } = useTranslation()
  if (!groupSlug || !isMember) return null
  return (
    <div className='px-1.5 pb-2 border-t border-foreground/10 pt-2'>
      <MenuLink
        to={to || FILES_URL(groupSlug)}
        data-testid='agora-files-menu-link'
        className='flex items-center gap-2 text-base font-medium text-foreground hover:text-foreground border-2 border-transparent hover:border-foreground/50 hover:bg-card rounded-md p-1 pl-2 w-full transition-all opacity-85 hover:opacity-100'
      >
        <FolderOpen className='w-4 h-4 shrink-0' />
        <span>{t('Files')}</span>
      </MenuLink>
    </div>
  )
}
