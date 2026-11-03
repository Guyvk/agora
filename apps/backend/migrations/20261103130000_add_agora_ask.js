/**
 * Agora: the Ask tab of a circle. See lib/agora/ask.js.
 *
 * agora_knowledge_chunks  what Ask can search: short pieces of the posts,
 *                         comments, chat, proposals, events, playbook,
 *                         files, meetings and anonymised private themes of
 *                         each circle, with a keyword index (tsv) and, once
 *                         Infomaniak's AI is set up, an embedding (a list of
 *                         numbers that stands for the meaning of the text).
 * agora_ask_questions     every question someone asked and the answer, for
 *                         their own history. Only they can read it.
 * agora_ask_usage         every call to Infomaniak's AI with its tokens and
 *                         estimated cost, for the monthly spend cap and the
 *                         admin area.
 * agora_ask_state         small bookkeeping values, such as when the index
 *                         last caught up.
 * agora_private_themes    anonymised themes from private conversations (see
 *                         lib/agora/privateThemes.js), without any link to
 *                         the messages they came from.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_knowledge_chunks', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE')
    table.string('source_type', 20).notNullable() // post | comment | chat | proposal | event | playbook | file | meeting | private_theme
    table.string('source_key', 80).notNullable() // e.g. "post:12", "comment:7", "playbook:3": all pieces of one source share it
    table.bigInteger('source_id')
    table.bigInteger('post_id') // the post a piece belongs to, so a post and its comments are indexed again together
    table.text('title')
    table.string('url', 1000)
    table.bigInteger('author_id')
    table.timestamp('created_at') // when the source was written
    table.timestamp('indexed_at')
    table.integer('chunk_index').notNullable().defaultTo(0)
    table.text('text').notNullable()
    table.string('text_hash', 64)
    table.specificType('embedding', 'real[]')
    table.string('embed_model', 100)
    table.specificType('tsv', "tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(text, ''))) STORED")
    table.index(['group_id', 'created_at'])
    table.index('source_key')
    table.index('post_id')
  })
  await knex.raw('CREATE INDEX agora_knowledge_chunks_tsv_index ON agora_knowledge_chunks USING gin (tsv)')

  await knex.schema.createTable('agora_ask_questions', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.bigInteger('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE')
    table.text('question').notNullable()
    table.text('answer')
    table.jsonb('sources') // [{ n, type, title, url, date }]
    table.string('status', 20).notNullable() // answered | not_found | error
    table.string('model', 100)
    table.bigInteger('shared_post_id')
    table.timestamp('created_at')
    table.index(['user_id', 'group_id', 'created_at'])
  })

  await knex.schema.createTable('agora_ask_usage', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('user_id').references('id').inTable('users').onDelete('SET NULL')
    table.bigInteger('group_id').references('id').inTable('groups').onDelete('SET NULL')
    table.string('kind', 20).notNullable() // ask | embed | rerank | themes
    table.string('model', 100)
    table.integer('input_tokens').notNullable().defaultTo(0)
    table.integer('output_tokens').notNullable().defaultTo(0)
    table.decimal('cost_eur', 12, 6).notNullable().defaultTo(0)
    table.timestamp('created_at')
    table.index('created_at')
    table.index(['user_id', 'kind', 'created_at'])
  })

  await knex.schema.createTable('agora_ask_state', table => {
    table.string('key', 100).primary()
    table.text('value')
    table.timestamp('updated_at')
  })

  await knex.schema.createTable('agora_private_themes', table => {
    table.bigIncrements('id').primary()
    table.text('theme').notNullable()
    table.specificType('group_ids', 'bigint[]') // the circles whose work it is about; empty for none
    table.integer('source_count').notNullable().defaultTo(0) // how many different people it came from
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const [tableName, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${tableName} alter constraint ${constraint} deferrable initially deferred`)
  }

  // pgvector, when the server has it (README-AGORA.md, "Ask"). Only a database
  // administrator may add it; without it Ask searches by keywords only.
  await knex.raw(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
      BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'Agora Ask: pgvector is installed but only a database administrator can switch it on';
      END;
    END IF;
  END $$`)
}

const FOREIGN_KEYS = [
  ['agora_knowledge_chunks', 'agora_knowledge_chunks_group_id_foreign'],
  ['agora_ask_questions', 'agora_ask_questions_user_id_foreign'],
  ['agora_ask_questions', 'agora_ask_questions_group_id_foreign'],
  ['agora_ask_usage', 'agora_ask_usage_user_id_foreign'],
  ['agora_ask_usage', 'agora_ask_usage_group_id_foreign']
]

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_private_themes')
  await knex.schema.dropTableIfExists('agora_ask_state')
  await knex.schema.dropTableIfExists('agora_ask_usage')
  await knex.schema.dropTableIfExists('agora_ask_questions')
  await knex.schema.dropTableIfExists('agora_knowledge_chunks')
}
