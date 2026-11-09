/**
 * Agora: the List view of tasks: Task, People, Due, Status. Sort by due date or status,
 * filter "Only mine". Props: tasks, today, currentUserId, selectedId, onAdd(title, status), onOpen(id),
 * groupByProject (a heading per project, "No project" last), hideOnlyMine (the page has its own filter)
 */
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'util/index'
import { STATUSES, formatDay, isOverdue, today as todayFn } from './api'
import Avatars from './Avatars'
import AddTask from './AddTask'

export default function TaskList ({ tasks, today = todayFn(), currentUserId, selectedId, onAdd, onOpen, groupByProject, hideOnlyMine }) {
  const { t } = useTranslation()
  const [sort, setSort] = useState('due')
  const [onlyMine, setOnlyMine] = useState(false)
  const labels = { todo: t('To do'), doing: t('Doing'), done: t('Done') }

  const rows = useMemo(() => {
    const list = tasks.filter(x => !onlyMine || x.assignees.some(a => String(a.id) === String(currentUserId)))
    const byDue = (a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') || a.position - b.position
    const byStatus = (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.position - b.position
    return list.sort(sort === 'due' ? byDue : byStatus)
  }, [tasks, sort, onlyMine, currentUserId])

  // [{ key, name, rows }]: one group, or one per project with "No project" last
  const groups = useMemo(() => {
    if (!groupByProject) return [{ key: 'all', name: null, rows }]
    const map = new Map()
    for (const task of rows) {
      const key = task.projectId ? String(task.projectId) : 'none'
      if (!map.has(key)) map.set(key, { key, name: task.projectName || null, rows: [] })
      map.get(key).rows.push(task)
    }
    const named = [...map.values()].filter(g => g.key !== 'none').sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return map.has('none') ? [...named, map.get('none')] : named
  }, [rows, groupByProject])

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-3 text-sm'>
        {!hideOnlyMine && (
          <label className='inline-flex items-center gap-1.5 text-foreground'>
            <input type='checkbox' checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> {t('Only mine')}
          </label>
        )}
        <label className='inline-flex items-center gap-1.5 text-muted-foreground'>
          {t('Sort by')}
          <select className='h-8 rounded-md border border-input bg-background px-2 text-foreground' value={sort} onChange={e => setSort(e.target.value)} aria-label={t('Sort tasks by')}>
            <option value='due'>{t('Due date')}</option>
            <option value='status'>{t('Status')}</option>
          </select>
        </label>
      </div>
      <AddTask onAdd={title => onAdd(title, 'todo')} label={t('Add a task to the list')} />
      <table className='w-full text-sm border-collapse' aria-label={t('Tasks')}>
        <thead>
          <tr className='border-b border-border text-left text-xs text-muted-foreground'>
            <th scope='col' className='px-3 py-2 font-medium'>{t('Task')}</th>
            <th scope='col' className='px-3 py-2 font-medium'>{t('People')}</th>
            <th scope='col' className='px-3 py-2 font-medium'>{t('Due')}</th>
            <th scope='col' className='px-3 py-2 font-medium'>{t('Status')}</th>
          </tr>
        </thead>
        {groups.map(group => (
          <tbody key={group.key} data-testid={groupByProject ? 'project-group' : undefined}>
            {groupByProject && (
              <tr className='bg-muted/40'>
                <th scope='colgroup' colSpan={4} className='px-3 py-1.5 text-left text-sm font-semibold text-foreground'>{group.name || t('No project')}</th>
              </tr>
            )}
            {group.rows.map(task => {
              const overdue = isOverdue(task, today)
              return (
                <tr key={task.id} className={cn('border-b border-border last:border-b-0 cursor-pointer hover:bg-selected/40', { 'bg-selected/60': selectedId === task.id })} onClick={() => onOpen(task.id)}>
                  <td className='px-3 py-2'>
                    <button type='button' className='text-left font-semibold text-foreground break-words' onClick={e => { e.stopPropagation(); onOpen(task.id) }}>{task.title}</button>
                  </td>
                  <td className='px-3 py-2'><Avatars people={task.assignees} /></td>
                  <td className={cn('px-3 py-2', overdue ? 'font-semibold text-destructive' : 'text-foreground')} data-overdue={overdue ? 'true' : undefined}>{task.dueDate ? formatDay(task.dueDate) : '—'}</td>
                  <td className='px-3 py-2 text-foreground'>{labels[task.status]}</td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
      {rows.length === 0 && onlyMine && !hideOnlyMine && <p className='m-0 text-muted-foreground'>{t('No tasks of yours here.')}</p>}
    </div>
  )
}
