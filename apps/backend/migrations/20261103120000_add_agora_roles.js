/**
 * Agora: who runs Agora, chosen in the admin area. See lib/agora/admins.js.
 *
 * agora_roles          one row per person who has an Agora-wide role:
 *                      'admin' (the whole admin area) or 'helpdesk' (only the
 *                      Help desk tab), who gave it and when. A member without a
 *                      role has no row.
 * agora_role_changes   every change of a role made in the admin area: whose
 *                      role, who changed it, from what to what, and when. The
 *                      Activity log tab shows these. Rows are never changed.
 *
 * The settings AGORA_ADMINS and AGORA_HELPDESK_ADMINS in apps/backend/.env
 * still work next to this table, and the admin area cannot change them.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_roles', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE').unique()
    table.string('role', 20).notNullable() // admin | helpdesk
    table.bigInteger('granted_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.timestamp('created_at')
  })

  await knex.schema.createTable('agora_role_changes', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE').index()
    table.bigInteger('changed_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.string('from_role', 20).notNullable() // member | helpdesk | admin
    table.string('to_role', 20).notNullable() // member | helpdesk | admin
    table.timestamp('created_at').index()
  })

  // Deferrable links, like Hylo's own and the other Agora tables
  for (const [tableName, column] of [['agora_roles', 'user_id'], ['agora_roles', 'granted_by_id'], ['agora_role_changes', 'user_id'], ['agora_role_changes', 'changed_by_id']]) {
    await knex.raw(`ALTER TABLE ${tableName} ALTER CONSTRAINT ${tableName}_${column}_foreign DEFERRABLE INITIALLY DEFERRED`)
  }
}

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_role_changes')
  await knex.schema.dropTableIfExists('agora_roles')
}
