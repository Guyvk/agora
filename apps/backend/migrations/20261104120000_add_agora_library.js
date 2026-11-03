/**
 * Agora: the circle library (the Resources tab of a circle). See lib/agora/library.js.
 *
 * agora_library_items   one row per library item: a Hylo "resource" post in a
 *                       circle, with what kind of item it is (document, image,
 *                       audio, video, meeting notes, link), the link of a link
 *                       item and the meeting of a meeting notes item.
 * agora_library_files   one row per file in the library: where it is stored
 *                       (Agora's own disk or S3 object storage), its name, type
 *                       and size, and while it is being uploaded the state of
 *                       the upload. Only members of the circle can download it.
 * agora_file_texts      the text read from each file, for search and for the
 *                       AI (the "Ask" tab reads this table). Its shape is a
 *                       contract: see lib/agora/fileTexts.js before changing it.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('agora_library_items', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE').index()
    table.bigInteger('post_id').notNullable().references('id').inTable('posts').onDelete('CASCADE').unique()
    table.string('kind', 20).notNullable() // document | image | audio | video | meeting | link | other
    table.string('link_url', 2000)
    table.bigInteger('meeting_session_id').references('id').inTable('meeting_sessions').onDelete('SET NULL').index()
    table.bigInteger('created_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  await knex.schema.createTable('agora_library_files', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE').index()
    table.bigInteger('item_id').references('id').inTable('agora_library_items').onDelete('CASCADE').index()
    table.bigInteger('post_id').references('id').inTable('posts').onDelete('CASCADE').index()
    table.bigInteger('media_id').references('id').inTable('media').onDelete('SET NULL').index()
    table.bigInteger('uploaded_by_id').references('id').inTable('users').onDelete('SET NULL')
    table.string('kind', 20).notNullable() // document | image | audio | video | other
    table.string('file_name', 255).notNullable()
    table.string('mime_type', 255)
    table.bigInteger('size_bytes').notNullable()
    table.string('storage', 10).notNullable() // disk | s3
    table.string('storage_key', 1000).notNullable()
    table.string('status', 20).notNullable().defaultTo('uploading') // uploading | stored | attached
    table.string('upload_mode', 20) // chunks | single | multipart
    table.string('s3_upload_id', 1000)
    table.jsonb('parts') // relayed S3 parts: [{ PartNumber, ETag }]
    table.integer('width')
    table.integer('height')
    table.integer('duration_seconds')
    table.timestamp('created_at')
    table.timestamp('updated_at')
  })

  await knex.schema.createTable('agora_file_texts', table => {
    table.bigIncrements('id').primary()
    table.bigInteger('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE')
    table.bigInteger('post_id').references('id').inTable('posts').onDelete('CASCADE').index()
    table.bigInteger('media_id').references('id').inTable('media').onDelete('SET NULL')
    table.string('kind', 20).notNullable() // document | image | audio | meeting
    table.string('title', 500)
    table.text('text')
    table.string('language', 20)
    table.string('status', 20).notNullable().defaultTo('pending') // pending | done | failed | too_big
    table.text('error')
    table.timestamp('created_at')
    table.timestamp('updated_at')
    table.index(['group_id', 'id'])
  })

  // Like Hylo's own tables: links are checked at the end of a transaction.
  for (const [tableName, constraint] of FOREIGN_KEYS) {
    await knex.raw(`alter table ${tableName} alter constraint ${constraint} deferrable initially deferred`)
  }
}

const FOREIGN_KEYS = [
  ['agora_library_items', 'agora_library_items_group_id_foreign'],
  ['agora_library_items', 'agora_library_items_post_id_foreign'],
  ['agora_library_items', 'agora_library_items_meeting_session_id_foreign'],
  ['agora_library_items', 'agora_library_items_created_by_id_foreign'],
  ['agora_library_files', 'agora_library_files_group_id_foreign'],
  ['agora_library_files', 'agora_library_files_item_id_foreign'],
  ['agora_library_files', 'agora_library_files_post_id_foreign'],
  ['agora_library_files', 'agora_library_files_media_id_foreign'],
  ['agora_library_files', 'agora_library_files_uploaded_by_id_foreign'],
  ['agora_file_texts', 'agora_file_texts_group_id_foreign'],
  ['agora_file_texts', 'agora_file_texts_post_id_foreign'],
  ['agora_file_texts', 'agora_file_texts_media_id_foreign']
]

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agora_file_texts')
  await knex.schema.dropTableIfExists('agora_library_files')
  await knex.schema.dropTableIfExists('agora_library_items')
}
