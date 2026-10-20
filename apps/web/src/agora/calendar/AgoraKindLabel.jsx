import React from 'react'
import { useTranslation } from 'react-i18next'
import { agoraKindOf, MEETING } from './api'

/**
 * Agora: the word for an event post on its card and page: "Meeting" or
 * "Event", and a small "All of 7BP" mark when it is for everyone.
 */
export default function AgoraKindLabel ({ post }) {
  const { t } = useTranslation()
  const kind = agoraKindOf(post)
  if (!kind) return null
  return (
    <>
      <span data-testid={`agora-kind-label-${kind}`}>{kind === MEETING ? t('Meeting') : t('Event')}</span>
      {post.agoraForAll && (
        <span className='ml-1 normal-case rounded bg-selected/20 px-1 text-[10px] font-bold text-foreground/80' data-testid='agora-for-all-label'>
          {t('All of 7BP')}
        </span>
      )}
    </>
  )
}
