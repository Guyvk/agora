import React from 'react'
import { render, screen } from 'util/testing/reactTestingLibraryExtended'
import Signup from './Signup'

// Agora: the page first asks the server whether sign-up is by invitation only (see src/agora/signup.test.js)
const realFetch = global.fetch
beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ inviteOnly: false }) }))
})

afterEach(() => {
  global.fetch = realFetch
})

it('renders correctly', async () => {
  render(
    <Signup location={{ search: '' }} />
  )

  expect(await screen.findByText('Enter your email to get started:')).toBeInTheDocument()
})
