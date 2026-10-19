/**
 * Agora: the Terms of use (/terms) and the Privacy notice (/privacy).
 *
 * One page for both, readable with or without logging in. The texts are
 * drafts: a box at the top says so, and the open points are listed at the end.
 * The shape of each text is in ./legalTexts.js, the words in the locale files.
 */
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { Link } from 'react-router-dom'
import AgoraLogo from '@/agora/AgoraLogo'
import { LEGAL_PATHS, PRIVACY, TERMS } from './legalTexts'

function Block ({ block, t }) {
  if (block.type === 'p') return <p className='my-3 leading-relaxed'>{t(block.key)}</p>
  return (
    <ul className='list-disc pl-6 my-3 space-y-1.5 leading-relaxed'>
      {block.keys.map(key => <li key={key}>{t(key)}</li>)}
    </ul>
  )
}

export default function LegalPage ({ page = 'terms' }) {
  const { t } = useTranslation()
  const content = page === 'privacy' ? PRIVACY : TERMS
  const otherPage = page === 'privacy' ? 'terms' : 'privacy'
  const otherContent = page === 'privacy' ? TERMS : PRIVACY

  // A link such as /terms#conduct: the section only exists after the page has
  // drawn, so the browser cannot jump there by itself.
  useEffect(() => {
    const id = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    if (!id) return
    const target = document.getElementById(id)
    if (target && target.scrollIntoView) target.scrollIntoView()
  }, [page])

  return (
    <div className='h-full overflow-y-auto bg-background text-foreground' data-testid={`agora-legal-${page}`}>
      <Helmet>
        <title>{`${t(content.title)} | Agora`}</title>
      </Helmet>
      <main className='max-w-2xl mx-auto px-4 py-8 text-base'>
        <Link to='/' className='inline-flex items-center gap-3 text-foreground hover:text-foreground no-underline mb-6'>
          <AgoraLogo className='h-10' />
          <span className='text-xl font-bold'>Agora</span>
        </Link>

        <div role='note' className='rounded-lg border-2 border-amber-500/60 bg-amber-500/15 p-4 mb-6'>
          <p className='font-bold m-0'>{t('agoraLegal.draft')}</p>
          <p className='text-sm m-0 mt-1'>{t('agoraLegal.draftNote')}</p>
        </div>

        <h1 className='text-3xl font-bold mb-1'>{t(content.title)}</h1>
        <p className='text-sm text-foreground/60 mt-0'>{t('agoraLegal.version')}</p>

        {content.sections.map(section => (
          <section key={section.id} id={section.id} className='scroll-mt-4'>
            {section.title && <h2 className='text-xl font-bold mt-8 mb-2'>{t(section.title)}</h2>}
            {section.blocks.map((block, i) => <Block key={i} block={block} t={t} />)}
          </section>
        ))}

        <section id='open-points' className='mt-10 rounded-lg border border-foreground/20 p-4'>
          <h2 className='text-xl font-bold mt-0 mb-2'>{t('agoraLegal.openPoints')}</h2>
          <p className='text-sm my-2'>{t('agoraLegal.openPointsIntro')}</p>
          <ul className='list-disc pl-6 my-2 space-y-1 text-sm'>
            {content.openPoints.map(key => <li key={key}>{t(key)}</li>)}
          </ul>
        </section>

        <nav className='flex flex-wrap gap-x-6 gap-y-2 mt-8 pt-4 border-t border-foreground/20 text-sm'>
          <Link to={LEGAL_PATHS[otherPage]} className='text-focus hover:underline'>{t(otherContent.title)}</Link>
          <Link to='/' className='text-focus hover:underline'>{t('agoraLegal.backToAgora')}</Link>
        </nav>
      </main>
    </div>
  )
}
