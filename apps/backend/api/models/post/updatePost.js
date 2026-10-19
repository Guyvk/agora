import { GraphQLError } from 'graphql'
import setupPostAttrs from './setupPostAttrs'
import updateChildren from './updateChildren'
import { isEqual } from 'lodash'
import {
  updateGroups,
  updateAllMedia,
  updateFollowers
} from './util'
import { partitionImageUrls } from '../../../lib/uploader/rehostRemoteMedia'
import { keepMeetingLink, lockMeetingLinkParam, refuseOutsideCallLocation } from '../../../lib/agora/meetingLink' // Agora: events keep their meeting room

export default function updatePost (userId, id, params) {
  if (!id) throw new GraphQLError('updatePost called with no ID')
  const { hosted: hostedImageUrls, remote: remoteImageUrls } = partitionImageUrls(params.imageUrls)
  const paramsForUpdate = params.imageUrls
    ? { ...params, imageUrls: hostedImageUrls }
    : params
  return setupPostAttrs(userId, paramsForUpdate)
    .then(attrs => bookshelf.transaction(transacting =>
      Post.find(id).then(post => {
        if (!post) throw new GraphQLError('Post not found')
        const updatableTypes = [
          Post.Type.ACTION,
          Post.Type.CHAT,
          Post.Type.DISCUSSION,
          Post.Type.EVENT,
          Post.Type.OFFER,
          Post.Type.PROJECT,
          Post.Type.PROPOSAL,
          Post.Type.REQUEST,
          Post.Type.RESOURCE,
          Post.Type.SUBMISSION
        ]
        if (!updatableTypes.includes(post.get('type'))) {
          throw new GraphQLError("This post can't be modified")
        }

        if (!isEqual(post.details(), paramsForUpdate.description) || !isEqual(post.title(), paramsForUpdate.name)) {
          attrs.edited_at = new Date()
        }

        // Agora: calls only in the meeting room, so no other platform's link as the location
        refuseOutsideCallLocation(attrs.type || post.get('type'), attrs.location)

        // important: record relevant event changes before post is saved
        // Agora: with the meeting room as the link, whatever link the client sent
        const eventChanges = post.isEvent() && getEventChanges({ post, params: lockMeetingLinkParam(post, paramsForUpdate) })

        // Agora: an event's video call link stays its meeting room, whatever was sent
        return post.save(keepMeetingLink(post, attrs), { patch: true, transacting })
          .tap(updatedPost => afterUpdatingPost(updatedPost, { params: paramsForUpdate, userId, eventChanges, transacting }))
      })))
    .then(post => {
      if (remoteImageUrls.length > 0) {
        Queue.classMethod('Post', 'rehostAndAttachImages', {
          postId: id,
          userId,
          imageUrls: remoteImageUrls,
          startPosition: (hostedImageUrls || []).length
        }, 0)
      }
      return post
    })
}

export function afterUpdatingPost (post, opts) {
  const {
    params,
    params: { requests, group_ids, topicNames, memberIds, eventInviteeIds, proposalOptions },
    userId,
    eventChanges,
    transacting
  } = opts

  return post.ensureLoad(['groups'])
    .then(() => Promise.all([
      updateChildren(post, requests, transacting),
      updateGroups(post, group_ids, transacting),
      updateAllMedia(post, params, transacting),
      Tag.updateForPost(post, topicNames, userId, transacting),
      updateFollowers(post, transacting)
    ]))
    .then(() => post.isEvent() && Queue.classMethod('Post', 'processEventUpdated', { postId: post.id, eventInviteeIds, userId, eventChanges }))
    .then(() => post.get('type') === 'project' && memberIds && post.setProjectMembers(memberIds, { transacting }))
    .then(() => post.get('type') === 'proposal' && proposalOptions && post.updateProposalOptions({ options: proposalOptions, userId, opts: { transacting } }))
    .then(() => Post.afterRelatedMutation(post.id, { changeContext: 'edit' }))
}

export function getEventChanges({ post, params }) {
  return {
    start_time: post.get('start_time').getTime() !== params.startTime.getTime() && params.startTime,
    end_time: post.get('end_time').getTime() !== params.endTime.getTime() && params.endTime,
    location: post.get('location') !== params.location && params.location,
    meeting_link: post.get('meeting_link') !== params.meetingLink && params.meetingLink
  }
}
