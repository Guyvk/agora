/**
 * Agora: a random salt per guest link.
 *
 * meeting_guest_links  gets token_salt: 32 random bytes (base64url) made anew
 *                      each time a link is made or replaced. The link's
 *                      secret is an HMAC of this salt and the link's details
 *                      with the server's key (lib/agora/meetingGuests.js), so
 *                      members can be shown the link again, and nobody can
 *                      rebuild it from the key and a few small numbers.
 *                      Links made before this have no salt: they keep working,
 *                      but cannot be shown again.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('meeting_guest_links', table => {
    table.string('token_salt', 64)
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable('meeting_guest_links', table => {
    table.dropColumn('token_salt')
  })
}
