/**
 * Agora: the GraphQL part of the 7BP Home look (left bar, header, welcome
 * page). Schema in mainCircle.graphql; the logic is in lib/agora/mainCircle.js.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import MainCircle from '../../../lib/agora/mainCircle'

export const agoraMainCircleTypeDefs = readFileSync(join(__dirname, 'mainCircle.graphql')).toString()

export function makeAgoraMainCircleQueries () {
  return {
    agoraMainCircle: (root, args, context) => MainCircle.mainCircleFor(context.currentUserId)
  }
}
