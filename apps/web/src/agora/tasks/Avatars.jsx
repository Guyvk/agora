// Agora: small overlapping avatars for the people on a task.
import React from 'react'
import { cn } from 'util/index'
import { initials } from './api'

export default function Avatars ({ people = [], max = 3 }) {
  if (people.length === 0) return null
  const shown = people.slice(0, max)
  return (
    <span className='inline-flex items-center' data-testid='avatars'>
      {shown.map((p, i) => (
        <span key={p.id} title={p.name} className={cn('inline-flex w-6 h-6 rounded-full border-2 border-card bg-selected text-foreground/80 text-[10px] font-semibold items-center justify-center overflow-hidden', { '-ml-2': i > 0 })}>
          {p.avatarUrl ? <img src={p.avatarUrl} alt={p.name} className='w-full h-full object-cover' /> : initials(p.name)}
        </span>
      ))}
      {people.length > max && <span className='ml-1 text-xs text-muted-foreground'>+{people.length - max}</span>}
    </span>
  )
}
