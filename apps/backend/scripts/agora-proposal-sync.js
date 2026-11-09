/**
 * Agora: keeps the "Proposals" menu item in the 7BP circle and the living
 * Agora proposal post in it. Safe to run again: it only adds what is missing
 * and otherwise updates the post text (comments stay).
 *
 *   node scripts/agora-proposal-sync.js <html file> [post id]
 *
 * Source of the text: ~/agora-proposal/proposal.html on Guy's Mac,
 * mirrored from the Claude Doc "Agora: what we are building and how it is run".
 */
require('@babel/register')
const fs = require('fs')
const skiff = require('../lib/skiff')

const GROUP_SLUG = '7bp'
const AUTHOR_ID = 1 // Guy
const TITLE = 'Agora: what we are building and how it is run'
const TOPIC = 'proposals'

async function run () {
  const [htmlPath, postIdArg] = process.argv.slice(2)
  if (!htmlPath) throw new Error('Usage: node scripts/agora-proposal-sync.js <html file> [post id]')
  const html = fs.readFileSync(htmlPath, 'utf8').trim()
  const knex = bookshelf.knex
  const group = await knex('groups').where({ slug: GROUP_SLUG }).first('id')
  if (!group) throw new Error(`No circle with slug ${GROUP_SLUG}`)

  // 1. The menu item
  let view = await knex('group_views').where({ group_id: group.id, type: 'custom', name: 'Proposals' }).first('id')
  if (!view) {
    const { createGroupView } = require('../api/graphql/mutations/group_views')
    const firstCircle = await knex('group_views').where({ group_id: group.id, type: 'group' }).orderBy('order').first('id')
    const made = await createGroupView({
      userId: AUTHOR_ID,
      groupId: group.id,
      type: 'custom',
      name: 'Proposals',
      icon: 'Vote',
      topics: [TOPIC],
      settings: { postTypes: ['discussion', 'proposal'], defaultSort: 'updated', activePostsOnly: false, defaultViewMode: 'cards' },
      orderInFrontOfViewId: firstCircle && firstCircle.id
    })
    view = { id: made.id }
    console.log(`Made the Proposals menu item (view ${made.id}).`)
  } else {
    console.log(`Proposals menu item already there (view ${view.id}).`)
  }

  // 2. The post
  let postId = postIdArg
  if (!postId) {
    const existing = await knex('posts')
      .join('groups_posts', 'groups_posts.post_id', 'posts.id')
      .where({ 'groups_posts.group_id': group.id, 'posts.user_id': AUTHOR_ID, 'posts.name': TITLE, 'posts.active': true })
      .first('posts.id')
    postId = existing && existing.id
  }
  const params = { name: TITLE, description: html, type: 'discussion', group_ids: [String(group.id)], topicNames: [TOPIC] }
  if (postId) {
    const updatePost = require('../api/models/post/updatePost').default
    await updatePost(AUTHOR_ID, postId, params)
    console.log(`Updated the proposal post ${postId}.`)
  } else {
    const createPost = require('../api/models/post/createPost').default
    const post = await createPost(AUTHOR_ID, params)
    console.log(`Made the proposal post ${post.id}.`)
  }
}

skiff.lift({
  start: function () {
    run()
      .catch(err => {
        console.error(`\nCould not sync the proposal: ${err.stack || err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
