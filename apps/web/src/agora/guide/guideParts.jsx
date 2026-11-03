/**
 * Agora: the parts of the guide, shared by the guide page (GuidePage.jsx) and
 * the Guide in the Help window (../help/HelpGuide.jsx).
 *
 * What the parts say lives in guideParts.json, as English keys of the
 * language files. The server reads the same file to give Claude in Help the
 * guide (apps/backend/lib/agora/helpClaude.js). To change the guide, change
 * guideParts.json and the language files; nothing else.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { BellIcon, BookOpen, BookUser, CalendarDays, FolderOpen, LifeBuoy, MessageSquare, ScrollText, Sparkles, UserRound, Users } from 'lucide-react'
import { openHelp } from '../help/openHelp'
import { GUIDE_URL } from './guideUrl'
import guide from './guideParts.json'

const ICONS = { BellIcon, BookOpen, BookUser, CalendarDays, FolderOpen, LifeBuoy, MessageSquare, ScrollText, Sparkles, UserRound, Users }

export const GUIDE_INTRO = guide.intro

/** The parts in order: { id, icon, title, blocks }. The title is an English key. */
export const GUIDE_PARTS = guide.parts.map(part => ({ ...part, icon: ICONS[part.icon] || BookOpen }))

export function guidePartUrl (id) {
  return `${GUIDE_URL}#${id}`
}

/** All the words of a part in the reader's language, for searching. */
export function guidePartWords (t, part) {
  const words = [t(part.title)]
  part.blocks.forEach(block => {
    ['text', 'strong', 'soon'].forEach(kind => { if (block[kind]) words.push(t(block[kind])) })
    if (block.list) block.list.forEach(item => words.push(t(item)))
  })
  return words.join(' ')
}

function ComingSoon ({ children }) {
  const { t } = useTranslation()
  return (
    <p className='rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground' data-testid='guide-coming-soon'>
      <span className='font-semibold'>{t('Coming soon')}:</span> {children}
    </p>
  )
}

function GoTo ({ to, onNavigate, children }) {
  return <Link to={to} onClick={onNavigate} className='self-start text-sm font-medium text-accent hover:underline'>{children}</Link>
}

/** A link block, where $circle stands for the member's own circle. Null when it does not apply. */
function linkFor (block, circle) {
  if (!block.link.startsWith('$circle')) return { to: block.link, label: block.label }
  if (circle) return { to: block.link.replace('$circle', `/groups/${circle.slug}`), label: block.label, values: { name: circle.name } }
  return block.otherwise ? linkFor(block.otherwise, circle) : null
}

/**
 * What one part says. `circle` is the member's first circle (or null), for the
 * links to it. `onNavigate` runs when a link is followed, so the Help window can close.
 */
export function GuidePartBody ({ part, circle, onNavigate }) {
  const { t } = useTranslation()
  const renderLink = (block, key) => {
    const link = linkFor(block, circle)
    return link && <GoTo key={key} to={link.to} onNavigate={onNavigate}>{t(link.label, link.values)}</GoTo>
  }
  return part.blocks.map((block, i) => {
    if (block.text) return <p key={i}>{t(block.text)}</p>
    if (block.strong) return <p key={i} className='font-medium'>{t(block.strong)}</p>
    if (block.soon) return <ComingSoon key={i}>{t(block.soon)}</ComingSoon>
    if (block.list) return <ul key={i} className='list-disc pl-5 flex flex-col gap-1'>{block.list.map(item => <li key={item}>{t(item)}</li>)}</ul>
    if (block.link) return renderLink(block, i)
    if (block.links) return <div key={i} className='flex flex-wrap gap-4'>{block.links.map((l, j) => renderLink(l, j))}</div>
    if (block.openHelp) {
      return (
        <button key={i} type='button' onClick={() => openHelp({ view: block.openHelp })} className='self-start text-sm font-medium text-accent hover:underline'>
          {t(block.label)}
        </button>
      )
    }
    return null
  })
}
