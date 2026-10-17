#!/usr/bin/env node
/**
 * Agora: puts Agora on Heroku, in Heroku's EU region. Run it through
 * agora/heroku-setup.sh, which finds the right Node.
 *
 *   ./agora/heroku-setup.sh             shows every step and what it costs, changes nothing
 *   ./agora/heroku-setup.sh create      makes the two apps, the database and the rest
 *   ./agora/heroku-setup.sh deploy      sends the code of the branch "agora" to both apps
 *   ./agora/heroku-setup.sh domain      switches to agora.7billionpresidents.org
 *   ./agora/heroku-setup.sh secret NAME [NAME ...]
 *                                       copies settings from apps/backend/.env to Heroku
 *                                       without showing them, for example BREVO_API_KEY
 *
 * Agora runs as two Heroku apps, like Hylo does:
 *   the server app (AGORA_HEROKU_API, default agora-7bp-api): the server, its
 *     background worker, the database and Redis
 *   the web app (AGORA_HEROKU_WEB, default agora-7bp): the pages people open;
 *     it passes /noo calls on to the server app
 *
 * Secrets the server needs (cookie and login keys) are made fresh here and go
 * straight into Heroku. They are never shown, and never the ones from the Mac.
 * Keys from other services (email, speech to text, Claude, Google Drive) are
 * yours to add with "secret".
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.AGORA_HEROKU_API || 'agora-7bp-api'
const WEB = process.env.AGORA_HEROKU_WEB || 'agora-7bp'
const SITE = process.env.AGORA_DOMAIN || 'agora.7billionpresidents.org'
const API_SITE = `api.${SITE}`
const COOKIE = 'agora.sid'

// The cheapest plans that work. See "Going online" in README-AGORA.md.
const PLANS = {
  postgres: process.env.AGORA_HEROKU_POSTGRES || 'heroku-postgresql:essential-0',
  redis: process.env.AGORA_HEROKU_REDIS || 'rediscloud:30',
  dyno: process.env.AGORA_HEROKU_DYNO || 'basic'
}

const mode = process.argv[2] || 'plan'
const doIt = mode !== 'plan'

/* ---------- Talking to Heroku ---------- */

function heroku (args, { quiet = false, secretText = null } = {}) {
  const shown = secretText || `heroku ${args.join(' ')}`
  console.log(doIt ? `  > ${shown}` : `  ${shown}`)
  if (!doIt) return ''
  return execFileSync('heroku', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'] })
}

function ask (args) {
  try {
    return execFileSync('heroku', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    return null
  }
}

function appExists (app) {
  return ask(['apps:info', '-a', app, '--json']) !== null
}

function hostOf (app) {
  const info = ask(['apps:info', '-a', app, '--json'])
  if (!info) return `${app}-<made by Heroku>.herokuapp.com`
  return new URL(JSON.parse(info).app.web_url).host
}

function configOf (app) {
  const text = ask(['config', '-a', app, '--json'])
  return text ? JSON.parse(text) : {}
}

/** Sets settings without printing their values. */
function setSecret (app, values) {
  const names = Object.keys(values)
  if (!names.length) return
  heroku(['config:set', '-a', app, ...names.map(n => `${n}=${values[n]}`)], {
    quiet: true,
    secretText: `heroku config:set -a ${app} ${names.map(n => `${n}=<not shown>`).join(' ')}`
  })
}

function setPlain (app, values) {
  heroku(['config:set', '-a', app, ...Object.entries(values).map(([n, v]) => `${n}=${v}`)], { quiet: true })
}

/* ---------- The settings ---------- */

// Taken from apps/backend/.env.example, like on the Mac, minus what is secret,
// belongs to services Agora does not use, or only makes sense on a Mac.
const LEAVE_OUT = new Set([
  'APP_BASE', 'DATABASE_URL', 'REDIS_URL', 'NODE_TLS_REJECT_UNAUTHORIZED', 'DEBUG_GRAPHQL', 'DEBUG_SQL',
  'PRETTY_JSON', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_CONTENT_URL', 'AWS_S3_BUCKET',
  'SENTRY_DSN', 'SENTRY_ENV', 'MURMURATIONS_INDEX_API_URL', 'MIXPANEL_TOKEN', 'INTERCOM_KEY', 'SEGMENT_KEY', 'SENDWITHUS_KEY'
])

function exampleSettings () {
  const values = {}
  for (const line of fs.readFileSync(path.join(root, 'apps/backend/.env.example'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match || LEAVE_OUT.has(match[1])) continue
    const [, name, value] = match
    // Empty, and "xxx" stand-ins that Hylo's start-up code wants filled in, are kept.
    // Anything else that looks secret is left out: it is made fresh or added by you.
    const placeholder = value === '' || /^x+$/i.test(value)
    if (/KEY|SECRET|TOKEN|SALT|PASSWORD/.test(name) && !placeholder) continue
    if (value === '') continue
    values[name] = value
  }
  return values
}

function serverSettings (site, apiSite, onOwnDomain) {
  return {
    ...exampleSettings(),
    NODE_ENV: 'production',
    PROTOCOL: 'https',
    DOMAIN: site,
    COOKIE_NAME: COOKIE,
    ...(onOwnDomain ? { COOKIE_DOMAIN: `.${SITE}` } : {}),
    CORS_ALLOWED_ORIGINS: `https://${site}`,
    // A small Heroku database allows 20 connections for all programs together.
    DB_POOL_MIN: '0',
    DB_POOL_MAX: '5',
    STRIPE_SECRET_KEY: 'sk_test_agora_payments_not_used',
    EMAIL_SENDER: `agora@${SITE}`,
    EMAIL_NOTIFICATIONS_ENABLED: 'false',
    PUSH_NOTIFICATIONS_ENABLED: 'false',
    PUSH_NOTIFICATIONS_TESTING_ENABLED: 'false',
    DISABLE_SEGMENT: '1',
    GRAPHQL_YOGA_LOG_LEVEL: 'warn',
    // Heroku builds the server part of the code only, and installs nothing for phones or desktops.
    PROCFILE: 'agora/heroku/Procfile.api',
    YARN2_WORKSPACE_PATH: 'apps/backend',
    YARN2_SKIP_PRUNING: 'true',
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    PUPPETEER_SKIP_DOWNLOAD: '1'
  }
}

function webSettings (apiSite) {
  return {
    NODE_ENV: 'production',
    PROCFILE: 'agora/heroku/Procfile.web',
    YARN2_WORKSPACE_PATH: 'apps/web',
    YARN2_SKIP_PRUNING: 'true',
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    PUPPETEER_SKIP_DOWNLOAD: '1',
    VITE_API_HOST: `https://${apiSite}`,
    VITE_SOCKET_HOST: `https://${apiSite}`,
    HYLO_COOKIE_NAME: COOKIE
  }
}

/** Fresh secrets for the server, made only when Heroku does not have them yet. */
function freshSecrets (existing) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    // The login system needs the older "RSA PRIVATE KEY" (PKCS#1) format.
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  const all = {
    COOKIE_SECRET: crypto.randomBytes(32).toString('hex'),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    OIDC_KEYS: Buffer.from(privateKey).toString('base64'),
    INBOUND_EMAIL_SALT: crypto.randomBytes(16).toString('hex'),
    PLAY_APP_SECRET: crypto.randomBytes(16).toString('hex')
  }
  return Object.fromEntries(Object.entries(all).filter(([name]) => !existing[name]))
}

/* ---------- The steps ---------- */

function checkLogin () {
  if (ask(['auth:whoami']) === null) {
    console.error('\nThe Heroku command line tool is not logged in. In the Terminal, run: heroku login\n')
    if (doIt) process.exit(1)
  }
}

function create () {
  console.log('\n1. Two apps in the EU region')
  for (const app of [API, WEB]) {
    if (doIt && appExists(app)) console.log(`  (${app} exists already)`)
    else heroku(['apps:create', app, '--region', 'eu', '--stack', 'heroku-24'])
  }

  console.log('\n2. How Heroku builds them: one Procfile per app, then Node')
  for (const app of [API, WEB]) {
    if (doIt && (ask(['buildpacks', '-a', app]) || '').includes('multi-procfile')) {
      console.log(`  (${app} has its buildpacks already)`)
      continue
    }
    heroku(['buildpacks:add', '-a', app, 'heroku-community/multi-procfile'])
    heroku(['buildpacks:add', '-a', app, 'heroku/nodejs'])
  }

  console.log('\n3. Database, Redis and the timer, for the server app')
  const addons = doIt ? (ask(['addons', '-a', API]) || '') : ''
  if (!addons.includes('heroku-postgresql')) heroku(['addons:create', PLANS.postgres, '-a', API, '--', '--version', '17'])
  if (!addons.includes('rediscloud')) heroku(['addons:create', PLANS.redis, '-a', API, '--as', 'REDIS'])
  if (!addons.includes('scheduler')) heroku(['addons:create', 'scheduler:standard', '-a', API])

  console.log('\n4. Settings')
  const apiHost = doIt ? hostOf(API) : `${API}-<made by Heroku>.herokuapp.com`
  const webHost = doIt ? hostOf(WEB) : `${WEB}-<made by Heroku>.herokuapp.com`
  setPlain(API, serverSettings(webHost, apiHost, false))
  setSecret(API, freshSecrets(doIt ? configOf(API) : {}))
  setPlain(WEB, webSettings(apiHost))

  console.log('\nDone. Next: ./agora/heroku-setup.sh deploy\n')
  console.log(`Until the address ${SITE} is switched on (./agora/heroku-setup.sh domain),`)
  console.log(`Agora is at https://${webHost}. Live updates, such as new chat messages`)
  console.log('appearing by themselves, only work on the own address.\n')
}

function deploy () {
  console.log('\nSending the branch "agora" to both apps. Each build takes 10 to 20 minutes.')
  for (const app of [API, WEB]) {
    console.log(doIt ? `  > git push https://git.heroku.com/${app}.git agora:main` : `  git push https://git.heroku.com/${app}.git agora:main`)
    if (doIt) execFileSync('git', ['push', `https://git.heroku.com/${app}.git`, 'agora:main'], { cwd: root, stdio: 'inherit' })
  }
  heroku(['ps:scale', '-a', API, `web=1:${PLANS.dyno}`, `worker=1:${PLANS.dyno}`])
  heroku(['ps:scale', '-a', WEB, `web=1:${PLANS.dyno}`])
  console.log('\nThen, once, in the Heroku dashboard: open the server app, Resources, Heroku Scheduler, and add three jobs:')
  console.log('  every 10 minutes:  cd apps/backend && node cron.js --interval every10minutes')
  console.log('  every hour:        cd apps/backend && node cron.js --interval hourly')
  console.log('  every day:         cd apps/backend && node cron.js --interval daily\n')
}

function domain () {
  console.log(`\nSwitching to https://${SITE} (and https://${API_SITE} for the server)`)
  heroku(['domains:add', SITE, '-a', WEB])
  heroku(['domains:add', API_SITE, '-a', API])
  setPlain(API, { DOMAIN: SITE, COOKIE_DOMAIN: `.${SITE}`, CORS_ALLOWED_ORIGINS: `https://${SITE}` })
  setPlain(WEB, { VITE_API_HOST: `https://${API_SITE}`, VITE_SOCKET_HOST: `https://${API_SITE}` })
  console.log('\nWhoever holds the login of 7billionpresidents.org now adds two CNAME records,')
  console.log('pointing to the "DNS target" Heroku shows for each address:')
  heroku(['domains', '-a', WEB])
  heroku(['domains', '-a', API])
  console.log('\nHeroku makes the https certificates by itself once the records work (heroku certs:auto).')
  console.log('The web app keeps the server address inside its pages, so deploy once more afterwards.\n')
}

function secret (names) {
  if (!names.length) {
    console.error('Name the settings to copy, for example: ./agora/heroku-setup.sh secret BREVO_API_KEY')
    process.exit(1)
  }
  const envPath = path.join(root, 'apps/backend/.env')
  const values = {}
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  for (const name of names) {
    const match = text.match(new RegExp(`^${name}=(.*)$`, 'm'))
    if (!match || !match[1].trim()) {
      console.error(`${name} is not in apps/backend/.env, or it is empty. Nothing was copied.`)
      process.exit(1)
    }
    values[name] = match[1].trim()
  }
  setSecret(API, values)
}

/* ---------- Start ---------- */

console.log(doIt ? '' : '\nThis only shows the steps. Nothing is created and nothing is paid.')
checkLogin()
if (mode === 'plan') {
  console.log('\nWhat it costs, per month, in US dollars (Heroku prices, October 2026):')
  console.log('  server app: web and worker, 2 Basic dynos      14')
  console.log('  web app: 1 Basic dyno                           7')
  console.log(`  database ${PLANS.postgres}           5`)
  console.log(`  Redis ${PLANS.redis}                         0 (free plan)`)
  console.log('  Heroku Scheduler, a few minutes a day         under 1')
  console.log('  total                                       about 27')
  create()
  deploy()
  domain()
} else if (mode === 'create') {
  create()
} else if (mode === 'deploy') {
  deploy()
} else if (mode === 'domain') {
  domain()
} else if (mode === 'secret') {
  secret(process.argv.slice(3))
} else {
  console.error(`Unknown step "${mode}". Use: create, deploy, domain or secret.`)
  process.exit(1)
}
