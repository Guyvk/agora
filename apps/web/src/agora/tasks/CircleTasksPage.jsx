/**
 * Agora: the Tasks page of a circle, inside the app, at /groups/<circle>/tasks (a task can be
 * opened with ?task=<id>). All tasks of the circle on the Board or the List, with a project
 * filter (All, each project, No project) and "Only mine". Same side panel, Undo and
 * "Show older done" as the project page: both use useTasks and TasksBody.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet'
import { useParams, useSearchParams } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { ListChecks } from 'lucide-react'
import getMe from 'store/selectors/getMe'
import getGroupForSlug from 'store/selectors/getGroupForSlug'
import Loading from 'components/Loading'
import { useViewHeader } from 'contexts/ViewHeaderContext'
import TasksBody from './TasksBody'
import useTasks from './useTasks'

const selectClasses = 'h-8 rounded-md border border-input bg-background px-2 text-foreground'

function CircleTasks ({ group }) {
  const { t } = useTranslation()
  const me = useSelector(getMe)
  const [searchParams, setSearchParams] = useSearchParams()
  const taskParam = searchParams.get('task')
  const [project, setProject] = useState('all') // 'all', 'none' or a project id
  const [onlyMine, setOnlyMine] = useState(false)
  const scope = useMemo(() => ({ groupId: group.id }), [group.id])
  const state = useTasks({ scope, initialSelectedId: taskParam })

  // Agora: the address follows the open task, so closing it clears ?task= and a new ?task= opens that task.
  useEffect(() => {
    if (taskParam && String(taskParam) !== String(state.selectedId)) state.setSelectedId(taskParam)
  }, [taskParam]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const want = state.selectedId == null ? null : String(state.selectedId)
    if (want === (taskParam || null)) return
    const next = new URLSearchParams(searchParams)
    if (want) next.set('task', want); else next.delete('task')
    setSearchParams(next, { replace: true })
  }, [state.selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => (state.tasks || []).filter(task => {
    if (project === 'none' && task.projectId) return false
    if (project !== 'all' && project !== 'none' && String(task.projectId) !== String(project)) return false
    if (onlyMine && !task.assignees.some(a => String(a.id) === String(me?.id))) return false
    return true
  }), [state.tasks, project, onlyMine, me])

  const projects = state.meta?.projects || []
  const toolbar = (
    <div className='flex flex-wrap items-center gap-3 text-sm'>
      <label className='inline-flex items-center gap-1.5 text-muted-foreground'>
        {t('Project')}
        <select className={selectClasses} value={project} onChange={e => setProject(e.target.value)} aria-label={t('Show tasks of')}>
          <option value='all'>{t('All')}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value='none'>{t('No project')}</option>
        </select>
      </label>
      <label className='inline-flex items-center gap-1.5 text-foreground'>
        <input type='checkbox' checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> {t('Only mine')}
      </label>
    </div>
  )

  return (
    <TasksBody
      state={state}
      tasks={visible}
      title={t('Tasks')}
      toolbar={state.notMember ? null : toolbar}
      addProjectId={project !== 'all' && project !== 'none' ? project : undefined}
      showProject={project === 'all'}
      groupByProject={project === 'all'}
      hideOnlyMine
      emptyText={state.tasks && state.tasks.length > 0 ? t('No tasks match this filter.') : undefined}
    />
  )
}

export default function CircleTasksPage ({ groupSlug: slugProp }) {
  const { t } = useTranslation()
  const params = useParams()
  const groupSlug = slugProp || params.groupSlug
  const group = useSelector(state => getGroupForSlug(state, groupSlug))
  const { setHeaderDetails } = useViewHeader()
  useEffect(() => {
    setHeaderDetails({ title: t('Tasks'), icon: <ListChecks />, info: '', search: false })
  }, [setHeaderDetails, t])

  return (
    <div className='w-full max-w-[1100px] mx-auto'>
      <Helmet><title>{t('Tasks')}{group ? ` | ${group.name}` : ''}</title></Helmet>
      {group ? <CircleTasks key={group.id} group={group} /> : <Loading />}
    </div>
  )
}
