import PropTypes from 'prop-types'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import Button from 'components/ui/button'
import { useViewHeader } from 'contexts/ViewHeaderContext'

function DeleteSettingsTab ({ group, deleteGroup }) {
  const { name } = group
  const { t } = useTranslation()

  // Agora: say so when the group could not be deleted, instead of doing nothing
  const [error, setError] = useState(null)

  const handleDeleteGroup = useCallback(async () => {
    if (window.confirm(t('Are you sure you want to delete the group {{name}}? This will permanently delete the group and all of its content. This cannot be undone.', { name }))) {
      setError(null)
      const result = await deleteGroup()
      if (result && result.error) {
        const reason = result.payload && result.payload.message
        setError(reason
          ? t('The group could not be deleted: {{reason}}', { reason })
          : t('The group could not be deleted. Reload the page and try again.'))
      }
    }
  }, [deleteGroup, name])

  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({
      title: {
        desktop: `${t('Group Settings')} > ${t('Delete Group')}`,
        mobile: t('Delete Group')
      },
      icon: 'Settings'
    })
  }, [])

  return (
    <div>
      <h2 className='text-foreground font-bold mb-2'>{t('Delete {{groupName}}', { groupName: name })}</h2>
      <p className='text-foreground/70 mb-4'>
        {t('If you delete this group, it will no longer be visible to you or any of the members. All posts will also be deleted.')}
      </p>
      <Button
        variant='destructive'
        onClick={handleDeleteGroup}
        className='w-fit flex items-center justify-center gap-2 opacity-50 hover:opacity-100 hover:scale-105 transition-all duration-300'
      >
        <TriangleAlert className='w-4 h-4' />
        {t('Delete Group')}
        <TriangleAlert className='w-4 h-4' />
      </Button>
      {error && <p role='alert' className='text-destructive mt-3'>{error}</p>}
    </div>
  )
}

DeleteSettingsTab.propTypes = {
  group: PropTypes.object,
  deleteGroup: PropTypes.func
}

export default DeleteSettingsTab
