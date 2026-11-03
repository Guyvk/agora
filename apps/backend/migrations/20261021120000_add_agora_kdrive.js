/**
 * Agora: circle files in Infomaniak kDrive (lib/agora/kdrive.js).
 *
 * agora_kdrive_folders   which kDrive folder belongs to which circle or space.
 *                        Agora makes the folder itself the first time a member
 *                        opens the circle's Files page, and remembers it here.
 *                        minutes_folder_id is its "Minutes" folder, once made.
 * agora_kdrive_items     who added a file or folder through Agora. kDrive only
 *                        knows Agora's own account, so this is how the Files page
 *                        names the member, and how it knows who may rename or
 *                        delete what.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_kdrive_folders', table => {
    table.bigInteger('group_id').primary().references('id').inTable('groups').onDelete('CASCADE')
    table.bigInteger('folder_id').notNullable().unique()
    table.bigInteger('minutes_folder_id')
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })
  await knex.schema.createTable('agora_kdrive_items', table => {
    table.bigInteger('file_id').primary()
    table.bigInteger('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE')
    table.bigInteger('user_id').references('id').inTable('users').onDelete('SET NULL')
    table.string('kind', 10).notNullable()
    table.timestamp('created_at')
    table.index(['group_id'])
  })
  await knex.raw(`
    ALTER TABLE agora_kdrive_folders
      ALTER CONSTRAINT agora_kdrive_folders_group_id_foreign DEFERRABLE INITIALLY DEFERRED
  `)
  await knex.raw(`
    ALTER TABLE agora_kdrive_items
      ALTER CONSTRAINT agora_kdrive_items_group_id_foreign DEFERRABLE INITIALLY DEFERRED,
      ALTER CONSTRAINT agora_kdrive_items_user_id_foreign DEFERRABLE INITIALLY DEFERRED
  `)
}

exports.down = async function (knex) {
  await knex.schema.dropTable('agora_kdrive_items')
  await knex.schema.dropTable('agora_kdrive_folders')
}
