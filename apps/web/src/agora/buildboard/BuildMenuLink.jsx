/**
 * Agora: the Build line in the menu of the one circle set in AGORA_BUILD_CIRCLE.
 * It shows only when the server says this person may open the page for this circle.
 * It opens the Build page inside the app, in the same page.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Hammer } from 'lucide-react'
import MenuLink from 'routes/AuthLayoutRouter/components/ContextMenu/MenuLink'
import { loadAccess } from './api'

export const BUILD_URL = groupSlug => `/groups/${encodeURIComponent(groupSlug)}/build`

export default function BuildMenuLink ({ groupSlug }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let cancelled = false
    setShown(false)
    if (!groupSlug) return undefined
    loadAccess().then(a => { if (!cancelled) setShown(Boolean(a && a.allowed && a.circle === groupSlug)) })
    return () => { cancelled = true }
  }, [groupSlug])

  if (!shown) return null
  return (
    <div className='px-1.5 pb-2 border-t border-foreground/10 pt-2'>
      <MenuLink
        to={BUILD_URL(groupSlug)}
        data-testid='agora-build-menu-link'
        className='flex items-center gap-2 text-base font-medium text-foreground hover:text-foreground border-2 border-transparent hover:border-foreground/50 hover:bg-card rounded-md p-1 pl-2 w-full transition-all opacity-85 hover:opacity-100'
      >
        <Hammer className='w-4 h-4 shrink-0' />
        <span>{t('Build')}</span>
      </MenuLink>
    </div>
  )
}
