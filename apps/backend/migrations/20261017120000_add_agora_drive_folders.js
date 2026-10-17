/**
 * Agora: which Google Drive folder belongs to which circle.
 *
 * A circle's Files page shows, and adds to, only the folder linked here. Links
 * are made by an administrator with scripts/agora-drive-link.js, never matched
 * by name: anyone can make a circle and give it any name.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_drive_folders', table => {
    table.bigInteger('group_id').primary().references('id').inTable('groups').onDelete('CASCADE')
    table.string('folder_id', 200).notNullable()
    table.text('linked_by') // who made the link, in words: it is made from the Terminal
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })
  await knex.raw(`
    ALTER TABLE agora_drive_folders
      ALTER CONSTRAINT agora_drive_folders_group_id_foreign DEFERRABLE INITIALLY DEFERRED
  `)
}

exports.down = async function (knex) {
  await knex.schema.dropTable('agora_drive_folders')
}
