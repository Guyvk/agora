/**
 * Agora: proposing a claimable profile to a member.
 *
 * The sheets have no email addresses, so a profile cannot be matched to an
 * account for certain. Two ways to suggest one, and the person always confirms:
 *   - a steward proposes a profile to a member (agora_contacts.proposed_user_id
 *     and proposed_at, see lib/agora/claims.js);
 *   - Agora guesses from the names. When a member says "This isn't me",
 *     agora_claim_dismissals remembers it, so that profile is never proposed
 *     to that member again.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('agora_contacts', table => {
    table.bigInteger('proposed_user_id').references('id').inTable('users').onDelete('SET NULL').index()
    table.timestamp('proposed_at')
  })
  await knex.raw('alter table agora_contacts alter constraint agora_contacts_proposed_user_id_foreign deferrable initially deferred')

  await knex.schema.createTable('agora_claim_dismissals', table => {
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.bigInteger('contact_id').notNullable().references('id').inTable('agora_contacts').onDelete('CASCADE')
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
    table.primary(['user_id', 'contact_id'])
  })
  await knex.raw('alter table agora_claim_dismissals alter constraint agora_claim_dismissals_user_id_foreign deferrable initially deferred')
  await knex.raw('alter table agora_claim_dismissals alter constraint agora_claim_dismissals_contact_id_foreign deferrable initially deferred')
}

exports.down = async function (knex) {
  await knex.schema.dropTable('agora_claim_dismissals')
  await knex.schema.alterTable('agora_contacts', table => {
    table.dropColumn('proposed_at')
    table.dropColumn('proposed_user_id')
  })
}
