/**
 * Agora: the server part of tasks, see lib/agora/tasks.js.
 *
 *   /noo/agora/tasks/api/...   what the tasks pages read and change, as JSON
 *
 * Only people who are logged in get in, and every call checks that the person
 * is a member of the circle the task is in. Changes must come from the page
 * itself: it sends an X-Agora header, which another website cannot add to a
 * request made with someone's login.
 */
import Tasks from '../../lib/agora/tasks'
import Suggestions from '../../lib/agora/taskSuggestions'

function fromAgoraPage (req) {
  return req.headers['x-agora'] === '1'
}

/** Runs an action for logged-in people and turns TaskErrors into plain answers. */
function taskAction (fn, { change = false } = {}) {
  return async function (req, res) {
    res.set('Cache-Control', 'no-store')
    if (change && !fromAgoraPage(req)) return res.status(400).send({ error: 'Bad request.' })
    const userId = req.session.userId
    if (!userId) return res.status(403).send({ error: 'Please log in.' })
    try {
      return await fn(req, res, userId)
    } catch (err) {
      if (err instanceof Tasks.TaskError) return res.status(err.status).send({ error: err.message })
      // Anything else is a bug: answer with a 500 instead of leaving the request hanging
      return res.serverError(err)
    }
  }
}

const body = req => req.body || {}

module.exports = {
  list: taskAction(async (req, res, userId) => {
    const q = req.query || {}
    res.ok({
      tasks: await Tasks.list(userId, {
        groupId: q.groupId, projectId: q.projectId, mine: q.mine === '1', includeDone: q.includeDone === '1'
      })
    })
  }),

  mine: taskAction(async (req, res, userId) => {
    res.ok({ tasks: await Tasks.mine(userId) })
  }),

  meta: taskAction(async (req, res, userId) => {
    const q = req.query || {}
    res.ok(await Tasks.meta(userId, { groupId: q.groupId, projectId: q.projectId }))
  }),

  show: taskAction(async (req, res, userId) => {
    res.ok(await Tasks.get(userId, req.param('taskId')))
  }),

  create: taskAction(async (req, res, userId) => {
    res.ok({ task: await Tasks.create(userId, body(req)) })
  }, { change: true }),

  update: taskAction(async (req, res, userId) => {
    res.ok({ task: await Tasks.update(userId, req.param('taskId'), body(req)) })
  }, { change: true }),

  move: taskAction(async (req, res, userId) => {
    res.ok({ task: await Tasks.move(userId, req.param('taskId'), body(req)) })
  }, { change: true }),

  destroy: taskAction(async (req, res, userId) => {
    await Tasks.remove(userId, req.param('taskId'))
    res.ok({ ok: true })
  }, { change: true }),

  restore: taskAction(async (req, res, userId) => {
    res.ok({ task: await Tasks.restore(userId, req.param('taskId')) })
  }, { change: true }),

  addComment: taskAction(async (req, res, userId) => {
    res.ok({ comment: await Tasks.addComment(userId, req.param('taskId'), body(req)) })
  }, { change: true }),

  suggestions: taskAction(async (req, res, userId) => {
    res.ok(await Suggestions.listForMinutes(userId, (req.query || {}).minutesPostId))
  }),

  suggestionsMine: taskAction(async (req, res, userId) => {
    res.ok({ suggestions: await Suggestions.mine(userId) })
  }),

  openFromLastTime: taskAction(async (req, res, userId) => {
    res.ok(await Suggestions.openFromLastTime(userId, (req.query || {}).eventPostId))
  }),

  acceptSuggestion: taskAction(async (req, res, userId) => {
    res.ok(await Suggestions.accept(userId, req.param('id'), body(req)))
  }, { change: true }),

  dismissSuggestion: taskAction(async (req, res, userId) => {
    res.ok(await Suggestions.dismiss(userId, req.param('id')))
  }, { change: true }),

  notMine: taskAction(async (req, res, userId) => {
    res.ok(await Suggestions.notMine(userId, req.param('id')))
  }, { change: true }),

  acceptAll: taskAction(async (req, res, userId) => {
    res.ok(await Suggestions.acceptAll(userId, body(req)))
  }, { change: true }),

  destroyComment: taskAction(async (req, res, userId) => {
    await Tasks.removeComment(userId, req.param('commentId'))
    res.ok({ ok: true })
  }, { change: true })
}
