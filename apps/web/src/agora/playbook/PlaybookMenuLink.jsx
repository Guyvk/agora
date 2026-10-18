/**
 * Agora: the Playbook line in a group's menu, above More Spaces.
 *
 * It shows when the group has playbook chapters, or when the person is a
 * steward who can add the first one, so circles without a playbook keep a
 * clean menu.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import MenuLink from 'routes/AuthLayoutRouter/components/ContextMenu/MenuLink'
import { playbookApi, PLAYBOOK_URL } from './api'

const MENU_QUERY = `query AgoraPlaybookMenu ($groupSlug: String) {
  agoraPlaybook(groupSlug: $groupSlug) { canEdit chapters { id } }
}`

export default function PlaybookMenuLink ({ groupSlug }) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)

  useEffect(() => {
    let stopped = false
    setShow(false)
    if (!groupSlug) return
    playbookApi(MENU_QUERY, { groupSlug })
      .then(data => {
        const playbook = data.agoraPlaybook
        if (!stopped) setShow(!!playbook && (playbook.canEdit || playbook.chapters.length > 0))
      })
      .catch(() => { if (!stopped) setShow(false) })
    return () => { stopped = true }
  }, [groupSlug])

  if (!show) return null
  return (
    <div className='px-1.5 pb-2 border-t border-foreground/10 pt-2'>
      <MenuLink
        to={PLAYBOOK_URL(groupSlug)}
        data-testid='agora-playbook-menu-link'
        className='flex items-center gap-2 text-base font-medium text-foreground hover:text-foreground border-2 border-transparent hover:border-foreground/50 hover:bg-card rounded-md p-1 pl-2 w-full transition-all opacity-85 hover:opacity-100'
      >
        <BookOpen className='w-4 h-4 shrink-0' />
        <span>{t('Playbook')}</span>
      </MenuLink>
    </div>
  )
}
