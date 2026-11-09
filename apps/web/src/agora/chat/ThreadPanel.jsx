// Agora: the thread panel beside the chat. Shows the original message, its replies
// (Hylo comments on the chat post) and a reply box. Opens from "Reply" and from the
// "3 replies" counter under a message. On a phone it fills the screen, with a back button.
import React, { useEffect, useMemo } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { DateTimeHelpers } from '@hylo/shared'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import Avatar from 'components/Avatar'
import CardImageAttachments from 'components/CardImageAttachments'
import HyloHTML from 'components/HyloHTML'
import Loading from 'components/Loading'
import SocketSubscriber from 'components/SocketSubscriber'
import Comments from 'routes/PostDetail/Comments'
import fetchPost from 'store/actions/fetchPost'
import presentPost from 'store/presenters/presentPost'
import getPost from 'store/selectors/getPost'
import { getLocaleFromLocalStorage } from 'util/locale'

export default function ThreadPanel ({ postId, group, onClose }) {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const postModel = useSelector(state => getPost(state, postId))
  const post = useMemo(() => (postModel ? presentPost(postModel, group?.id) : null), [postModel, group?.id])

  // Comments come with the post, as in the post pop-up
  useEffect(() => {
    if (postId) dispatch(fetchPost(postId, { withComments: true }))
  }, [dispatch, postId])

  return (
    <aside
      data-testid='thread-panel'
      aria-label={t('agoraChat.thread')}
      className='absolute top-0 right-0 bottom-0 z-40 w-full sm:w-[420px] flex flex-col bg-background border-l border-foreground/10 shadow-xl'
    >
      <div className='shrink-0 flex items-center gap-2 px-3 py-2 border-b border-foreground/10'>
        <button type='button' onClick={onClose} aria-label={t('agoraChat.backToChat')} className='sm:hidden p-1 rounded hover:bg-foreground/10'>
          <ArrowLeft className='w-5 h-5' />
        </button>
        <div className='font-bold grow'>{t('agoraChat.thread')}</div>
        <button type='button' onClick={onClose} aria-label={t('agoraChat.closeThread')} data-testid='thread-close' className='max-sm:hidden p-1 rounded hover:bg-foreground/10'>
          <X className='w-5 h-5' />
        </button>
      </div>
      <div className='grow min-h-0 overflow-y-auto pb-4'>
        {!post
          ? <div className='p-6'><Loading /></div>
          : (
            <>
              <div className='px-4 pt-3 pb-3 border-b border-foreground/10 relative' data-testid='thread-original'>
                <div className='flex items-center gap-2 mb-1'>
                  <Avatar avatarUrl={post.creator?.avatarUrl} personId={post.creator?.id} medium />
                  <div className='font-bold'>{post.creator?.name}</div>
                  <div className='text-xs text-foreground/50'>
                    {DateTimeHelpers.toDateTime(post.createdAt, { locale: getLocaleFromLocalStorage() }).toFormat('D t')}
                  </div>
                </div>
                <HyloHTML className='break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0' html={post.details} />
                <CardImageAttachments attachments={post.attachments} forChatPost className='min-w-0' />
              </div>
              <Comments post={post} slug={group?.slug} />
              <SocketSubscriber type='post' id={post.id} />
            </>
            )}
      </div>
    </aside>
  )
}
