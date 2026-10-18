#!/usr/bin/env node
/**
 * Agora: writes the two settings files for running Agora on your own computer.
 *
 *   apps/backend/.env   the server's settings, including freshly made secrets
 *   apps/web/.env       the web app's settings
 *
 * It never overwrites a file that already exists, so your own changes are safe.
 * Usage: node agora/make-env.mjs [database name]
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const database = process.argv[2] || 'agora'

// A database installed with Homebrew is owned by your own Mac user, without a password.
const databaseUser = encodeURIComponent(process.env.AGORA_DB_USER || os.userInfo().username)

/** Replaces the value of NAME=... lines. Names that are not in the file are added at the end. */
function withValues (text, values) {
  const missing = []
  for (const [name, value] of Object.entries(values)) {
    const line = new RegExp(`^${name}=.*$`, 'm')
    if (line.test(text)) text = text.replace(line, () => `${name}=${value}`)
    else missing.push(`${name}=${value}`)
  }
  return missing.length ? `${text.trimEnd()}\n${missing.join('\n')}\n` : text
}

function write (relativePath, values) {
  const target = path.join(root, relativePath)
  if (fs.existsSync(target)) {
    console.log(`  kept    ${relativePath} (it already exists)`)
    return
  }
  const example = fs.readFileSync(`${target}.example`, 'utf8')
  fs.writeFileSync(target, withValues(example, values), { mode: 0o600 })
  console.log(`  written ${relativePath}`)
}

// The login system needs a private key in the older "RSA PRIVATE KEY" format.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})

write('apps/backend/.env', {
  DATABASE_URL: `postgres://${databaseUser}@localhost:5432/${database}`,
  COOKIE_SECRET: crypto.randomBytes(32).toString('hex'),
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  OIDC_KEYS: Buffer.from(privateKey).toString('base64'),
  STRIPE_SECRET_KEY: 'sk_test_agora_payments_not_used',
  // No Amazon S3: uploads go to apps/backend/.agora-uploads
  AWS_S3_BUCKET: '',
  AWS_S3_CONTENT_URL: '',
  EMAIL_SENDER: 'agora@localhost',
  EMAIL_NOTIFICATIONS_ENABLED: 'false',
  DEBUG_SQL: '',
  DEBUG_GRAPHQL: '',
  GRAPHQL_YOGA_LOG_LEVEL: 'warn',
  DISABLE_SEGMENT: '1'
})

write('apps/web/.env', {
  PROXY_HOST: '',
  VITE_FILESTACK_API_KEY: '',
  VITE_MAPBOX_TOKEN: '',
  VITE_MIXPANEL_TOKEN: '',
  VITE_STRIPE_CLIENT_ID: '',
  VITE_INTERCOM_APP_ID: '',
  VITE_FEATURED_GROUP_IDS: ''
})
