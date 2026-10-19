/**
 * Agora: checks that the circle library can use the object storage (S3) with
 * the settings in apps/backend/.env. Run from apps/backend:
 *
 *   node scripts/agora-library-check.js
 *
 * It makes the bucket (AGORA_S3_BUCKET, default agora-files) when it is not
 * there yet, private, then writes a small test file, reads it back and deletes
 * it. It prints only OK or failed per step, never a key.
 * See "Library" in README-AGORA.md.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
require('@babel/register')
const Storage = require('../lib/agora/libraryStorage').default

async function run () {
  const { accessKeyId, secretAccessKey, bucket, endpoint } = Storage.s3Settings()
  console.log(`Storage setting: AGORA_FILE_STORAGE=${process.env.AGORA_FILE_STORAGE || 'disk'}. Bucket ${bucket} at ${endpoint}.`)
  if (!accessKeyId || !secretAccessKey) {
    console.log('failed: AGORA_S3_ACCESS_KEY or AGORA_S3_SECRET_KEY is empty.')
    process.exitCode = 1
    return
  }
  const results = await Storage.checkS3()
  for (const r of results) console.log(`${r.step}: ${r.ok ? 'OK' : `failed (${r.error})`}`)
  const ok = results.length === 4 && results.every(r => r.ok)
  console.log(ok ? 'OK: the library can use the object storage.' : 'failed: see the step above.')
  if (ok && Storage.backend() !== 's3') console.log('Note: AGORA_FILE_STORAGE is not s3 yet, so new files still go to the disk.')
  if (!ok) process.exitCode = 1
}

run().catch(err => {
  console.log(`failed (${String(err.code || err.message).slice(0, 100)})`)
  process.exitCode = 1
})
