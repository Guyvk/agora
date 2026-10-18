/**
 * Agora: the GraphQL part of the playbook page. The schema is in
 * playbook.graphql next to this file; who may do what is checked in
 * lib/agora/playbook.js. makeSchema.js adds both to Hylo's schema, for
 * logged-in people only.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { GraphQLError } from 'graphql'
import Playbook from '../../../lib/agora/playbook'

export const agoraPlaybookTypeDefs = readFileSync(join(__dirname, 'playbook.graphql')).toString()

/** Turns a PlaybookError into a message the page can show; other errors stay hidden. */
function answer (fn) {
  return async (root, args, context) => {
    try {
      return await fn(context.currentUserId, args)
    } catch (err) {
      if (err instanceof Playbook.PlaybookError) throw new GraphQLError(err.message)
      throw err
    }
  }
}

export function makeAgoraPlaybookQueries () {
  return {
    agoraPlaybook: answer((userId, { groupSlug, groupId }) => Playbook.playbook(userId, { groupSlug, groupId }))
  }
}

export function makeAgoraPlaybookMutations () {
  return {
    createAgoraPlaybookChapter: answer((userId, { groupId, data }) => Playbook.createChapter(userId, groupId, data || {})),
    updateAgoraPlaybookChapter: answer((userId, { id, data }) => Playbook.updateChapter(userId, id, data || {})),
    deleteAgoraPlaybookChapter: answer(async (userId, { id }) => {
      await Playbook.deleteChapter(userId, id)
      return { success: true }
    })
  }
}
