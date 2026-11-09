/**
 * Agora: the Tasks part of a project's page. Board or List (one toggle), a side panel for one
 * task, add / move / delete with Undo. Props: projectId (the project post's id).
 * The data and actions are in useTasks, the screen in TasksBody; the circle's Tasks page
 * (CircleTasksPage) uses the same two.
 */
import React, { useMemo } from 'react'
import TasksBody from './TasksBody'
import useTasks from './useTasks'

export default function TasksPanel ({ projectId }) {
  const scope = useMemo(() => ({ projectId }), [projectId])
  // moved to another project: it leaves this page
  const keepTask = task => String(task.projectId) === String(projectId)
  const state = useTasks({ scope, keepTask })
  return <TasksBody state={state} />
}
