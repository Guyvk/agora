// Agora: the Tasks line in a circle's menu. Members only; opens the Tasks page inside the app.
import React from 'react'
import { render, screen } from 'util/testing/reactTestingLibraryExtended'
import TasksMenuLink from './TasksMenuLink'
import { circleTasksUrl } from './api'

describe('TasksMenuLink', () => {
  it('links members to the circle\'s Tasks page in the same tab', () => {
    render(<TasksMenuLink groupSlug='governance' isMember />)
    const link = screen.getByTestId('agora-tasks-menu-link')
    expect(link.getAttribute('href')).toEqual('/groups/governance/tasks')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.textContent).toEqual('Tasks')
  })

  it('shows nothing to people who are not members', () => {
    render(<TasksMenuLink groupSlug='governance' isMember={false} />)
    expect(screen.queryByTestId('agora-tasks-menu-link')).toBeNull()
  })

  it('keeps odd characters out of the address and can name a task', () => {
    expect(circleTasksUrl('a/b', '5')).toEqual('/groups/a%2Fb/tasks?task=5')
  })
})
