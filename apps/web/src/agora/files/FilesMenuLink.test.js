// Agora: the Files line in a circle's menu. Members only; opens the Files page in the same tab.
import React from 'react'
import { render, screen } from 'util/testing/reactTestingLibraryExtended'
import FilesMenuLink, { FILES_URL } from './FilesMenuLink'

describe('FilesMenuLink', () => {
  it('links members to the circle\'s Files page, in the same tab', () => {
    render(<FilesMenuLink groupSlug='governance' isMember />)
    const link = screen.getByTestId('agora-files-menu-link')
    expect(link.getAttribute('href')).toEqual('/noo/agora/files/governance')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.textContent).toEqual('Files')
  })

  it('works for a space, with its own address', () => {
    render(<FilesMenuLink groupSlug='governance-budget' isMember />)
    expect(screen.getByTestId('agora-files-menu-link').getAttribute('href')).toEqual('/noo/agora/files/governance-budget')
  })

  it('shows nothing to people who are not members', () => {
    render(<FilesMenuLink groupSlug='governance' isMember={false} />)
    expect(screen.queryByTestId('agora-files-menu-link')).toBeNull()
  })

  it('shows nothing without a group', () => {
    render(<FilesMenuLink isMember />)
    expect(screen.queryByTestId('agora-files-menu-link')).toBeNull()
  })

  it('keeps odd characters out of the address', () => {
    expect(FILES_URL('a/b?c')).toEqual('/noo/agora/files/a%2Fb%3Fc')
  })
})
