/* eslint-env jest */
// Agora: the login, reset, sign-up and account forms carry what password
// managers (Chrome, 1Password) need to offer filling and saving a password.
import React from 'react'
import { render, screen, fireEvent, waitFor, AllTheProviders } from 'util/testing/reactTestingLibraryExtended'
import orm from 'store/models'
import extractModelsForTest from 'util/testing/extractModelsForTest'
import Login from 'routes/NonAuthLayoutRouter/Login/Login'
import PasswordReset from 'routes/NonAuthLayoutRouter/PasswordReset/PasswordReset'
import FinishRegistration from 'routes/NonAuthLayoutRouter/Signup/FinishRegistration/FinishRegistration'
import AccountSettingsTab from 'routes/UserSettings/AccountSettingsTab/AccountSettingsTab'

jest.mock('contexts/ViewHeaderContext', () => ({
  useViewHeader: () => ({ setHeaderDetails: jest.fn() })
}))

function currentUserProvider () {
  const ormSession = orm.mutableSession(orm.getEmptyState())
  extractModelsForTest({
    me: {
      id: '1',
      email: 'amara@agora.test',
      hasRegistered: false,
      emailValidated: true,
      settings: { signupInProgress: true }
    }
  }, 'Me', ormSession)
  return AllTheProviders({ orm: ormSession.state })
}

describe('password forms', () => {
  it('login: a real form with username and current-password', () => {
    const { container } = render(<Login location={{ search: '' }} />)
    const form = container.querySelector('form')
    expect(form).toBeInTheDocument()
    const email = container.querySelector('#email')
    const password = container.querySelector('#password')
    expect(form).toContainElement(email)
    expect(form).toContainElement(password)
    expect(email).toHaveAttribute('autocomplete', 'username')
    expect(email).toHaveAttribute('name', 'email')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(password).toHaveAttribute('name', 'password')
    expect(password).toHaveAttribute('type', 'password')
    expect(screen.getByText('Sign in').closest('button')).toHaveAttribute('type', 'submit')
  })

  it('reset: the email field is the username, in a form', () => {
    const { container } = render(<PasswordReset />)
    const form = container.querySelector('form')
    const email = container.querySelector('#email')
    expect(form).toContainElement(email)
    expect(email).toHaveAttribute('autocomplete', 'username')
    expect(email).toHaveAttribute('type', 'email')
    expect(screen.getByText('Send reset email').closest('button')).toHaveAttribute('type', 'submit')
  })

  it('sign-up password step: hidden username with the email, two new-password fields', () => {
    const { container } = render(<FinishRegistration />, { wrapper: currentUserProvider() })
    const form = container.querySelector('form')
    expect(form).toBeInTheDocument()
    const username = form.querySelector('input[autocomplete="username"]')
    expect(username).toHaveValue('amara@agora.test')
    expect(username).toHaveAttribute('name', 'username')
    expect(form.querySelector('#password')).toHaveAttribute('autocomplete', 'new-password')
    expect(form.querySelector('#passwordConfirmation')).toHaveAttribute('autocomplete', 'new-password')
    expect(form.querySelector('#name')).toHaveAttribute('autocomplete', 'name')
    expect(form.querySelector('button[type="submit"]')).toBeInTheDocument()
  })

  it('account settings: email as username, new-password fields, submit saves and steps history', async () => {
    const updateUserSettings = jest.fn(() => Promise.resolve({}))
    const replaceState = jest.spyOn(window.history, 'replaceState')
    const { container } = render(
      <AccountSettingsTab
        currentUser={{ email: 'amara@agora.test' }}
        updateUserSettings={updateUserSettings}
        setConfirm={jest.fn()}
      />
    )
    const form = container.querySelector('form')
    const email = form.querySelector('#email')
    const password = form.querySelector('#password')
    const confirm = form.querySelector('#confirm')
    expect(email).toHaveAttribute('autocomplete', 'username')
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    expect(password).toHaveAttribute('name', 'new-password')
    expect(confirm).toHaveAttribute('autocomplete', 'new-password')
    expect(confirm).toHaveAttribute('name', 'confirm-password')

    fireEvent.change(password, { target: { value: 'a-good-password' } })
    fireEvent.change(confirm, { target: { value: 'a-good-password' } })
    fireEvent.submit(form)

    expect(updateUserSettings).toHaveBeenCalledWith({ password: 'a-good-password' })
    await waitFor(() => expect(replaceState).toHaveBeenCalled())
    replaceState.mockRestore()
  })
})
