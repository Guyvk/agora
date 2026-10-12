/**
 * Agora contacts: one shared list of the people and organisations 7BP works
 * with outside Agora (partners, press, funders, interested people).
 *
 * agora_contacts         one row per person or organisation
 * agora_contact_notes    what was said or done, by whom and when
 * agora_contact_changes  who changed which fields when. It names fields, never
 *                        their contents, so it holds no personal data and stays
 *                        after a contact is deleted.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_contacts', table => {
    table.bigIncrements('id').primary()
    table.string('name').notNullable()
    table.string('organisation')
    table.string('kind').notNullable().defaultTo('partner') // partner | press | funder | interested | other
    table.string('email')
    table.string('phone')
    table.string('website')
    table.string('status').notNullable().defaultTo('new') // new | in_touch | active | paused
    table.bigInteger('circle_id').references('id').inTable('groups').onDelete('SET NULL').index()
    table.text('source') // where the details came from
    table.boolean('consent').notNullable().defaultTo(false) // agreed to be contacted by 7BP
    table.date('follow_up_on')
    table.text('follow_up_what')
    table.bigInteger('follow_up_owner_id').references('id').inTable('users').onDelete('SET NULL').index()
    table.bigInteger('created_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.bigInteger('updated_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  await knex.schema.createTable('agora_contact_notes', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('contact_id').notNullable().references('id').inTable('agora_contacts').onDelete('CASCADE').index()
    table.bigInteger('author_id').references('id').inTable('users').onDelete('SET NULL')
    table.text('body').notNullable()
    table.timestamp('created_at')
  })

  await knex.schema.createTable('agora_contact_changes', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('contact_id').notNullable().index() // no foreign key: kept after a contact is deleted
    table.bigInteger('user_id').references('id').inTable('users').onDelete('SET NULL')
    table.string('action').notNullable() // created | updated | note | deleted
    table.jsonb('fields')
    table.timestamp('created_at')
  })

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${table} alter constraint ${constraint} deferrable initially deferred`)
  }
}

const FOREIGN_KEYS = [
  ['agora_contacts', 'agora_contacts_circle_id_foreign'],
  ['agora_contacts', 'agora_contacts_follow_up_owner_id_foreign'],
  ['agora_contacts', 'agora_contacts_created_by_id_foreign'],
  ['agora_contacts', 'agora_contacts_updated_by_id_foreign'],
  ['agora_contact_notes', 'agora_contact_notes_contact_id_foreign'],
  ['agora_contact_notes', 'agora_contact_notes_author_id_foreign'],
  ['agora_contact_changes', 'agora_contact_changes_user_id_foreign']
]

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_contact_changes')
  await knex.schema.dropTableIfExists('agora_contact_notes')
  await knex.schema.dropTableIfExists('agora_contacts')
}
