/**
 * Agora: the Guide in the Help window, the first thing people see in Help.
 *
 * A search box and the parts of the guide as a short list. Clicking a part
 * shows what it says, with a link to the same part on the full guide page.
 * Below: "Still stuck? Tell us", which leads to the form or the chat.
 * The parts and their texts are shared with the guide page, see
 * ../guide/guideParts.jsx.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search } from 'lucide-react'
import Button from 'components/ui/button'
import { cn } from 'util/index'
import { GUIDE_PARTS, GuidePartBody, guidePartUrl, guidePartWords } from '../guide/guideParts'
import useAgoraSeen, { GUIDE_READ } from '../guide/useAgoraSeen'
import useMyCircle from '../guide/useMyCircle'
import { fieldClasses } from './HelpWindow'

/** The parts whose title or text hold every word of the search. */
export function searchGuide (t, query) {
  const words = (query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return GUIDE_PARTS
  return GUIDE_PARTS.filter(part => {
    const text = guidePartWords(t, part).toLowerCase()
    return words.every(word => text.includes(word))
  })
}

/**
 * `part` is the id of the part to show, or null for the list. `onPart` changes
 * it. `onAsk` goes to the form or chat, `onNavigate` runs when a link leaves the window.
 */
export default function HelpGuide ({ part, onPart, onAsk, onNavigate }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const circle = useMyCircle()
  const { me, markSeen } = useAgoraSeen()
  const shown = part && GUIDE_PARTS.find(p => p.id === part)

  // Reading a part here also counts as reading the guide, for the welcome steps
  const meId = me && me.id
  useEffect(() => { if (meId && shown) markSeen(GUIDE_READ) }, [meId, shown]) // eslint-disable-line react-hooks/exhaustive-deps

  const stillStuck = (
    <div className='flex flex-col gap-2 border-t border-border pt-3'>
      <Button size='sm' variant='outline' onClick={onAsk}>{t('Still stuck? Tell us')}</Button>
    </div>
  )

  if (shown) {
    const Icon = shown.icon
    return (
      <div className='flex flex-col gap-3' data-testid='help-guide-part'>
        <button type='button' onClick={() => onPart(null)} className='self-start flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'>
          <ArrowLeft className='w-4 h-4' /> {t('Back to the guide')}
        </button>
        <h3 className='flex items-center gap-2 font-semibold text-foreground m-0'>
          <Icon className='w-4 h-4 shrink-0 text-accent' aria-hidden='true' /> {t(shown.title)}
        </h3>
        <div className='flex flex-col gap-2 text-sm text-foreground/90 leading-relaxed'>
          <GuidePartBody part={shown} circle={circle} onNavigate={onNavigate} />
        </div>
        <Link to={guidePartUrl(shown.id)} onClick={onNavigate} className='self-start text-sm underline text-muted-foreground hover:text-foreground'>
          {t('Open the full guide')}
        </Link>
        {stillStuck}
      </div>
    )
  }

  const parts = searchGuide(t, query)
  return (
    <div className='flex flex-col gap-3'>
      <div className='relative'>
        <Search className='w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground' aria-hidden='true' />
        <input
          type='search'
          aria-label={t('Search the guide')}
          placeholder={t('Search the guide')}
          className={cn(fieldClasses, 'h-9 pl-9')}
          value={query}
          maxLength={200}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      {parts.length === 0
        ? <p className='text-sm text-muted-foreground'>{t('Nothing in the guide matches. Tell us what you are looking for.')}</p>
        : (
          <ul className='flex flex-col' aria-label={t('Agora guide')}>
            {parts.map(p => {
              const Icon = p.icon
              return (
                <li key={p.id}>
                  <button type='button' onClick={() => onPart(p.id)} className='w-full text-left py-2 border-b border-border last:border-b-0 hover:bg-selected/40 flex items-center gap-2 text-sm text-foreground'>
                    <Icon className='w-4 h-4 shrink-0 text-accent' aria-hidden='true' /> {t(p.title)}
                  </button>
                </li>
              )
            })}
          </ul>
          )}
      {stillStuck}
    </div>
  )
}
