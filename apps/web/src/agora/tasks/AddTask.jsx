// Agora: an input where typing a title and pressing Enter makes a task.
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from 'components/ui/input'

export default function AddTask ({ onAdd, label }) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const submit = e => {
    e.preventDefault()
    const value = title.trim()
    if (!value) return
    setTitle('')
    onAdd(value)
  }
  return (
    <form onSubmit={submit}>
      <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('Add a task…')} aria-label={label || t('Add a task')} maxLength={200} />
    </form>
  )
}
