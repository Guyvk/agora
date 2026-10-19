/**
 * Agora: Meetings and Events, and the personal calendar feed.
 *
 * Hylo has one kind of post with a date and time, the event. Agora splits it
 * in two, with one engine underneath (see lib/agora/eventKinds.js):
 *
 * posts.agora_kind       'meeting' (for the team: always a meeting room,
 *                        minutes, never public) or 'event' (a gathering with
 *                        a place: no meeting room, may be public). Empty for
 *                        posts that are not events.
 * posts.agora_for_all    true when a steward of the main 7BP circle marked it
 *                        "for all of 7BP": it then shows in everyone's Agora
 *                        calendar and calendar feed.
 *
 * agora_calendar_feeds   one row per person who made a calendar link: the
 *                        secret part of the link. Making a new link replaces
 *                        the row, so the old link stops working.
 *
 * Every event that exists already becomes a Meeting, here in the migration.
 * It already has its meeting room (pull request #20), so nothing else
 * changes for it. Running the migration again is not possible (knex keeps
 * track), and the update only touches events without a kind.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('posts', table => {
    table.string('agora_kind', 10)
    table.boolean('agora_for_all').notNullable().defaultTo(false)
  })
  await knex.raw("alter table posts add constraint posts_agora_kind_check check (agora_kind is null or agora_kind in ('meeting', 'event'))")
  await knex.raw('create index posts_agora_for_all_index on posts (start_time) where agora_for_all')

  await knex('posts').where('type', 'event').whereNull('agora_kind').update({ agora_kind: 'meeting' })

  await knex.schema.createTable('agora_calendar_feeds', table => {
    table.bigInteger('user_id').primary().references('id').inTable('users').onDelete('CASCADE')
    table.string('token', 64).notNullable().unique()
    table.timestamp('created_at')
  })
  await knex.raw('alter table agora_calendar_feeds alter constraint agora_calendar_feeds_user_id_foreign deferrable initially deferred')
}

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_calendar_feeds')
  await knex.raw('drop index if exists posts_agora_for_all_index')
  await knex.raw('alter table posts drop constraint if exists posts_agora_kind_check')
  await knex.schema.alterTable('posts', table => {
    table.dropColumn('agora_kind')
    table.dropColumn('agora_for_all')
  })
}
