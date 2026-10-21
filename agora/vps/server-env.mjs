#!/usr/bin/env node
/**
 * Agora: writes the two settings files for Agora on its own server.
 *
 *   apps/backend/.env   the server's settings, with freshly made secrets
 *   apps/web/.env       the web app's settings
 *
 * Like agora/make-env.mjs, but for a server on the internet: https, Agora's own
 * address, its own cookie, and no shortcuts that only make sense on a laptop.
 * It never overwrites a file that already exists, so settings added later by
 * hand (the mail password, the Google key) are safe.
 *
 * Usage (run by agora/vps/setup-server.sh):
 *   node agora/vps/server-env.mjs <address> <database password>
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [site, databasePassword] = process.argv.slice(2)
if (!site || !databasePassword) {
  console.error('Usage: node agora/vps/server-env.mjs <address, e.g. agora.7billionpresidents.org> <database password>')
  process.exit(1)
}
const COOKIE = 'agora.sid'
const secret = bytes => crypto.randomBytes(bytes).toString('hex')

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
  fs.chmodSync(target, 0o600)
  console.log(`  written ${relativePath}`)
}

// The login system needs a private key in the older "RSA PRIVATE KEY" format.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})

write('apps/backend/.env', {
  NODE_ENV: 'production',
  PROTOCOL: 'https',
  DOMAIN: site,
  COOKIE_NAME: COOKIE,
  CORS_ALLOWED_ORIGINS: `https://${site}`,
  DATABASE_URL: `postgres://agora:${encodeURIComponent(databasePassword)}@127.0.0.1:5432/agora`,
  REDIS_URL: 'redis://127.0.0.1:6379',
  COOKIE_SECRET: secret(32),
  JWT_SECRET: secret(32),
  OIDC_KEYS: Buffer.from(privateKey).toString('base64'),
  INBOUND_EMAIL_SALT: secret(16),
  PLAY_APP_SECRET: secret(16),
  // Agora reads no incoming mail. Reply addresses on this made-up name are
  // left out of every email by Agora's mailer, and none point at Hylo's.
  INBOUND_EMAIL_DOMAIN: `inbound.${site}`,
  // Hylo's example turns off checking the certificates of other sites. Not here.
  NODE_TLS_REJECT_UNAUTHORIZED: '1',
  STRIPE_SECRET_KEY: 'sk_test_agora_payments_not_used',
  // No Amazon S3: pictures and files are kept on this server's own disk and
  // served at https://<address>/noo/uploads/... (apps/backend/lib/agora/diskUploads.js)
  AWS_S3_BUCKET: '',
  AWS_S3_CONTENT_URL: '',
  UPLOADER_PATH_PREFIX: 'evo-uploads',
  AGORA_UPLOADS_DIR: '/var/lib/agora/uploads',
  // Emails are only written to the log until a mailbox is connected
  // (AGORA_EMAIL_TRANSPORT=smtp and the AGORA_SMTP_ settings).
  AGORA_EMAIL_TRANSPORT: 'log',
  EMAIL_SENDER: process.env.AGORA_EMAIL_SENDER || 'agora@7billionpresidents.org',
  EMAIL_NOTIFICATIONS_ENABLED: 'true',
  PUSH_NOTIFICATIONS_ENABLED: 'false',
  DEBUG_SQL: '',
  DEBUG_GRAPHQL: '',
  PRETTY_JSON: 'false',
  GRAPHQL_YOGA_LOG_LEVEL: 'warn',
  SAILS_LOG_LEVEL: 'warn',
  DISABLE_SEGMENT: '1',
  // New accounts need an invitation to a circle. The first person gets in with
  // scripts/agora-allow-signup.js (see README-AGORA.md).
  AGORA_INVITE_ONLY: 'on',
  // Circle files in Infomaniak kDrive. Guy types the token, the drive number
  // and the top folder in himself; all three are needed (see "Files in kDrive"
  // in README-AGORA.md).
  AGORA_KDRIVE_TOKEN: '',
  AGORA_KDRIVE_DRIVE_ID: '',
  AGORA_KDRIVE_ROOT_FOLDER_ID: '',
  AGORA_KDRIVE_MAX_UPLOAD_MB: ''
})

write('apps/web/.env', {
  NODE_ENV: 'production',
  PROXY_HOST: '',
  HYLO_COOKIE_NAME: COOKIE,
  // Everything is on one address: the web server in front sends /noo and
  // /socket.io to Agora's server, the rest to the web app.
  VITE_API_HOST: `https://${site}`,
  VITE_SOCKET_HOST: `https://${site}`,
  VITE_FILESTACK_API_KEY: '',
  VITE_MAPBOX_TOKEN: '',
  VITE_MIXPANEL_TOKEN: '',
  VITE_STRIPE_CLIENT_ID: '',
  VITE_INTERCOM_APP_ID: '',
  VITE_FEATURED_GROUP_IDS: ''
})
