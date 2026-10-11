/**
 * Agora meetings: a meeting room attached to an event post, where what people
 * say is turned into text and then into minutes.
 *
 * meeting_sessions      one row per meeting held on an event
 * meeting_participants  who joined, and whether their voice may be transcribed
 * meeting_segments      one row per stretch of speech. The audio is removed as
 *                       soon as it has been turned into text.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('meeting_sessions', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('post_id').notNullable().references('id').inTable('posts').index()
    table.string('room_name').notNullable()
    table.string('status').notNullable().defaultTo('open') // open | closing | closed
    table.bigInteger('started_by_id').references('id').inTable('users')
    table.bigInteger('ended_by_id').references('id').inTable('users')
    table.bigInteger('minutes_post_id').references('id').inTable('posts')
    table.timestamp('started_at')
    table.timestamp('ended_at')
    table.timestamp('last_activity_at')
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  await knex.schema.createTable('meeting_participants', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('session_id').notNullable().references('id').inTable('meeting_sessions').onDelete('CASCADE').index()
    table.bigInteger('user_id').notNullable().references('id').inTable('users')
    table.boolean('notes_consent').notNullable().defaultTo(true)
    table.timestamp('joined_at')
    table.unique(['session_id', 'user_id'])
  })

  await knex.schema.createTable('meeting_segments', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('session_id').notNullable().references('id').inTable('meeting_sessions').onDelete('CASCADE').index()
    table.bigInteger('user_id').notNullable().references('id').inTable('users')
    table.timestamp('spoken_at').notNullable()
    table.integer('duration_ms').notNullable().defaultTo(0)
    table.string('mime_type')
    table.binary('audio')
    table.text('text')
    table.string('status').notNullable().defaultTo('pending') // pending | done | empty | failed
    table.text('error')
    table.timestamp('created_at')
    table.timestamp('updated_at')
    table.index(['session_id', 'spoken_at'])
  })
}

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('meeting_segments')
  await knex.schema.dropTableIfExists('meeting_participants')
  await knex.schema.dropTableIfExists('meeting_sessions')
}
