/**
 * Agora meetings: make the meeting tables' links deferrable, like Hylo's own
 * tables. Without it, emptying the test database fails once a meeting exists.
 */

const FOREIGN_KEYS = [
  ['meeting_sessions', 'meeting_sessions_post_id_foreign'],
  ['meeting_sessions', 'meeting_sessions_started_by_id_foreign'],
  ['meeting_sessions', 'meeting_sessions_ended_by_id_foreign'],
  ['meeting_sessions', 'meeting_sessions_minutes_post_id_foreign'],
  ['meeting_participants', 'meeting_participants_session_id_foreign'],
  ['meeting_participants', 'meeting_participants_user_id_foreign'],
  ['meeting_segments', 'meeting_segments_session_id_foreign'],
  ['meeting_segments', 'meeting_segments_user_id_foreign']
]

exports.up = async function (knex) {
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${table} alter constraint ${constraint} deferrable initially deferred`)
  }
}

exports.down = async function (knex) {
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${table} alter constraint ${constraint} not deferrable`)
  }
}
