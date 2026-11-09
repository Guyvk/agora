/**
 * Agora tasks: to-dos that live in a circle and can belong to a project (a
 * project post in that circle).
 *
 * agora_tasks           one row per task
 * agora_task_assignees  who works on it (one or more people)
 * agora_task_comments   what people said about it
 *
 * source_meeting_session_id and source_minutes_post_id are for a later
 * feature that makes tasks from meeting minutes. Nothing fills them yet.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_tasks', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('group_id').notNullable().references('id').inTable('groups')
    table.bigInteger('project_post_id').references('id').inTable('posts')
    table.string('title', 500).notNullable()
    table.text('description')
    table.string('status', 16).notNullable().defaultTo('todo') // todo | doing | done
    table.double('position').notNullable().defaultTo(0)
    table.date('due_date')
    table.bigInteger('created_by_id').references('id').inTable('users')
    table.timestamp('completed_at', { useTz: true })
    table.timestamp('removed_at', { useTz: true })
    table.bigInteger('removed_by_id').references('id').inTable('users')
    table.bigInteger('source_meeting_session_id').references('id').inTable('meeting_sessions').onDelete('SET NULL')
    table.bigInteger('source_minutes_post_id').references('id').inTable('posts')
    table.timestamp('created_at', { useTz: true })
    table.timestamp('updated_at', { useTz: true })
    table.index(['group_id', 'status'])
    table.index(['project_post_id'])
  })

  await knex.schema.createTable('agora_task_assignees', table => {
    table.bigInteger('task_id').notNullable().references('id').inTable('agora_tasks').onDelete('CASCADE')
    table.bigInteger('user_id').notNullable().references('id').inTable('users')
    table.timestamp('created_at', { useTz: true })
    table.unique(['task_id', 'user_id'])
    table.index('user_id')
  })

  await knex.schema.createTable('agora_task_comments', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('task_id').notNullable().references('id').inTable('agora_tasks').onDelete('CASCADE').index()
    table.bigInteger('user_id').references('id').inTable('users')
    table.text('text').notNullable()
    table.timestamp('created_at', { useTz: true })
    table.timestamp('removed_at', { useTz: true })
  })

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const [table, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${table} alter constraint ${constraint} deferrable initially deferred`)
  }
}

const FOREIGN_KEYS = [
  ['agora_tasks', 'agora_tasks_group_id_foreign'],
  ['agora_tasks', 'agora_tasks_project_post_id_foreign'],
  ['agora_tasks', 'agora_tasks_created_by_id_foreign'],
  ['agora_tasks', 'agora_tasks_removed_by_id_foreign'],
  ['agora_tasks', 'agora_tasks_source_meeting_session_id_foreign'],
  ['agora_tasks', 'agora_tasks_source_minutes_post_id_foreign'],
  ['agora_task_assignees', 'agora_task_assignees_task_id_foreign'],
  ['agora_task_assignees', 'agora_task_assignees_user_id_foreign'],
  ['agora_task_comments', 'agora_task_comments_task_id_foreign'],
  ['agora_task_comments', 'agora_task_comments_user_id_foreign']
]

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_task_comments')
  await knex.schema.dropTableIfExists('agora_task_assignees')
  await knex.schema.dropTableIfExists('agora_tasks')
}
