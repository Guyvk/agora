/**
 * Agora: the Ask tab of a circle, at /groups/<circle>/ask.
 *
 * Any member asks a question about what goes on in the circle. Infomaniak's
 * AI (in Switzerland) answers only from the circle's own content, with
 * numbered sources. The person's own questions are listed below; nobody
 * else sees them. An answer can be shared in the circle as a discussion.
 * The server decides who may ask what, see apps/backend/lib/agora/ask.js.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { Link, useParams } from 'react-router-dom'
import { Sparkles, Lock, Share2, ExternalLink } from 'lucide-react'
import Button from 'components/ui/button'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import { cn } from 'util/index'
import { askStatus, askHistory, askQuestion, shareAnswer } from './api'

const MAX_QUESTION = 1000

function useSuggestions () {
  const { t } = useTranslation()
  return [
    t('What did we decide last week?'),
    t('Summarise the last meeting'),
    t('Which proposals are open?'),
    t('Who works on which playbook chapter?'),
    t('What is planned for the coming weeks?')
  ]
}

function formatMoment (iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

function formatDay (iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

function SourceLink ({ source, className, children }) {
  if (!source || !source.url) return <span className={className}>{children}</span>
  if (/^https?:\/\//.test(source.url)) {
    return <a href={source.url} target='_blank' rel='noreferrer' className={className}>{children}</a>
  }
  return <Link to={source.url} className={className}>{children}</Link>
}

/** The answer text, with each [n] as a small link to its source. */
export function AnswerText ({ answer, sources }) {
  const byNumber = new Map((sources || []).map(s => [s.n, s]))
  const parts = String(answer || '').split(/(\[\d{1,2}\])/g)
  return (
    <p className='whitespace-pre-wrap text-foreground leading-relaxed' data-testid='ask-answer-text'>
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d{1,2})\]$/)
        if (!m) return <React.Fragment key={i}>{part}</React.Fragment>
        const source = byNumber.get(Number(m[1]))
        return (
          <SourceLink key={i} source={source} className='align-super text-xs font-semibold text-accent hover:underline px-0.5'>
            [{m[1]}]
          </SourceLink>
        )
      })}
    </p>
  )
}

function SourceChips ({ sources }) {
  const { t } = useTranslation()
  if (!sources || !sources.length) return null
  return (
    <ul className='flex flex-wrap gap-2' aria-label={t('Sources')}>
      {sources.map(s => {
        const isTheme = s.type === 'private_theme'
        return (
          <li key={s.n}>
            <SourceLink
              source={s}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs max-w-[280px]',
                isTheme ? 'border-foreground/20 bg-foreground/5 text-foreground/80' : 'border-accent/40 bg-accent/10 text-foreground hover:bg-accent/20'
              )}
            >
              <span className='font-semibold'>{s.n}</span>
              {isTheme && <Lock className='w-3 h-3 shrink-0' />}
              <span className='truncate' data-testid='ask-source-title'>{isTheme ? t('From private conversations (anonymised)') : s.title}</span>
              {!isTheme && s.date && <span className='text-muted-foreground shrink-0'>{formatDay(s.date)}</span>}
            </SourceLink>
          </li>
        )
      })}
    </ul>
  )
}

function AnswerCard ({ question, groupSlug, onShared }) {
  const { t } = useTranslation()
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState(null)
  const sharedId = question.sharedPostId

  const share = async () => {
    setSharing(true)
    setError(null)
    try {
      const result = await shareAnswer(question.id)
      onShared(question.id, result.postId)
    } catch (e) {
      setError(e.message)
    } finally {
      setSharing(false)
    }
  }

  return (
    <article className='bg-card border border-border rounded-lg p-4 flex flex-col gap-3' data-testid='ask-answer'>
      <h2 className='text-base font-semibold text-foreground break-words'>{question.question}</h2>
      {question.status === 'answered'
        ? <AnswerText answer={question.answer} sources={question.sources} />
        : <p className='text-foreground/80'>{t('I could not find anything about this in this circle.')}</p>}
      <SourceChips sources={question.sources} />
      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='text-muted-foreground'>{formatMoment(question.createdAt)}</span>
        {question.status === 'answered' && !sharedId && (
          <Button size='sm' variant='outline' className='ml-auto' onClick={share} disabled={sharing}>
            <Share2 className='w-4 h-4' /> {t('Share this answer in the circle')}
          </Button>
        )}
        {sharedId && (
          <Link to={`/groups/${groupSlug}/post/${sharedId}`} className='ml-auto inline-flex items-center gap-1 text-accent hover:underline'>
            <ExternalLink className='w-4 h-4' /> {t('Shared in the circle: open the post')}
          </Link>
        )}
      </div>
      {error && <p role='alert' className='text-destructive text-sm'>{error}</p>}
    </article>
  )
}

export default function AskPage () {
  const { t } = useTranslation()
  const { groupSlug } = useParams()
  const suggestions = useSuggestions()
  const [status, setStatus] = useState(undefined)
  const [loadError, setLoadError] = useState(null)
  const [history, setHistory] = useState([])
  const [current, setCurrent] = useState(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState(null)

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Ask'), icon: <Sparkles />, info: '', search: false })
  }, [setHeaderDetails, t])

  const load = useCallback(async () => {
    setStatus(undefined)
    setLoadError(null)
    setCurrent(null)
    try {
      const s = await askStatus(groupSlug)
      setStatus(s)
      if (s.enabled) {
        const h = await askHistory(groupSlug)
        setHistory(h.questions || [])
      }
    } catch (e) {
      setLoadError(e.status === 404 ? t('Ask is for members of this circle.') : e.message)
    }
  }, [groupSlug, t])

  useEffect(() => { load() }, [load])

  const ask = async (text) => {
    const value = String(text == null ? question : text).trim()
    if (value.length < 3 || asking) return
    setAsking(true)
    setError(null)
    setQuestion(value)
    try {
      const result = await askQuestion(groupSlug, value)
      setCurrent(result.question)
      setHistory(h => [result.question, ...h.filter(q => q.id !== result.question.id)])
      setQuestion('')
    } catch (e) {
      setError(e.message)
    } finally {
      setAsking(false)
    }
  }

  const onShared = (id, postId) => {
    const mark = q => (q && q.id === id ? { ...q, sharedPostId: postId } : q)
    setCurrent(mark)
    setHistory(h => h.map(mark))
  }

  if (loadError) {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <p role='alert' className='text-center py-12 text-foreground bg-card border border-border rounded-lg'>{loadError}</p>
      </div>
    )
  }
  if (status === undefined) return <Loading />
  if (!status.enabled) {
    return (
      <div className='p-4 max-w-[750px] mx-auto mt-8'>
        <p className='text-center py-12 text-foreground bg-card border border-border rounded-lg'>{t('Ask is not switched on in this Agora.')}</p>
      </div>
    )
  }

  const unavailable = !status.configured
    ? t('Ask is not connected to Infomaniak\'s AI yet.')
    : status.capReached ? t('Ask has used up this month\'s budget. It works again next month.') : null
  const earlier = history.filter(q => !current || q.id !== current.id)

  return (
    <div className='p-4 w-full max-w-[750px] mx-auto flex flex-col gap-4'>
      <Helmet>
        <title>{t('Ask')} | {status.groupName || ''} | Agora</title>
      </Helmet>

      <p className='text-foreground/80'>
        {t('Ask anything about what goes on in {{circle}}: decisions, meetings, proposals, events, the playbook and files. The answer only uses what members of this circle can see, and links to where it comes from.', { circle: status.groupName })}
      </p>

      <form
        className='flex flex-col gap-2'
        onSubmit={e => { e.preventDefault(); ask() }}
      >
        <label htmlFor='agora-ask-question' className='sr-only'>{t('Your question')}</label>
        <textarea
          id='agora-ask-question'
          value={question}
          maxLength={MAX_QUESTION}
          rows={3}
          disabled={!!unavailable || asking}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
          placeholder={t('For example: What did we decide last week?')}
          className='w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        />
        <div className='flex flex-wrap items-center gap-2'>
          <p className='text-xs text-muted-foreground flex-1 min-w-[200px]' data-testid='ask-notice'>
            {t('Your question and this circle\'s content go to Infomaniak\'s AI in Switzerland to write the answer.')}
          </p>
          <Button type='submit' disabled={!!unavailable || asking || question.trim().length < 3}>
            <Sparkles className='w-4 h-4' /> {asking ? t('Thinking...') : t('Ask')}
          </Button>
        </div>
      </form>

      {unavailable && <p role='status' className='bg-card border border-border rounded-lg p-3 text-foreground'>{unavailable}</p>}
      {error && <p role='alert' className='text-destructive'>{error}</p>}

      {!current && !unavailable && (
        <div className='flex flex-col gap-2'>
          <h2 className='text-sm font-medium text-muted-foreground'>{t('Try one of these')}</h2>
          <ul className='flex flex-wrap gap-2'>
            {suggestions.map(s => (
              <li key={s}>
                <button
                  type='button'
                  onClick={() => ask(s)}
                  disabled={asking}
                  className='rounded-full border border-foreground/20 bg-card px-3 py-1 text-sm text-foreground hover:border-foreground/50'
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {current && <AnswerCard question={current} groupSlug={groupSlug} onShared={onShared} />}

      {earlier.length > 0 && (
        <section className='flex flex-col gap-3 mt-4'>
          <div>
            <h2 className='text-lg font-semibold text-foreground'>{t('Your earlier questions')}</h2>
            <p className='text-xs text-muted-foreground flex items-center gap-1'><Lock className='w-3 h-3' /> {t('Only you can see these.')}</p>
          </div>
          {earlier.map(q => <AnswerCard key={q.id} question={q} groupSlug={groupSlug} onShared={onShared} />)}
        </section>
      )}
    </div>
  )
}
