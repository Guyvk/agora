/**
 * Agora: talks to the server part of the playbook page through GraphQL
 * (apps/backend/api/graphql/agora/playbook.js). Who may read or change the
 * playbook is checked there, not here.
 */
const GRAPHQL = '/noo/graphql'

export const PLAYBOOK_QUERY = `query AgoraPlaybook ($groupSlug: String) {
  agoraPlaybook(groupSlug: $groupSlug) {
    groupId
    groupName
    canEdit
    statuses
    chapters {
      id position title status summary link updatedAt
      owner { id name }
      updatedBy { id name }
    }
    members { id name }
  }
}`

const CHAPTER_FIELDS = 'id position title status summary link updatedAt owner { id name } updatedBy { id name }'

export const CREATE_CHAPTER = `mutation CreateAgoraPlaybookChapter ($groupId: ID!, $data: AgoraPlaybookChapterInput!) {
  createAgoraPlaybookChapter(groupId: $groupId, data: $data) { ${CHAPTER_FIELDS} }
}`

export const UPDATE_CHAPTER = `mutation UpdateAgoraPlaybookChapter ($id: ID!, $data: AgoraPlaybookChapterInput!) {
  updateAgoraPlaybookChapter(id: $id, data: $data) { ${CHAPTER_FIELDS} }
}`

export const DELETE_CHAPTER = `mutation DeleteAgoraPlaybookChapter ($id: ID!) {
  deleteAgoraPlaybookChapter(id: $id) { success }
}`

export const PLAYBOOK_URL = groupSlug => `/groups/${groupSlug}/playbook`

export async function playbookApi (query, variables = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const body = await res.json().catch(() => ({}))
  if (body.errors && body.errors.length) {
    throw new Error(body.errors[0].message || 'Something went wrong. Try again in a minute.')
  }
  if (!res.ok || !body.data) throw new Error('Something went wrong. Try again in a minute.')
  return body.data
}
