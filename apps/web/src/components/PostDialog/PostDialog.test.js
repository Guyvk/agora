import React from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AllTheProviders, render, screen, waitFor } from 'util/testing/reactTestingLibraryExtended'
import getPost from 'store/selectors/getPost'
import PostDialog from './PostDialog'

// the test setup stubs these two router hooks; this test needs the real ones
jest.mock('react-router-dom', () => jest.requireActual('react-router-dom'))
jest.mock('store/selectors/getPost', () => jest.fn())

jest.mock('routes/PostDetail/PostDetail', () => {
  const React = require('react')
  return { __esModule: true, default: React.forwardRef(() => <div data-testid='post-detail-in-dialog' />) }
})

const Where = () => <div data-testid='where'>{useLocation().pathname}</div>

function renderAt (path) {
  document.body.insertAdjacentHTML('beforeend', '<div id="center-column-container"></div>')
  return render(
    <>
      <Where />
      <Routes>
        <Route path='/groups/:groupSlug/projects/post/:postId' element={<PostDialog />} />
        <Route path='/groups/:groupSlug/post/:postId' element={<div data-testid='full-page' />} />
      </Routes>
    </>,
    {},
    AllTheProviders({}, [path])
  )
}

describe('PostDialog', () => {
  afterEach(() => {
    document.getElementById('center-column-container')?.remove()
  })

  it('sends a project to its own page instead of the pop-up', async () => {
    getPost.mockReturnValue({ id: '12', type: 'project' })
    renderAt('/groups/7bp/projects/post/12')

    await waitFor(() => expect(screen.getByTestId('full-page')).toBeInTheDocument())
    expect(screen.getByTestId('where')).toHaveTextContent('/groups/7bp/post/12')
    expect(screen.queryByTestId('post-detail-in-dialog')).not.toBeInTheDocument()
  })

  it('keeps every other kind of post in the pop-up', async () => {
    getPost.mockReturnValue({ id: '12', type: 'discussion' })
    renderAt('/groups/7bp/projects/post/12')

    expect(await screen.findByTestId('post-detail-in-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('full-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/groups/7bp/projects/post/12')
  })
})
