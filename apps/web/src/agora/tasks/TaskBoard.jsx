/**
 * Agora: the Board view of tasks, three columns. Cards can be dragged between columns and up
 * and down (dnd-kit, already a Hylo dependency). The new position is the midpoint between the
 * neighbours; the parent does the saving (optimistic, with roll-back).
 * Props: tasks, today, selectedId, onAdd(title, status), onMove(task, status, position), onOpen(id)
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCorners, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from 'util/index'
import { STATUSES, column, formatDay, isOverdue, positionAt, today as todayFn } from './api'
import Avatars from './Avatars'
import AddTask from './AddTask'

export function Card ({ task, today, selected, onOpen, dragging }) {
  const { t } = useTranslation()
  const overdue = isOverdue(task, today)
  return (
    <div className={cn('rounded-md border bg-card p-2 text-sm shadow-sm cursor-grab', selected ? 'border-accent' : 'border-border', { 'opacity-40': dragging })} data-testid='task-card' data-task-id={task.id}>
      <button type='button' className='block w-full text-left font-semibold text-foreground break-words' onClick={() => onOpen(task.id)}>{task.title}</button>
      {(task.assignees.length > 0 || task.dueDate) && (
        <div className='flex items-center justify-between gap-2 mt-2'>
          <Avatars people={task.assignees} />
          {task.dueDate && (
            <span className={cn('text-xs', overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')} data-overdue={overdue ? 'true' : undefined}>
              {overdue && <span className='sr-only'>{t('Overdue')}: </span>}{formatDay(task.dueDate)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function SortableCard ({ task, selectedId, ...rest }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { status: task.status } })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className='list-none'>
      <Card task={task} selected={selectedId === task.id} dragging={isDragging} {...rest} />
    </li>
  )
}

function Column ({ status, label, tasks, onAdd, ...rest }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'col:' + status, data: { status } })
  return (
    <section className={cn('flex flex-col gap-2 rounded-lg bg-muted/40 p-2 min-w-0', { 'ring-2 ring-accent/50': isOver })} aria-label={label} data-testid={'column-' + status}>
      <h3 className='m-0 text-sm font-semibold text-foreground'>{label} <span className='font-normal text-muted-foreground'>{tasks.length}</span></h3>
      <AddTask onAdd={title => onAdd(title, status)} label={label + ': add a task'} />
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className='m-0 p-0 flex flex-col gap-2 min-h-12'>
          {tasks.map(task => <SortableCard key={task.id} task={task} {...rest} />)}
        </ul>
      </SortableContext>
    </section>
  )
}

export default function TaskBoard ({ tasks, today = todayFn(), selectedId, onAdd, onMove, onOpen }) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))
  const labels = { todo: t('To do'), doing: t('Doing'), done: t('Done') }
  const active = tasks.find(x => x.id === activeId)

  const onDragEnd = ({ active: a, over }) => {
    setActiveId(null)
    if (!over || a.id === over.id) return
    const moved = tasks.find(x => x.id === a.id)
    if (!moved) return
    const overTask = tasks.find(x => x.id === over.id)
    const status = overTask ? overTask.status : over.data.current?.status
    if (!status) return
    const others = column(tasks, status).filter(x => x.id !== moved.id)
    let index = others.length
    if (overTask) {
      index = others.findIndex(x => x.id === overTask.id)
      // dragged down within the same column: land after the card dropped on
      if (overTask.status === moved.status && column(tasks, status).findIndex(x => x.id === moved.id) < column(tasks, status).findIndex(x => x.id === overTask.id)) index += 1
    }
    onMove(moved, status, positionAt(others, index))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={e => setActiveId(e.active.id)} onDragCancel={() => setActiveId(null)} onDragEnd={onDragEnd}>
      <div className='grid grid-cols-1 md:grid-cols-3 gap-3 items-start'>
        {STATUSES.map(status => (
          <Column key={status} status={status} label={labels[status]} tasks={column(tasks, status)} today={today} selectedId={selectedId} onOpen={onOpen} onAdd={onAdd} />
        ))}
      </div>
      <DragOverlay>{active ? <Card task={active} today={today} onOpen={() => {}} /> : null}</DragOverlay>
    </DndContext>
  )
}
