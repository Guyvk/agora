/**
 * Agora: the Build page. The public GitHub board "Agora build" for the Tech Support
 * circle: four columns, "Went live", new Help desk requests, a side panel for one card
 * and a "Move to" menu on each card. The server does all the talking to GitHub.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { buildApi, minutesAgo } from './api'

const COLUMN_LABELS = { 'To do': 'To do', Doing: 'Doing', 'In review': 'In review', Live: 'Live' }

function PrBadges ({ prs, t }) {
  const label = { draft: t('Draft pull request'), open: t('Open pull request'), merged: t('Merged pull request'), closed: t('Closed pull request') }
  return (
    <>
      {prs.map(p => (
        <span key={p.number} className='text-xs rounded border border-foreground/20 px-1' data-testid='build-pr-badge'>
          {label[p.state]} #{p.number}
        </span>
      ))}
    </>
  )
}

function Card ({ card, onOpen, onMove, busy, t }) {
  return (
    <li className='bg-card border border-foreground/10 rounded-md p-2 flex flex-col gap-1' data-testid={`build-card-${card.number}`}>
      <button type='button' className='text-left text-sm font-medium bg-transparent border-0 p-0 cursor-pointer text-foreground' onClick={() => onOpen(card)}>
        #{card.number} {card.title}
      </button>
      {(card.owner || card.circle) && (
        <div className='text-xs text-muted-foreground'>
          {card.owner && <span>{t('Owner')}: {card.owner}</span>}
          {card.owner && card.circle && ' · '}
          {card.circle && <span>{t('Circle')}: {card.circle}</span>}
        </div>
      )}
      <div className='flex flex-wrap gap-1'><PrBadges prs={card.prs} t={t} /></div>
      {card.mergedGoesLive && <div className='text-xs'>{t('Merged, goes live at the next update')}</div>}
      <label className='text-xs flex items-center gap-1'>
        <span>{t('Move to')}</span>
        <select
          value={card.status}
          disabled={busy}
          aria-label={`${t('Move to')} #${card.number}`}
          onChange={e => onMove(card, e.target.value)}
          className='text-xs bg-background border border-foreground/20 rounded'
        >
          {Object.keys(COLUMN_LABELS).map(name => <option key={name} value={name}>{t(COLUMN_LABELS[name])}</option>)}
        </select>
      </label>
    </li>
  )
}

function SidePanel ({ card, onClose, t }) {
  return (
    <aside className='border border-foreground/10 rounded-md p-3 bg-card flex flex-col gap-2' data-testid='build-side-panel'>
      <div className='flex justify-between gap-2'>
        <h3 className='m-0 text-base'>#{card.number} {card.title}</h3>
        <button type='button' onClick={onClose} aria-label={t('Close')} className='bg-transparent border-0 cursor-pointer text-foreground'>×</button>
      </div>
      <pre className='whitespace-pre-wrap text-sm m-0 font-sans'>{card.body || t('No description.')}</pre>
      {card.prs.length > 0 && (
        <div className='text-sm'>
          <div className='font-medium'>{t('Pull requests')}</div>
          <ul className='m-0 pl-4'>
            {card.prs.map(p => (
              <li key={p.number}><a href={p.url} target='_blank' rel='noopener noreferrer'>#{p.number}</a> ({p.state})</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}

export default function BuildPage () {
  const { t } = useTranslation()
  const [board, setBoard] = useState(null)
  const [error, setError] = useState(null)
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [openCard, setOpenCard] = useState(null)

  const load = useCallback(async (refresh) => {
    setError(null)
    try {
      setBoard(await buildApi('/board' + (refresh ? '?refresh=1' : '')))
    } catch (e) {
      if (e.status === 401 || e.status === 403) setDenied(true)
      else setError(e.message)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  const move = async (card, status) => {
    if (status === card.status) return
    setBusy(true); setError(null)
    try {
      setBoard(await buildApi('/move', { itemId: card.itemId, status }))
      setOpenCard(null)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  if (denied) return <div className='p-4' data-testid='build-denied'>{t('The Build page is not open to you.')}</div>
  if (!board && !error) return <div className='p-4'>{t('Loading the board…')}</div>
  if (!board) return <div className='p-4' role='alert'>{error}</div>

  if (!board.configured) {
    return (
      <div className='p-4 flex flex-col gap-2' data-testid='build-not-connected'>
        <p>{t('The board is not connected yet.')}</p>
        <a href={board.boardUrl} target='_blank' rel='noopener noreferrer'>{t('Open the board on GitHub')}</a>
      </div>
    )
  }

  return (
    <div className='p-4 flex flex-col gap-4 w-full max-w-full overflow-auto' data-testid='build-page'>
      <h2 className='m-0'>{t('Build')}</h2>
      {error && <div role='alert' className='text-sm text-destructive'>{error}</div>}
      {board.warning && <div className='text-sm' data-testid='build-warning'>{t('GitHub could not be reached, so this may be out of date.')}</div>}

      <div className='flex gap-4 items-start flex-wrap'>
        <div className='grid gap-3 grid-cols-1 md:grid-cols-4 flex-1 min-w-0'>
          {board.columns.map(col => (
            <section key={col.name} data-testid={`build-column-${col.name}`}>
              <h3 className='text-sm m-0 mb-2'>{t(COLUMN_LABELS[col.name])} ({col.cards.length})</h3>
              <ul className='list-none p-0 m-0 flex flex-col gap-2'>
                {col.cards.map(c => <Card key={c.itemId} card={c} onOpen={setOpenCard} onMove={move} busy={busy} t={t} />)}
              </ul>
            </section>
          ))}
        </div>
        {openCard && <div className='w-full md:w-80'><SidePanel card={openCard} onClose={() => setOpenCard(null)} t={t} /></div>}
      </div>

      <section data-testid='build-went-live'>
        <h3 className='text-sm m-0 mb-2'>{t('Went live in the last 14 days')}</h3>
        {board.wentLive.length === 0
          ? <p className='text-sm m-0'>{t('Nothing yet.')}</p>
          : <ul className='m-0 pl-4 text-sm'>{board.wentLive.map(c => <li key={c.number}>#{c.number} {c.title} ({new Date(c.date).toLocaleDateString()})</li>)}</ul>}
      </section>

      <section data-testid='build-help-desk'>
        <h3 className='text-sm m-0 mb-2'>{t('New from the Help desk')}</h3>
        {board.helpDesk.length === 0
          ? <p className='text-sm m-0'>{t('Nothing new.')}</p>
          : (
            <ul className='m-0 pl-4 text-sm'>
              {board.helpDesk.map(r => (
                <li key={r.id}>
                  #{r.id} {r.type} ({r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''})
                  {board.canOpenHelpDesk && <> <Link to={`/admin/help-desk/${r.id}`}>{t('Open the Help desk')}</Link></>}
                </li>
              ))}
            </ul>)}
      </section>

      <footer className='text-sm flex gap-3 items-center flex-wrap' data-testid='build-footer'>
        <span>{t('Updated {{n}} minutes ago', { n: minutesAgo(board.fetchedAt) })}</span>
        <button type='button' onClick={() => load(true)} disabled={busy}>{t('Refresh')}</button>
        <a href={board.boardUrl} target='_blank' rel='noopener noreferrer'>{t('Open the board on GitHub')}</a>
      </footer>
    </div>
  )
}
