import React from 'react'
import { render, screen, fireEvent } from 'util/testing/reactTestingLibraryExtended'
import AgoraCookieNotice from './AgoraCookieNotice'
import CookiePreferencesPanel from 'components/CookiePreferencesPanel'
import Login from 'routes/NonAuthLayoutRouter/Login/Login'

jest.mock('contexts/CookieConsentContext', () => ({
  ...jest.requireActual('contexts/CookieConsentContext'),
  useCookieConsent: () => ({
    showPreferencesPanel: true,
    hidePreferences: jest.fn(),
    updateCookieConsent: jest.fn(() => Promise.resolve(true))
  })
}))

describe('Agora cookie notice', () => {
  it('names no tracking or support service and has no switches', () => {
    render(<CookiePreferencesPanel />)
    expect(screen.getByText(/no tracking, no advertising and no support chat/)).toBeInTheDocument()
    expect(screen.queryByText(/Mixpanel/)).toBeNull()
    expect(screen.queryByText(/Intercom/)).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('saves "no analytics, no support" when the button is pressed', () => {
    const onAccept = jest.fn()
    render(<AgoraCookieNotice onAccept={onAccept} />)
    fireEvent.click(screen.getByText('Got it'))
    expect(onAccept).toHaveBeenCalled()
  })
})

describe('Agora login page', () => {
  it('has no Google button', () => {
    render(<Login location={{ search: '' }} />)
    expect(screen.queryByText(/Google/i)).toBeNull()
  })
})
