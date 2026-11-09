// Agora: the little "Undo" bars at the bottom of a tasks page. items: [{ key, message, ariaLabel, onUndo }]
import React from 'react'
import { useTranslation } from 'react-i18next'
import Button from 'components/ui/button'

export default function UndoToasts ({ items }) {
  const { t } = useTranslation()
  if (!items.length) return null
  return (
    <div className='fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2'>
      {items.map(item => (
        <div key={item.key} role='status' className='flex items-center gap-3 rounded-md bg-foreground text-background px-4 py-2 text-sm shadow-lg'>
          {item.message}
          <Button type='button' size='sm' variant='secondary' onClick={item.onUndo} aria-label={item.ariaLabel}>{t('Undo')}</Button>
        </div>
      ))}
    </div>
  )
}
