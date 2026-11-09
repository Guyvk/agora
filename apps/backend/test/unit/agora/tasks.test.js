/* eslint-env mocha */
/**
 * Agora: tasks in a circle, see lib/agora/tasks.js and AgoraTasksController.js.
 *
 * These checks need a database, and empty it first. Never point them at a
 * database you want to keep:
 *
 *   cd apps/backend
 *   DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/tasks.test.js
 */
import AgoraTasksController from '../../../api/controllers/AgoraTasksController'
const rootPath = require('root-path')
const setup = require(rootPath('test/setup'))
const factories = require(rootPath('test/setup/factories'))

describe('Agora tasks', () => {
  let amara, bea, cora, dan, circle, other, project, otherProject, deletedProject

  const knex = () => bookshelf.knex

  function call (action, { params = {}, query = {}, body, userId, fromPage = true } = {}) {
    const req = factories.mock.request()
    req.params = params
    req.query = query
    req.body = body
    req.headers = fromPage ? { 'x-agora': '1' } : {}
    if (userId) req.login(userId)
    const res = factories.mock.response()
    res.set = () => {}
    return AgoraTasksController[action](req, res).then(() => res)
  }

  // Short forms. Amara is a steward; Bea and Cora are plain members; Dan is not in the circle.
  const create = (body, userId = bea.id) => call('create', { body: { groupId: circle.id, ...body }, userId })
  const list = (query, userId = bea.id) => call('list', { query, userId })
  const move = (id, body, userId = bea.id) => call('move', { params: { taskId: id }, body, userId })
  const update = (id, body, userId = bea.id) => call('update', { params: { taskId: id }, body, userId })
  const show = (id, userId = bea.id) => call('show', { params: { taskId: id }, userId })

  before(async () => {
    await setup.clearDb()
    amara = await new User({ name: 'Amara', email: 'amara@tasks.test', active: true }).save()
    bea = await new User({ name: 'Bea', email: 'bea@tasks.test', active: true }).save()
    cora = await new User({ name: 'Cora', email: 'cora@tasks.test', active: true }).save()
    dan = await new User({ name: 'Dan', email: 'dan@tasks.test', active: true }).save()
    circle = await new Group({ slug: 'communications', name: 'Communications' }).save()
    other = await new Group({ slug: 'care', name: 'Care' }).save()
    for (const u of [amara, bea, cora]) await u.joinGroup(circle)
    await dan.joinGroup(other)

    // Amara is a steward: a role with Manage Content in the circle
    const responsibility = await Responsibility.where({ title: 'Manage Content', type: 'system' }).fetch()
    const role = await new GroupRole({ group_id: circle.id, name: 'Moderator', active: true }).save()
    await knex()('group_roles_responsibilities').insert({ group_role_id: role.id, responsibility_id: responsibility.id })
    await new MemberGroupRole({ group_id: circle.id, user_id: amara.id, group_role_id: role.id, active: true }).save()

    const post = async (name, group, attrs = {}) => {
      const p = await factories.post({ name, type: 'project', user_id: amara.id, ...attrs }).save()
      await knex()('groups_posts').insert({ post_id: p.id, group_id: group.id })
      return p
    }
    project = await post('Website', circle)
    otherProject = await post('Care handbook', other)
    deletedProject = await post('Old project', circle, { active: false })
  })

  describe('who gets in', () => {
    it('needs a login', async () => {
      const res = await call('mine', {})
      expect(res.statusCode).to.equal(403)
    })

    it('refuses changes that do not come from the page itself', async () => {
      const res = await call('create', { body: { groupId: circle.id, title: 'Forged' }, userId: bea.id, fromPage: false })
      expect(res.statusCode).to.equal(400)
      expect(Number((await knex()('agora_tasks').count('id as n').first()).n)).to.equal(0)
    })

    it('keeps someone who is not in the circle out of the list, the meta and adding', async () => {
      expect((await list({ groupId: circle.id }, dan.id)).statusCode).to.equal(403)
      expect((await call('meta', { query: { groupId: circle.id }, userId: dan.id })).statusCode).to.equal(403)
      expect((await create({ title: 'Sneaky' }, dan.id)).statusCode).to.equal(403)
    })

    it('needs a circle or a project to list', async () => {
      expect((await list({})).statusCode).to.equal(400)
    })
  })

  describe('working with tasks', () => {
    let first, second

    it('adds a task to the end of its column', async () => {
      const a = await create({ title: '  Write the newsletter  ', description: 'Short one', assigneeIds: [bea.id], dueDate: '2026-12-31' })
      expect(a.statusCode).to.equal(undefined)
      first = a.body.task
      expect(first).to.include({ title: 'Write the newsletter', description: 'Short one', status: 'todo', groupSlug: 'communications', groupName: 'Communications', dueDate: '2026-12-31', canEdit: true, commentCount: 0 })
      expect(first.projectId).to.equal(null)
      expect(first.assignees).to.deep.equal([{ id: Number(bea.id), name: 'Bea', avatarUrl: null }])
      expect(first.createdBy).to.deep.equal({ id: Number(bea.id), name: 'Bea' })
      expect(first.source).to.equal(null)
      expect(first.completedAt).to.equal(null)
      second = (await create({ title: 'Book the room', projectId: project.id })).body.task
      expect(second.position).to.be.greaterThan(first.position)
      expect(second).to.include({ projectId: Number(project.id), projectName: 'Website' })
    })

    it('keeps the due date as the same plain date, whatever the time zone', async () => {
      const res = await create({ title: 'Edge of the year', dueDate: '2026-01-01' })
      expect(res.body.task.dueDate).to.equal('2026-01-01')
      const again = await show(res.body.task.id)
      expect(again.body.task.dueDate).to.equal('2026-01-01')
      const row = await knex()('agora_tasks').where({ id: res.body.task.id }).first()
      expect(row.due_date).to.be.an.instanceof(Date) // pg gives a Date, so the answer must be formatted in SQL
    })

    it('checks the title, the status and the due date', async () => {
      expect((await create({ title: '   ' })).statusCode).to.equal(400)
      expect((await create({ title: 'x'.repeat(501) })).statusCode).to.equal(400)
      expect((await create({ title: 'Ok', status: 'later' })).statusCode).to.equal(400)
      expect((await create({ title: 'Ok', dueDate: '31-12-2026' })).statusCode).to.equal(400)
      expect((await create({ title: 'Ok', dueDate: '2026-02-30' })).statusCode).to.equal(400)
    })

    it('lists the circle in order, and filters by project and by me', async () => {
      const all = (await list({ groupId: circle.id })).body.tasks
      expect(all.map(t => t.title)).to.include.members(['Write the newsletter', 'Book the room'])
      const inProject = (await list({ projectId: project.id })).body.tasks
      expect(inProject.map(t => t.title)).to.deep.equal(['Book the room'])
      const mine = (await list({ groupId: circle.id, mine: '1' }, bea.id)).body.tasks
      expect(mine.map(t => t.title)).to.deep.equal(['Write the newsletter'])
      expect((await list({ groupId: circle.id, mine: '1' }, cora.id)).body.tasks).to.deep.equal([])
    })

    it('shows the task with its comments to a member, and hides it from anyone else', async () => {
      const res = await show(first.id, cora.id)
      expect(res.body.task.id).to.equal(first.id)
      expect(res.body.comments).to.deep.equal([])
      expect((await show(first.id, dan.id)).statusCode).to.equal(404)
      expect((await show('nope')).statusCode).to.equal(404)
      expect((await show('999999')).statusCode).to.equal(404)
    })

    it('lets a member who is not on the task move it, but not change it', async () => {
      const moved = await move(first.id, { status: 'doing', position: 0.5 }, cora.id)
      expect(moved.body.task).to.include({ status: 'doing', position: 0.5, canEdit: false })
      const edit = await update(first.id, { title: 'Hijacked' }, cora.id)
      expect(edit.statusCode).to.equal(403)
      expect((await show(first.id)).body.task.title).to.equal('Write the newsletter')
      expect((await call('destroy', { params: { taskId: first.id }, userId: cora.id })).statusCode).to.equal(403)
    })

    it('does not let a non-member move or change a task', async () => {
      expect((await move(first.id, { status: 'done', position: 1 }, dan.id)).statusCode).to.equal(404)
      expect((await update(first.id, { title: 'x' }, dan.id)).statusCode).to.equal(404)
    })

    it('checks the move', async () => {
      expect((await move(first.id, { status: 'nope', position: 1 })).statusCode).to.equal(400)
      expect((await move(first.id, { status: 'todo', position: 'abc' })).statusCode).to.equal(400)
      expect((await move(first.id, { status: 'todo' })).statusCode).to.equal(400)
    })

    it('sets completed_at when a task is done and clears it when it leaves done', async () => {
      const done = await move(first.id, { status: 'done', position: 1 })
      expect(done.body.task.status).to.equal('done')
      expect(done.body.task.completedAt).to.not.equal(null)
      const back = await update(first.id, { status: 'doing' })
      expect(back.body.task.completedAt).to.equal(null)
      const viaUpdate = await update(first.id, { status: 'done' })
      expect(viaUpdate.body.task.completedAt).to.not.equal(null)
      const out = await move(first.id, { status: 'todo', position: 2 }, cora.id)
      expect(out.body.task.completedAt).to.equal(null)
    })

    it('puts a task at the end of the new column when its status changes through update', async () => {
      const a = (await create({ title: 'Column A', status: 'doing' })).body.task
      const b = (await create({ title: 'Column B' })).body.task
      const changed = (await update(b.id, { status: 'doing' })).body.task
      expect(changed.position).to.be.greaterThan(a.position)
    })

    it('hides tasks done more than 14 days ago, unless asked for', async () => {
      const old = (await create({ title: 'Ancient', status: 'done' })).body.task
      await knex()('agora_tasks').where({ id: old.id }).update({ completed_at: new Date(Date.now() - 20 * 86400000) })
      expect((await list({ groupId: circle.id })).body.tasks.map(t => t.title)).to.not.include('Ancient')
      expect((await list({ groupId: circle.id, includeDone: '1' })).body.tasks.map(t => t.title)).to.include('Ancient')
      const recent = (await create({ title: 'Just done', status: 'done' })).body.task
      expect((await list({ groupId: circle.id })).body.tasks.map(t => t.id)).to.include(recent.id)
    })

    it('lets the creator and a steward change a task; a null due date clears it', async () => {
      const bySteward = await update(second.id, { title: 'Book the big room', dueDate: '2026-11-20' }, amara.id)
      expect(bySteward.body.task).to.include({ title: 'Book the big room', dueDate: '2026-11-20', canEdit: true })
      const cleared = await update(second.id, { dueDate: null }, bea.id) // Bea made it
      expect(cleared.body.task.dueDate).to.equal(null)
    })

    it('lets an assignee change a task they did not make', async () => {
      const t = (await create({ title: 'For Cora', assigneeIds: [cora.id] }, amara.id)).body.task
      const res = await update(t.id, { description: 'Done soon' }, cora.id)
      expect(res.body.task.description).to.equal('Done soon')
    })
  })

  describe('people and projects', () => {
    it('only allows members of the circle as assignees', async () => {
      const res = await create({ title: 'Wrong person', assigneeIds: [dan.id] })
      expect(res.statusCode).to.equal(400)
      const t = (await create({ title: 'Right person' })).body.task
      expect((await update(t.id, { assigneeIds: [bea.id, dan.id] })).statusCode).to.equal(400)
      const ok = await update(t.id, { assigneeIds: [bea.id, cora.id] })
      expect(ok.body.task.assignees.map(a => a.name).sort()).to.deep.equal(['Bea', 'Cora'])
      const fewer = await update(t.id, { assigneeIds: [cora.id] })
      expect(fewer.body.task.assignees.map(a => a.name)).to.deep.equal(['Cora'])
    })

    it('only allows an active project post of this circle', async () => {
      expect((await create({ title: 'Elsewhere', projectId: otherProject.id })).statusCode).to.equal(404)
      expect((await create({ title: 'Elsewhere', groupId: circle.id, projectId: otherProject.id })).statusCode).to.equal(404)
      expect((await create({ title: 'Gone', projectId: deletedProject.id })).statusCode).to.equal(404)
      const t = (await create({ title: 'Move me' })).body.task
      expect((await update(t.id, { projectId: otherProject.id })).statusCode).to.equal(400)
      expect((await update(t.id, { projectId: deletedProject.id })).statusCode).to.equal(400)
      const set = await update(t.id, { projectId: project.id })
      expect(set.body.task).to.include({ projectId: Number(project.id), projectName: 'Website' })
      const cleared = await update(t.id, { projectId: null })
      expect(cleared.body.task.projectId).to.equal(null)
      expect(cleared.body.task.projectName).to.equal(null)
    })

    it('works out the circle from the project alone', async () => {
      const res = await call('create', { body: { projectId: project.id, title: 'Only a project' }, userId: bea.id })
      expect(res.body.task.groupId).to.equal(Number(circle.id))
    })

    it('gives the meta for a circle and for a project', async () => {
      const res = await call('meta', { query: { groupId: circle.id }, userId: bea.id })
      expect(res.body.group).to.deep.equal({ id: Number(circle.id), slug: 'communications', name: 'Communications' })
      expect(res.body.project).to.equal(null)
      expect(res.body.members.map(m => m.name)).to.deep.equal(['Amara', 'Bea', 'Cora'])
      expect(res.body.projects).to.deep.equal([{ id: Number(project.id), name: 'Website' }])
      expect(res.body.canManage).to.equal(false)
      const viaProject = await call('meta', { query: { projectId: project.id }, userId: amara.id })
      expect(viaProject.body.project).to.deep.equal({ id: Number(project.id), name: 'Website' })
      expect(viaProject.body.canManage).to.equal(true)
    })
  })

  describe('deleting and restoring', () => {
    it('removes softly, leaves the task out of lists, and brings it back', async () => {
      const t = (await create({ title: 'Short lived' })).body.task
      const gone = await call('destroy', { params: { taskId: t.id }, userId: bea.id })
      expect(gone.body).to.deep.equal({ ok: true })
      expect((await list({ groupId: circle.id })).body.tasks.map(x => x.id)).to.not.include(t.id)
      expect((await show(t.id)).statusCode).to.equal(404)
      const row = await knex()('agora_tasks').where({ id: t.id }).first()
      expect(row.removed_at).to.not.equal(null)
      expect(String(row.removed_by_id)).to.equal(String(bea.id))

      expect((await call('restore', { params: { taskId: t.id }, userId: cora.id })).statusCode).to.equal(403)
      expect((await call('restore', { params: { taskId: t.id }, userId: dan.id })).statusCode).to.equal(404)
      const back = await call('restore', { params: { taskId: t.id }, userId: amara.id })
      expect(back.body.task.id).to.equal(t.id)
      expect((await show(t.id)).statusCode).to.equal(undefined)
    })
  })

  describe('my tasks', () => {
    it('shows my tasks across every circle I am in, and not tasks in circles I am not in', async () => {
      await amara.joinGroup(other)
      const care = await call('create', { body: { groupId: other.id, title: 'Care task', assigneeIds: [amara.id] }, userId: amara.id })
      const mineAll = (await call('mine', { userId: amara.id })).body.tasks
      expect(mineAll.map(t => t.title)).to.include('Care task')
      expect(mineAll.every(t => t.assignees.some(a => a.id === Number(amara.id)))).to.equal(true)
      expect((await call('mine', { userId: dan.id })).body.tasks.map(t => t.title)).to.not.include('Write the newsletter')
      // Leaving a circle takes its tasks out of "mine"
      await knex()('group_memberships').where({ group_id: other.id, user_id: amara.id }).update({ active: false })
      expect((await call('mine', { userId: amara.id })).body.tasks.map(t => t.id)).to.not.include(care.body.task.id)
    })
  })

  describe('comments', () => {
    let task, comment

    before(async () => {
      task = (await create({ title: 'Talk about it' })).body.task
    })

    it('lets any member comment, and counts the comments', async () => {
      const res = await call('addComment', { params: { taskId: task.id }, body: { text: ' First! ' }, userId: cora.id })
      comment = res.body.comment
      expect(comment).to.include({ text: 'First!' })
      expect(comment.user).to.deep.equal({ id: Number(cora.id), name: 'Cora', avatarUrl: null })
      expect((await show(task.id)).body.task.commentCount).to.equal(1)
      expect((await call('addComment', { params: { taskId: task.id }, body: { text: '  ' }, userId: cora.id })).statusCode).to.equal(400)
      expect((await call('addComment', { params: { taskId: task.id }, body: { text: 'Hi' }, userId: dan.id })).statusCode).to.equal(404)
    })

    it('shows who may delete a comment', async () => {
      const asCora = (await show(task.id, cora.id)).body.comments[0]
      expect(asCora.canDelete).to.equal(true)
      const asBea = (await show(task.id, bea.id)).body.comments[0]
      expect(asBea.canDelete).to.equal(false)
      const asSteward = (await show(task.id, amara.id)).body.comments[0]
      expect(asSteward.canDelete).to.equal(true)
    })

    it('lets only the writer or a steward delete it', async () => {
      const del = id => userId => call('destroyComment', { params: { commentId: id }, userId })
      expect((await del(comment.id)(bea.id)).statusCode).to.equal(403)
      expect((await del(comment.id)(dan.id)).statusCode).to.equal(404)
      const ok = await del(comment.id)(amara.id)
      expect(ok.body).to.deep.equal({ ok: true })
      expect((await show(task.id)).body.comments).to.deep.equal([])
      expect((await show(task.id)).body.task.commentCount).to.equal(0)
      expect((await del(comment.id)(cora.id)).statusCode).to.equal(404)
    })
  })
})
