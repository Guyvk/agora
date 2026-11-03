/**
 * Agora: profiles people can claim later.
 *
 * A contact of the kind "team" can hold a short profile, for example from the
 * sheet someone filled in at the activist council: country, what they do and
 * can do, why they are here, skills and a photo. A steward makes a claim link
 * for it; the person opens the link, makes an account (or logs in) and the
 * profile becomes part of their own Agora profile.
 *
 * New columns on agora_contacts:
 *   country, offers, why_here, skills, photo_url   the profile
 *   claimed_user_id, claimed_at                     who claimed it, and when
 *   claim_token_hash, claim_token_created_at        the claim link. Only a
 *                                                    sha256 hash of its secret is
 *                                                    kept, never the secret itself
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('agora_contacts', table => {
    table.string('country')
    table.text('offers') // what I do and can do
    table.text('why_here') // why I am here
    table.text('skills') // separated by commas
    table.string('photo_url', 1000)
    table.bigInteger('claimed_user_id').references('id').inTable('users').onDelete('SET NULL').index()
    table.timestamp('claimed_at')
    table.string('claim_token_hash', 64).unique()
    table.timestamp('claim_token_created_at')
  })
  // Like Hylo's own tables: links are checked at the end of a transaction.
  await knex.raw('alter table agora_contacts alter constraint agora_contacts_claimed_user_id_foreign deferrable initially deferred')
}

exports.down = async function (knex) {
  await knex.schema.alterTable('agora_contacts', table => {
    table.dropColumn('claim_token_created_at')
    table.dropColumn('claim_token_hash')
    table.dropColumn('claimed_at')
    table.dropColumn('claimed_user_id')
    table.dropColumn('photo_url')
    table.dropColumn('skills')
    table.dropColumn('why_here')
    table.dropColumn('offers')
    table.dropColumn('country')
  })
}
