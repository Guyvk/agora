/**
 * Agora: fills an empty database with Agora's tables, once.
 *
 * Hylo's oldest migrations no longer run on a fresh database, so a new Agora
 * starts from migrations/schema.sql instead, and every migration that file
 * already contains is marked as done. On the Mac, setup-mac.sh does this with
 * psql. Online there is no psql, so Heroku runs this script before every
 * release (see agora/heroku/Procfile.api). It does nothing when the database
 * already has Agora's tables, so it is safe to run again.
 *
 *   NODE_ENV=production node scripts/agora-init-db.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), override: false })
const fs = require('fs')
const path = require('path')

const environment = process.env.NODE_ENV || 'development'
const config = require('../knexfile')[environment]
const knex = require('knex')(config)

const SCHEMA = path.join(__dirname, '..', 'migrations', 'schema.sql')
const MIGRATIONS = path.join(__dirname, '..', 'migrations')

/**
 * schema.sql is written for psql. Lines that start with a backslash are psql's
 * own commands, and comments on extensions need a database superuser, which
 * Heroku does not give. Both are left out; neither changes a table.
 */
function schemaForPlainSql (text) {
  return text
    .split('\n')
    .filter(line => !line.startsWith('\\'))
    .join('\n')
    .replace(/^COMMENT ON EXTENSION [^;]+;$/gm, '')
}

async function main () {
  const { rows } = await knex.raw("SELECT to_regclass('public.users') AS users")
  if (rows[0].users) {
    console.log('Agora database: the tables are there already, nothing to do.')
    return
  }
  console.log('Agora database: empty, loading migrations/schema.sql ...')
  await knex.raw(schemaForPlainSql(fs.readFileSync(SCHEMA, 'utf8')))

  // schema.sql already holds what every migration in the folder does.
  const names = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.js')).sort()
  await knex('public.knex_migrations').del()
  for (const name of names) {
    await knex('public.knex_migrations').insert({ name, batch: 1, migration_time: knex.fn.now() })
  }
  console.log(`Agora database: ready, ${names.length} migrations marked as done.`)
}

main()
  .then(() => knex.destroy())
  .catch(err => {
    console.error(`Agora database: could not set up the tables: ${err.message}`)
    knex.destroy().finally(() => process.exit(1))
  })
