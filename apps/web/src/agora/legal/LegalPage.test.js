import React from 'react'
import fs from 'fs'
import path from 'path'
import { render, screen } from 'util/testing/reactTestingLibraryExtended'
import LegalPage from './LegalPage'
import { PRIVACY, SHARED_KEYS, TERMS, allKeys } from './legalTexts'

const webRoot = path.resolve(__dirname, '../../..')
const en = JSON.parse(fs.readFileSync(path.join(webRoot, 'public/locales/en.json'), 'utf8'))

describe('Agora Terms of use and Privacy notice', () => {
  it('shows the terms as a draft, with every section and the open points', () => {
    render(<LegalPage page='terms' />)
    expect(screen.getByText('agoraLegal.draft')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'agoraTerms.title' })).toBeInTheDocument()
    expect(screen.getByText('agoraTerms.conduct.title').closest('section').id).toBe('conduct')
    expect(screen.getByText('agoraTerms.open.1')).toBeInTheDocument()
    expect(screen.getByText('agoraPrivacy.title').closest('a').getAttribute('href')).toBe('/privacy')
  })

  it('shows the privacy notice as a draft', () => {
    render(<LegalPage page='privacy' />)
    expect(screen.getByText('agoraLegal.draft')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'agoraPrivacy.title' })).toBeInTheDocument()
    expect(screen.getByText('agoraPrivacy.meetings.title')).toBeInTheDocument()
    expect(screen.getByText('agoraPrivacy.open.12')).toBeInTheDocument()
    expect(screen.getByText('agoraTerms.title').closest('a').getAttribute('href')).toBe('/terms')
  })

  it('has an English text for every key, and no long dashes', () => {
    const keys = [...SHARED_KEYS, ...allKeys(TERMS), ...allKeys(PRIVACY)]
    expect(keys.filter(key => !en[key])).toEqual([])
    expect(keys.filter(key => /[–—]/.test(en[key]))).toEqual([])
    expect(en['agoraLegal.draft']).toBe('Draft, to be approved by 7BP')
  })

  it('no longer sends people to the terms, privacy or agreements of hylo.com', () => {
    const files = [
      'src/routes/NonAuthLayoutRouter/NonAuthLayoutRouter.js',
      'src/routes/OAuth/OAuthLayoutRouter.js',
      'src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx',
      'src/routes/AuthLayoutRouter/components/TopNav/TopNav.jsx',
      'src/routes/NonAuthLayoutRouter/Signup/Agreements/Agreements.js',
      'src/store/constants.js'
    ]
    files.forEach(file => {
      const source = fs.readFileSync(path.join(webRoot, file), 'utf8')
      expect([file, /hylo\.com\/(terms|privacy|agreements)/.test(source)]).toEqual([file, false])
    })
  })
})
