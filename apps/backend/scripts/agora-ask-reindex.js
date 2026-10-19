/**
 * Agora: builds the knowledge index of the Ask tab again. Run from apps/backend:
 *
 *   node scripts/agora-ask-reindex.js              every circle
 *   node scripts/agora-ask-reindex.js <circle>     one circle, by its address name (slug) or id
 *   node scripts/agora-ask-reindex.js --themes     also makes the anonymised private themes again
 *   node scripts/agora-ask-reindex.js --no-embed   keywords only, no calls to Infomaniak
 *
 * Run it once after installing a version with Ask, and after switching on
 * pgvector or changing AGORA_ASK_EMBED_MODEL. It is safe to run again: pieces
 * whose text did not change keep their embedding, so a second run costs
 * almost nothing. It works with AGORA_ASK_ENABLED off too, so the index can
 * be ready before the tab is switched on. See lib/agora/askIndex.js.
 */
require('@babel/register')
const skiff = require('../lib/skiff')

async function run () {
  const AskIndex = require('../lib/agora/askIndex').default
  const PrivateThemes = require('../lib/agora/privateThemes').default
  const AI = require('../lib/agora/infomaniakAI').default
  const args = process.argv.slice(2)
  const embed = !args.includes('--no-embed')
  const themes = args.includes('--themes')
  const circle = args.find(a => !a.startsWith('--'))

  let groupId = null
  if (circle) {
    const group = await bookshelf.knex('groups').where(/^\d+$/.test(circle) ? { id: circle } : { slug: circle }).first('id', 'name')
    if (!group) throw new Error(`There is no circle "${circle}".`)
    groupId = group.id
    console.log(`Indexing the circle "${group.name}".`)
  }
  console.log(`Search by meaning: ${await AskIndex.vectorReady() ? 'on (pgvector)' : 'off, keywords only (pgvector is not in this database)'}.`)
  console.log(`Infomaniak's AI: ${AI.isConfigured() ? (embed ? 'set up, new pieces get embeddings' : 'set up, but --no-embed was given') : 'not set up, keywords only'}.`)

  const startedAt = new Date()
  const counts = await AskIndex.reindexAll({ groupId, embed: embed && AI.isConfigured() })
  console.log(`Indexed ${counts.posts} posts, ${counts.playbooks} playbooks, ${counts.meetings} meetings and ${counts.files} files; ${counts.embedded} pieces got an embedding.`)

  if (themes) {
    const result = await PrivateThemes.refreshThemes()
    console.log(result.skipped
      ? `Private themes skipped (${result.skipped}).`
      : `Private themes: ${result.themes} kept, ${result.dropped} dropped by the checks.`)
  } else {
    await PrivateThemes.indexThemes()
  }
  if (!groupId) await AskIndex.setState('index_watermark', startedAt.toISOString())
  const total = await bookshelf.knex('agora_knowledge_chunks').count('id as n').first()
  console.log(`The index now holds ${total.n} pieces.`)
}

skiff.lift({
  start: function () {
    run()
      .catch(err => {
        console.error(`\nCould not build the Ask index: ${err.message}\n`)
        process.exitCode = 1
      })
      .finally(() => skiff.lower())
  }
})
