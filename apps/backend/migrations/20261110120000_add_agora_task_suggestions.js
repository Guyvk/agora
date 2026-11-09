/**
 * Agora tasks part 4: tasks suggested by meeting minutes.
 *
 * agora_task_suggestions         one row per action point of a minutes post. It stays a
 *                                suggestion until the person named, the host of the meeting or a
 *                                steward says yes (a task is made, task_id is set) or no.
 * agora_task_suggestion_people   who the action point is for (matched from the names in the minutes)
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_task_suggestions', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('group_id').notNullable().references('id').inTable('groups')
    table.bigInteger('meeting_session_id').references('id').inTable('meeting_sessions').onDelete('SET NULL')
    table.bigInteger('minutes_post_id').notNullable().references('id').inTable('posts')
    table.integer('action_index').notNullable().defaultTo(0)
    table.string('who_text', 500)
    table.text('what').notNullable()
    table.date('due_date')
    table.bigInteger('project_post_id').references('id').inTable('posts')
    table.string('status', 16).notNullable().defaultTo('open') // open | accepted | dismissed
    table.bigInteger('task_id').references('id').inTable('agora_tasks').onDelete('SET NULL')
    table.bigInteger('decided_by_id').references('id').inTable('users')
    table.timestamp('decided_at', { useTz: true })
    table.timestamp('created_at', { useTz: true })
    table.timestamp('updated_at', { useTz: true })
    table.index(['minutes_post_id'])
    table.index(['group_id', 'status'])
  })

  await knex.schema.createTable('agora_task_suggestion_people', table => {
    table.bigInteger('suggestion_id').notNullable().references('id').inTable('agora_task_suggestions').onDelete('CASCADE')
    table.bigInteger('user_id').notNullable().references('id').inTable('users')
    table.string('status', 16).notNullable().defaultTo('suggested') // suggested | accepted | declined
    table.unique(['suggestion_id', 'user_id'])
    table.index('user_id')
  })

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${table} alter constraint ${constraint} deferrable initially deferred`)
  }
}

const FOREIGN_KEYS = [
  ['agora_task_suggestions', 'agora_task_suggestions_group_id_foreign'],
  ['agora_task_suggestions', 'agora_task_suggestions_meeting_session_id_foreign'],
  ['agora_task_suggestions', 'agora_task_suggestions_minutes_post_id_foreign'],
  ['agora_task_suggestions', 'agora_task_suggestions_project_post_id_foreign'],
  ['agora_task_suggestions', 'agora_task_suggestions_task_id_foreign'],
  ['agora_task_suggestions', 'agora_task_suggestions_decided_by_id_foreign'],
  ['agora_task_suggestion_people', 'agora_task_suggestion_people_suggestion_id_foreign'],
  ['agora_task_suggestion_people', 'agora_task_suggestion_people_user_id_foreign']
]

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_task_suggestion_people')
  await knex.schema.dropTableIfExists('agora_task_suggestions')
}
