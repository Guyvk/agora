/**
 * Agora: what a post page shows about tasks from meetings, so PostDetail needs one line:
 * on a discussion post the action points of its minutes (when it is a minutes post), on an
 * event post the open tasks from last time. Both hide themselves when there is nothing.
 * Props: post ({ id, type })
 */
import React from 'react'
import MinutesActionPoints from './MinutesActionPoints'
import OpenTasksFromLastTime from './OpenTasksFromLastTime'

export default function PostTaskBlocks ({ post }) {
  if (!post || !post.id) return null
  if (post.type === 'discussion') return <MinutesActionPoints postId={post.id} />
  if (post.type === 'event') return <OpenTasksFromLastTime postId={post.id} />
  return null
}
