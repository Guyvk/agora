/**
 * Agora: the playbook page of a group.
 *
 * agora_playbook_chapters   one row per chapter of a group's playbook: its
 *                           place in the list, title, status, owner, a short
 *                           text and a link (a Google Doc or a post), and who
 *                           changed it last and when.
 *
 * Stewards of the group (Administration) change it; members read it.
 * See lib/agora/playbook.js.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_playbook_chapters', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE').index()
    table.integer('position').notNullable().defaultTo(0)
    table.string('title', 200).notNullable()
    table.string('status', 20).notNullable().defaultTo('not_started') // not_started | draft | in_review | agreed
    table.bigInteger('owner_id').references('id').inTable('users').onDelete('SET NULL')
    table.text('summary')
    table.string('link', 1000)
    table.bigInteger('created_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.bigInteger('updated_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const constraint of FOREIGN_KEYS) {
    await knex.raw(`alter table agora_playbook_chapters alter constraint ${constraint} deferrable initially deferred`)
  }
}

const FOREIGN_KEYS = [
  'agora_playbook_chapters_group_id_foreign',
  'agora_playbook_chapters_owner_id_foreign',
  'agora_playbook_chapters_created_by_id_foreign',
  'agora_playbook_chapters_updated_by_id_foreign'
]

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_playbook_chapters')
}
