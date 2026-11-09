// Agora: "3 replies, last 10 minutes ago" with small avatars, under a chat message that has replies.
// Clicking it opens the thread panel beside the chat.
import React from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircle } from 'lucide-react'
import Avatar from 'components/Avatar'
import { getLocaleFromLocalStorage } from 'util/locale'
import relativeTime from './relativeTime'

export default function ThreadSummary ({ post, onOpen }) {
  const { t } = useTranslation()
  const count = post.commentsTotal || 0
  if (count < 1) return null

  // Fresh list from the live event wins, else the first repliers the server sent with the message
  const repliers = (post.chatThreadRepliers?.length ? post.chatThreadRepliers : (post.commenters || [])).slice(0, 3)
  const ago = post.lastCommentAt ? relativeTime(post.lastCommentAt, getLocaleFromLocalStorage()) : ''
  const label = ago
    ? t('agoraChat.threadSummary', { count, ago })
    : t('agoraChat.threadSummaryNoTime', { count })

  return (
    <button
      type='button'
      data-testid='thread-summary'
      onClick={(event) => { event.stopPropagation(); onOpen() }}
      className='ChatPost_commenters inline-flex items-center gap-1.5 min-h-[26px] px-2.5 rounded-full bg-foreground/5 border border-foreground/10 cursor-pointer hover:bg-foreground/10 transition-colors'
    >
      {repliers.length > 0
        ? (
          <span className='flex -space-x-1.5'>
            {repliers.map(person => (
              <Avatar key={person.id} avatarUrl={person.avatarUrl} tiny className='rounded-full ring-1 ring-background' />
            ))}
          </span>
          )
        : <MessageCircle className='w-3 h-3 text-foreground/60 shrink-0' />}
      <span className='text-xs font-semibold text-foreground/70 leading-none'>{label}</span>
    </button>
  )
}
