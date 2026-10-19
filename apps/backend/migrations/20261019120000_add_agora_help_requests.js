/**
 * Agora: Help and the Help desk, a small ticket system. See lib/agora/help.js.
 *
 * agora_help_requests   one row per request a person sent from the Help
 *                       window: a fault, a wish or a question, how urgent it
 *                       is, a title and a summary, what they wrote (or the
 *                       whole chat with Claude), the page they were on, their
 *                       browser and screen, the version of Agora, its status
 *                       on the Help desk, an internal note, and the builder
 *                       task written from it.
 * agora_help_replies    the messages on a request after it was sent: replies
 *                       from the Help desk and answers from the person.
 * agora_help_chats      a chat with Claude that has not become a request
 *                       (yet). Kept for a week at most.
 *
 * Only the person who sent a request and the Help desk admins can read it.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_help_requests', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').references('id').inTable('users').onDelete('CASCADE').index()
    table.string('status', 20).notNullable().defaultTo('new') // new | looking | building | fixed | wont_do
    table.string('type', 20).notNullable().defaultTo('fault') // fault | wish | question
    table.string('urgency', 20).notNullable().defaultTo('normal') // low | normal | urgent
    table.string('mode', 10).notNullable().defaultTo('form') // form | chat
    table.string('title', 200).notNullable()
    table.text('summary')
    table.text('what_happened')
    table.text('what_expected')
    table.jsonb('conversation') // [{ role: 'person' | 'claude', text, at }]
    table.string('page_url', 1000)
    table.string('user_agent', 500)
    table.string('screen', 50)
    table.string('app_version', 64)
    table.text('internal_note')
    table.text('builder_task')
    table.string('builder_task_link', 1000)
    table.boolean('unread_by_user').notNullable().defaultTo(false)
    table.boolean('unread_by_desk').notNullable().defaultTo(true)
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  await knex.schema.createTable('agora_help_replies', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('request_id').notNullable().references('id').inTable('agora_help_requests').onDelete('CASCADE').index()
    table.bigInteger('author_id').references('id').inTable('users').onDelete('SET NULL')
    table.boolean('from_desk').notNullable().defaultTo(false)
    table.text('body').notNullable()
    table.timestamp('created_at')
  })

  await knex.schema.createTable('agora_help_chats', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE').index()
    table.jsonb('messages') // exactly what was sent to and came back from Claude
    table.bigInteger('request_id').references('id').inTable('agora_help_requests').onDelete('SET NULL')
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const [tableName, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${tableName} alter constraint ${constraint} deferrable initially deferred`)
  }
}

const FOREIGN_KEYS = [
  ['agora_help_requests', 'agora_help_requests_user_id_foreign'],
  ['agora_help_replies', 'agora_help_replies_request_id_foreign'],
  ['agora_help_replies', 'agora_help_replies_author_id_foreign'],
  ['agora_help_chats', 'agora_help_chats_user_id_foreign'],
  ['agora_help_chats', 'agora_help_chats_request_id_foreign']
]

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_help_chats')
  await knex.schema.dropTableIfExists('agora_help_replies')
  await knex.schema.dropTableIfExists('agora_help_requests')
}
