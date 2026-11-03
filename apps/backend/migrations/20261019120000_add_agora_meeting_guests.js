/**
 * Agora: guests in a meeting.
 *
 * A member who may edit an event can make one guest link for it. People
 * without an Agora account open that link, give their name and join the call.
 *
 * meeting_guest_links  one row per event. Only a hash (sha256) of the link's
 *                      secret part is kept, never the secret itself. The link
 *                      works until expires_at, unless revoked_at is set.
 *                      Making a new link replaces the hash in the same row.
 * meeting_guests       one row per guest who joined a meeting: the name they
 *                      gave, and whether their voice may be in the notes. The
 *                      guest's own browser keeps a second secret (key_hash is
 *                      its sha256), so one guest cannot speak in another's name.
 * meeting_segments     gets guest_id: a piece of speech is by a member
 *                      (user_id) or by a guest (guest_id), never both.
 */

const FOREIGN_KEYS = [
  ['meeting_guest_links', 'meeting_guest_links_post_id_foreign'],
  ['meeting_guest_links', 'meeting_guest_links_created_by_id_foreign'],
  ['meeting_guests', 'meeting_guests_session_id_foreign'],
  ['meeting_guests', 'meeting_guests_link_id_foreign'],
  ['meeting_segments', 'meeting_segments_guest_id_foreign']
]

exports.up = async function (knex) {
  await knex.schema.createTable('meeting_guest_links', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('post_id').notNullable().references('id').inTable('posts').onDelete('CASCADE').unique()
    table.string('token_hash', 64).notNullable()
    table.bigInteger('created_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.timestamp('expires_at').notNullable()
    table.timestamp('revoked_at')
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  await knex.schema.createTable('meeting_guests', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('session_id').notNullable().references('id').inTable('meeting_sessions').onDelete('CASCADE').index()
    table.bigInteger('link_id').references('id').inTable('meeting_guest_links').onDelete('SET NULL')
    table.string('name', 60).notNullable()
    table.string('key_hash', 64).notNullable()
    table.boolean('notes_consent').notNullable().defaultTo(false)
    table.timestamp('joined_at')
    table.timestamp('left_at')
  })

  await knex.schema.alterTable('meeting_segments', table => {
    table.bigInteger('guest_id').references('id').inTable('meeting_guests').onDelete('CASCADE').index()
  })
  await knex.raw('alter table meeting_segments alter column user_id drop not null')
  await knex.raw('alter table meeting_segments add constraint meeting_segments_member_or_guest check ((user_id is null) <> (guest_id is null))')

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${table} alter constraint ${constraint} deferrable initially deferred`)
  }
}

exports.down = async function (knex) {
  await knex('meeting_segments').whereNotNull('guest_id').del()
  await knex.raw('alter table meeting_segments drop constraint if exists meeting_segments_member_or_guest')
  await knex.schema.alterTable('meeting_segments', table => {
    table.dropColumn('guest_id')
  })
  await knex.raw('alter table meeting_segments alter column user_id set not null')
  await knex.schema.dropTableIfExists('meeting_guests')
  await knex.schema.dropTableIfExists('meeting_guest_links')
}
