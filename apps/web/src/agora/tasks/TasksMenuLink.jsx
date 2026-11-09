/**
 * Agora: the Tasks line in a circle's menu, next to the Files line. It opens the circle's Tasks
 * page (CircleTasksPage) inside the app. It shows for members of the circle only; the page and
 * its calls check membership again on the server.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks } from 'lucide-react'
import MenuLink from 'routes/AuthLayoutRouter/components/ContextMenu/MenuLink'
import { circleTasksUrl } from './api'

export default function TasksMenuLink ({ groupSlug, isMember }) {
  const { t } = useTranslation()
  if (!groupSlug || !isMember) return null
  return (
    <div className='px-1.5 pb-2 border-t border-foreground/10 pt-2'>
      <MenuLink
        to={circleTasksUrl(groupSlug)}
        data-testid='agora-tasks-menu-link'
        className='flex items-center gap-2 text-base font-medium text-foreground hover:text-foreground border-2 border-transparent hover:border-foreground/50 hover:bg-card rounded-md p-1 pl-2 w-full transition-all opacity-85 hover:opacity-100'
      >
        <ListChecks className='w-4 h-4 shrink-0' />
        <span>{t('Tasks')}</span>
      </MenuLink>
    </div>
  )
}
