/**
 * Agora: the Ask line in a circle's menu, next to the Playbook line.
 *
 * It shows only when Ask is switched on in this Agora and the person is a
 * member of the circle (the server says so).
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import MenuLink from 'routes/AuthLayoutRouter/components/ContextMenu/MenuLink'
import { askStatus, ASK_URL } from './api'

export default function AskMenuLink ({ groupSlug }) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)

  useEffect(() => {
    let stopped = false
    setShow(false)
    if (!groupSlug) return
    askStatus(groupSlug)
      .then(status => { if (!stopped) setShow(!!status.enabled) })
      .catch(() => { if (!stopped) setShow(false) })
    return () => { stopped = true }
  }, [groupSlug])

  if (!show) return null
  return (
    <div className='px-1.5 pb-2 border-t border-foreground/10 pt-2'>
      <MenuLink
        to={ASK_URL(groupSlug)}
        data-testid='agora-ask-menu-link'
        className='flex items-center gap-2 text-base font-medium text-foreground hover:text-foreground border-2 border-transparent hover:border-foreground/50 hover:bg-card rounded-md p-1 pl-2 w-full transition-all opacity-85 hover:opacity-100'
      >
        <Sparkles className='w-4 h-4 shrink-0' />
        <span>{t('Ask')}</span>
      </MenuLink>
    </div>
  )
}
