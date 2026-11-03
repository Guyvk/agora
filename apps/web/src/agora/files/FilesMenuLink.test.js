// Agora: the Files line in a circle's menu. Members only; opens the Files page inside the app, in the same tab.
import React from 'react'
import { render, screen } from 'util/testing/reactTestingLibraryExtended'
import FilesMenuLink, { FILES_URL } from './FilesMenuLink'

describe('FilesMenuLink', () => {
  it('links members to the circle\'s Files page inside the app, in the same tab', () => {
    render(<FilesMenuLink groupSlug='governance' isMember />)
    const link = screen.getByTestId('agora-files-menu-link')
    expect(link.getAttribute('href')).toEqual('/groups/governance/files')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.textContent).toEqual('Files')
  })

  it('works for a space, with the address the menu gives it', () => {
    render(<FilesMenuLink groupSlug='governance-budget' to='/groups/governance/spaces/budget/files' isMember />)
    expect(screen.getByTestId('agora-files-menu-link').getAttribute('href')).toEqual('/groups/governance/spaces/budget/files')
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
    expect(FILES_URL('a/b?c')).toEqual('/groups/a%2Fb%3Fc/files')
  })
})
