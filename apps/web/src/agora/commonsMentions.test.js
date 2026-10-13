import React from 'react'
import { render, screen } from 'util/testing/reactTestingLibraryExtended'
import PublicToggle from 'components/PublicToggle'
import PrivacySettingsTab from 'routes/GroupSettings/PrivacySettingsTab'
import Drawer from 'routes/AuthLayoutRouter/components/Drawer'
import { postEditorTourSteps } from 'tours/postEditorTour'

// The Commons is off in Agora (src/agora/config.js), so its words stay out of sight.

it('PublicToggle does not mention The Commons, even for a group allowed in it', () => {
  render(<PublicToggle isPublic togglePublic={() => {}} selectedGroups={[{ allowInPublic: true }]} />)
  expect(screen.getByText(/publicly visible and shareable/)).toBeInTheDocument()
  expect(screen.queryByText(/Commons/)).toBeNull()
})

it('a public group can not apply to The Commons from its privacy settings', () => {
  const group = { id: 1, name: 'Foomunity', slug: 'foo', accessibility: 1, visibility: 2, allowInPublic: false }
  render(<PrivacySettingsTab group={group} parentGroups={[]} />)
  expect(screen.getByText('Visibility')).toBeInTheDocument()
  expect(screen.queryByText(/commons/i)).toBeNull()
})

it('the post editor tour does not mention The Commons', () => {
  const steps = postEditorTourSteps(text => text)
  const publicStep = steps.find(step => step.element === '[data-tour="post-public"]')
  expect(publicStep.popover.description).not.toMatch(/Commons/)
})

it('the left drawer has no Public section', () => {
  render(<Drawer match={{ match: { params: {} } }} />)
  expect(screen.queryByText('Public')).toBeNull()
  expect(screen.queryByText('Public Stream')).toBeNull()
})
