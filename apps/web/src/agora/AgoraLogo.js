import React from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Agora: the 7 Billion Presidents mark. It is drawn as a mask over the text
 * colour, so it stays readable in the light and the dark theme.
 */
export default function AgoraLogo ({ className = 'h-10' }) {
  const { t } = useTranslation()
  return (
    <span
      role='img'
      aria-label={t('Hylo logo')}
      className={`inline-block bg-foreground aspect-[324/396] ${className}`}
      style={{
        WebkitMask: 'url(/agora-7bp-logo.png) center / contain no-repeat',
        mask: 'url(/agora-7bp-logo.png) center / contain no-repeat'
      }}
    />
  )
}
