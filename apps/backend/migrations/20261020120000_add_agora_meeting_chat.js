/**
 * Agora: a chat next to the call, and knowing who is still in a meeting.
 *
 * meeting_chat_messages  one row per chat message written during a meeting,
 *                        by a member (user_id) or a guest (guest_id), never
 *                        both. Plain text only. The messages go into the
 *                        minutes when the meeting ends.
 * meeting_participants   gets last_seen_at (the room page says "still here"
 *                        every few seconds) and left_at (pressed Leave).
 * meeting_guests         gets last_seen_at, in the same way.
 *
 * With last_seen_at the server can tell when everybody has gone, and end a
 * meeting that nobody ended by hand, so its minutes are still written.
 */

const FOREIGN_KEYS = [
  ['meeting_chat_messages', 'meeting_chat_messages_session_id_foreign'],
  ['meeting_chat_messages', 'meeting_chat_messages_user_id_foreign'],
  ['meeting_chat_messages', 'meeting_chat_messages_guest_id_foreign']
]

exports.up = async function (knex) {
  await knex.schema.createTable('meeting_chat_messages', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('session_id').notNullable().references('id').inTable('meeting_sessions').onDelete('CASCADE')
    table.bigInteger('user_id').references('id').inTable('users').onDelete('CASCADE')
    table.bigInteger('guest_id').references('id').inTable('meeting_guests').onDelete('CASCADE')
    table.text('text').notNullable()
    table.timestamp('created_at').notNullable()
    table.index(['session_id', 'id'])
  })
  await knex.raw('alter table meeting_chat_messages add constraint meeting_chat_messages_member_or_guest check ((user_id is null) <> (guest_id is null))')

  await knex.schema.alterTable('meeting_participants', table => {
    table.timestamp('last_seen_at')
    table.timestamp('left_at')
  })
  await knex.schema.alterTable('meeting_guests', table => {
    table.timestamp('last_seen_at')
  })

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${table} alter constraint ${constraint} deferrable initially deferred`)
  }
}

exports.down = async function (knex) {
  await knex.schema.alterTable('meeting_guests', table => {
    table.dropColumn('last_seen_at')
  })
  await knex.schema.alterTable('meeting_participants', table => {
    table.dropColumn('last_seen_at')
    table.dropColumn('left_at')
  })
  await knex.schema.dropTableIfExists('meeting_chat_messages')
}
