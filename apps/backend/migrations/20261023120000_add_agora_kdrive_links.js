/**
 * Agora: links to Google documents in a circle's Files page (kDrive version).
 *
 * agora_kdrive_links   one row per link a member added: the address of a
 *                      Google Doc, Sheet, Slides, Form or Drive file or folder,
 *                      a title, which kDrive folder of the circle it is listed
 *                      in (null: the circle's own folder), and who added it.
 *                      The document stays at Google; nothing is stored in kDrive.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_kdrive_links', table => {
    table.bigIncrements('id')
    table.bigInteger('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE')
    table.bigInteger('folder_id')
    table.bigInteger('user_id').references('id').inTable('users').onDelete('SET NULL')
    table.string('kind', 10).notNullable()
    table.string('title', 255).notNullable()
    table.text('url').notNullable()
    table.timestamp('created_at')
    table.timestamp('updated_at')
    table.index(['group_id', 'folder_id'])
  })
  await knex.raw(`
    ALTER TABLE agora_kdrive_links
      ALTER CONSTRAINT agora_kdrive_links_group_id_foreign DEFERRABLE INITIALLY DEFERRED,
      ALTER CONSTRAINT agora_kdrive_links_user_id_foreign DEFERRABLE INITIALLY DEFERRED
  `)
}

exports.down = async function (knex) {
  await knex.schema.dropTable('agora_kdrive_links')
}
