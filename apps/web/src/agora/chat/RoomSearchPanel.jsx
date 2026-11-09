// Agora: search inside this room only. Sends the search to the same posts query the
// chat list uses, for this room's circle and chat messages only, so rooms the reader
// cannot see are never searched. Clicking a result jumps to that message in the stream.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import { DateTimeHelpers, TextHelpers } from '@hylo/shared'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import Avatar from 'components/Avatar'
import fetchPosts from 'store/actions/fetchPosts'
import { getLocaleFromLocalStorage } from 'util/locale'

/** The query this panel sends: this room's circle, chat messages only, newest first. */
export const roomSearchParams = (groupSlug, term) => ({
  context: 'groups',
  slug: groupSlug,
  search: term,
  filter: 'chat',
  childPostInclusion: 'no',
  includePostGroups: false,
  fieldsVariant: 'chatRoom',
  sortBy: 'id',
  order: 'desc',
  first: 30
})

export default function RoomSearchPanel ({ group, onClose, onPick }) {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const inputRef = useRef(null)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const latest = useRef(0)

  useEffect(() => { inputRef.current?.focus() }, [])

  const runSearch = useCallback(async (value) => {
    const trimmed = value.trim()
    const ticket = ++latest.current
    if (!trimmed || !group?.slug) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    try {
      const action = await dispatch(fetchPosts(roomSearchParams(group.slug, trimmed)))
      if (ticket !== latest.current) return
      setResults(action?.payload?.data?.group?.posts?.items || [])
    } catch (e) {
      if (ticket === latest.current) setResults([])
    } finally {
      if (ticket === latest.current) setSearching(false)
    }
  }, [dispatch, group?.slug])

  // Wait for a pause in typing so each key press does not hit the server
  useEffect(() => {
    const timer = setTimeout(() => runSearch(term), 300)
    return () => clearTimeout(timer)
  }, [term, runSearch])

  return (
    <aside
      data-testid='room-search-panel'
      aria-label={t('agoraChat.searchRoom')}
      className='absolute top-0 right-0 bottom-0 z-40 w-full sm:w-[420px] flex flex-col bg-background border-l border-foreground/10 shadow-xl'
    >
      <div className='shrink-0 flex items-center gap-2 px-3 py-2 border-b border-foreground/10'>
        <button type='button' onClick={onClose} aria-label={t('agoraChat.backToChat')} className='sm:hidden p-1 rounded hover:bg-foreground/10'>
          <ArrowLeft className='w-5 h-5' />
        </button>
        <Search className='w-4 h-4 text-foreground/50 shrink-0' />
        <input
          ref={inputRef}
          type='search'
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder={t('agoraChat.searchPlaceholder', { room: group?.name || '' })}
          data-testid='room-search-input'
          className='grow bg-transparent outline-none text-sm py-1'
        />
        <button type='button' onClick={onClose} aria-label={t('agoraChat.closeSearch')} className='max-sm:hidden p-1 rounded hover:bg-foreground/10'>
          <X className='w-5 h-5' />
        </button>
      </div>
      <div className='grow min-h-0 overflow-y-auto'>
        {searching && <div className='p-4 text-sm text-foreground/50'>{t('agoraChat.searching')}</div>}
        {!searching && results && results.length === 0 && (
          <div className='p-4 text-sm text-foreground/60' data-testid='room-search-empty'>{t('agoraChat.noResults')}</div>
        )}
        {(results || []).map(post => (
          <button
            key={post.id}
            type='button'
            data-testid='room-search-result'
            onClick={() => onPick(post)}
            className='block w-full text-left px-4 py-3 border-b border-foreground/5 hover:bg-foreground/5'
          >
            <div className='flex items-center gap-2 mb-1'>
              <Avatar avatarUrl={post.creator?.avatarUrl} tiny />
              <span className='font-semibold text-sm'>{post.creator?.name}</span>
              <span className='text-xs text-foreground/50'>
                {DateTimeHelpers.toDateTime(post.createdAt, { locale: getLocaleFromLocalStorage() }).toFormat('D t')}
              </span>
            </div>
            <div className='text-sm text-foreground/80 line-clamp-3 break-words'>
              {TextHelpers.presentHTMLToText(post.details || '', { truncate: 240 })}
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
