import React from 'react'
import { render, screen, fireEvent } from 'util/testing/reactTestingLibraryExtended'
import DeleteSettingsTab from './DeleteSettingsTab'

describe('DeleteSettingsTab', () => {
  const group = {
    id: 1,
    name: 'Hylo'
  }

  const deleteGroup = jest.fn()

  it('renders correctly', () => {
    render(<DeleteSettingsTab group={group} deleteGroup={deleteGroup} />)

    expect(screen.getByText('Delete Hylo', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('If you delete this group', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Group' })).toBeInTheDocument()
  })

  it('does not call deleteGroup when not confirmed', () => {
    window.confirm = jest.fn(() => false)

    render(<DeleteSettingsTab group={group} deleteGroup={deleteGroup} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to delete the group Hylo? This will permanently delete the group and all of its content. This cannot be undone.'
    )
    expect(deleteGroup).not.toHaveBeenCalled()
  })

  it('calls deleteGroup when confirmed', () => {
    window.confirm = jest.fn(() => true)

    render(<DeleteSettingsTab group={group} deleteGroup={deleteGroup} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to delete the group Hylo? This will permanently delete the group and all of its content. This cannot be undone.'
    )
    expect(deleteGroup).toHaveBeenCalled()
  })

  // Agora: a failed delete is shown instead of silently doing nothing
  it('says why the group could not be deleted', async () => {
    window.confirm = jest.fn(() => true)
    const failing = jest.fn(() => Promise.resolve({ error: true, payload: new Error('You do not have permission') }))

    render(<DeleteSettingsTab group={group} deleteGroup={failing} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The group could not be deleted: You do not have permission')
  })

  it('asks to try again when the failure has no reason', async () => {
    window.confirm = jest.fn(() => true)
    const failing = jest.fn(() => Promise.resolve({ error: true }))

    render(<DeleteSettingsTab group={group} deleteGroup={failing} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The group could not be deleted. Reload the page and try again.')
  })

  it('shows nothing when the delete worked', async () => {
    window.confirm = jest.fn(() => true)
    const working = jest.fn(() => Promise.resolve({ payload: { success: true } }))

    render(<DeleteSettingsTab group={group} deleteGroup={working} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }))

    await Promise.resolve()
    expect(working).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
