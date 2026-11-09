/**
 * Agora: the shared body of a tasks page: Board or List, the quiet and error lines, the side
 * panel and the Undo bars. The project page and the circle page both render it with the result
 * of useTasks. Props: state (from useTasks), tasks (the tasks to show, maybe filtered),
 * title, toolbar (extra controls), addProjectId (project a new task goes in), showProject,
 * groupByProject, hideOnlyMine, emptyText.
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import getMe from 'store/selectors/getMe'
import { cn } from 'util/index'
import { today } from './api'
import TaskBoard from './TaskBoard'
import TaskList from './TaskList'
import TaskSidePanel from './TaskSidePanel'
import UndoToasts from './UndoToasts'

export default function TasksBody ({ state, tasks, title, toolbar, addProjectId, showProject, groupByProject, hideOnlyMine, emptyText }) {
  const { t } = useTranslation()
  const me = useSelector(getMe)
  const [view, setView] = useState('board')
  const { tasks: all, meta, loadError, notMember, error, includeDone, setIncludeDone, selectedId, setSelectedId, undos } = state

  const toggle = (key, label) => (
    <button type='button' aria-pressed={view === key} className={cn('px-3 py-1 text-sm rounded-md border', view === key ? 'bg-selected text-foreground border-selected' : 'border-border text-muted-foreground')} onClick={() => setView(key)}>{label}</button>
  )

  const shown = tasks || all || []
  const shared = {
    tasks: shown,
    today: today(),
    selectedId,
    onAdd: (title, status) => state.addTask(title, status, addProjectId),
    onMove: state.moveTask,
    onOpen: setSelectedId,
    showProject
  }

  return (
    <section className='flex flex-col gap-3 p-2 sm:p-4' aria-label={t('Tasks')}>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='m-0 text-lg font-semibold text-foreground'>{title || t('Tasks')}</h2>
        <div className='flex gap-1' role='group' aria-label={t('View')}>{toggle('board', t('Board'))}{toggle('list', t('List'))}</div>
      </div>
      {toolbar}
      {error && <p role='alert' className='m-0 text-sm text-destructive'>{error}</p>}
      {loadError && <p role='alert' className='m-0 text-destructive'>{loadError}</p>}
      {notMember && <p className='m-0 text-sm text-muted-foreground'>{t('Tasks are for members of this circle.')}</p>}
      {!all && !loadError && !notMember && <p className='m-0 text-muted-foreground'>{t('Loading…')}</p>}
      {all && (
        <div className={cn('grid gap-4 items-start', selectedId ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : 'grid-cols-1')}>
          <div className='min-w-0 flex flex-col gap-3'>
            {shown.length === 0 && <p className='m-0 text-muted-foreground'>{emptyText || t('No tasks yet. Add the first one.')}</p>}
            {view === 'board'
              ? <TaskBoard {...shared} />
              : <TaskList {...shared} currentUserId={me?.id} groupByProject={groupByProject} hideOnlyMine={hideOnlyMine} />}
            {!includeDone && <button type='button' className='self-start text-sm underline text-muted-foreground' onClick={() => setIncludeDone(true)}>{t('Show older done')}</button>}
          </div>
          {selectedId && (
            <TaskSidePanel
              key={selectedId}
              taskId={selectedId}
              listTask={all.find(x => x.id === selectedId)}
              meta={meta}
              onClose={() => setSelectedId(null)}
              onChanged={state.onChanged}
              onStatus={state.changeStatus}
              onDeleted={state.onDeleted}
              onCommentCount={state.setCommentCount}
            />
          )}
        </div>
      )}
      <UndoToasts items={undos.map(task => ({ key: task.id, message: t('Task deleted.'), ariaLabel: t('Undo delete of {{title}}', { title: task.title }), onUndo: () => state.restore(task) }))} />
    </section>
  )
}
