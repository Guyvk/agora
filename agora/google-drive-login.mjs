#!/usr/bin/env node
/**
 * Agora: lets Agora into one Google account's Google Drive, once.
 *
 * Needed only for the fallback way in README-AGORA.md, "Google Drive". The
 * usual way, a robot account in 7BP's shared drive, does not need it.
 *
 * Log in with a Google account made only for Agora, that has the Contributor
 * or Editor role on the 7BP folder and nothing else. Never your own personal
 * account or a Workspace admin account: Agora is then allowed into the whole
 * Drive of that account.
 *
 * Before running it, put AGORA_GOOGLE_OAUTH_CLIENT_ID and
 * AGORA_GOOGLE_OAUTH_CLIENT_SECRET in apps/backend/.env. Then:
 *
 *   node agora/google-drive-login.mjs
 *
 * Your browser opens Google's login page. Log in as that account and allow
 * Agora. The script then writes AGORA_GOOGLE_OAUTH_REFRESH_TOKEN into
 * apps/backend/.env, which only you can read (chmod 600). It never shows the
 * token on screen. It prints the account's email address, so you can check
 * it is the right one.
 */
import fs from 'fs'
import path from 'path'
import http from 'http'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, 'apps', 'backend', '.env')
const SCOPE = 'https://www.googleapis.com/auth/drive'

function readEnv () {
  if (!fs.existsSync(envPath)) return {}
  const values = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) values[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1')
  }
  return values
}

/** Replaces the NAME=... line, or adds it at the end. The file stays readable by you only. */
function writeEnvValue (name, value) {
  const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const line = new RegExp(`^${name}=.*$`, 'm')
  const next = line.test(text) ? text.replace(line, () => `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`
  fs.writeFileSync(envPath, next, { mode: 0o600 })
  // The mode above only counts for a new file; an existing one is set here.
  fs.chmodSync(envPath, 0o600)
}

function stop (message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

const env = readEnv()
const clientId = env.AGORA_GOOGLE_OAUTH_CLIENT_ID
const clientSecret = env.AGORA_GOOGLE_OAUTH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  stop('First put AGORA_GOOGLE_OAUTH_CLIENT_ID and AGORA_GOOGLE_OAUTH_CLIENT_SECRET in apps/backend/.env.\nSee "Google Drive" in README-AGORA.md.')
}

const state = crypto.randomBytes(16).toString('hex')
const verifier = crypto.randomBytes(32).toString('base64url')
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
let redirectUri

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname !== '/') {
    res.writeHead(404).end()
    return
  }
  /** Answers the browser, and once the answer is out, ends the script with the message. */
  const finish = (pageText, message, failed) => {
    res.on('finish', () => {
      server.close()
      if (failed) stop(message)
      console.log(message)
      process.exit(0)
    })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><meta charset="utf-8"><title>Agora</title><body style="font:16px system-ui;padding:40px"><p>${pageText}</p></body>`)
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('This page was not opened by the Agora login script. Close it and try again.')
    return
  }
  if (url.searchParams.get('error')) {
    return finish('Google said no. Close this tab and look in the Terminal.', `Google said no (${url.searchParams.get('error')}). Run the script again and choose Allow.`, true)
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: url.searchParams.get('code') || '',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: verifier
      }).toString()
    })
    const body = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !body.refresh_token) {
      return finish('Something went wrong. Close this tab and look in the Terminal.',
        `Google did not hand over a login for Agora (${tokenRes.status} ${body.error || 'no refresh token'}). Run the script again.`, true)
    }
    writeEnvValue('AGORA_GOOGLE_OAUTH_REFRESH_TOKEN', body.refresh_token)

    // Which account was this? Only its email address is shown.
    const about = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { authorization: `Bearer ${body.access_token}` }
    }).then(r => r.json()).catch(() => ({}))
    const email = (about.user && about.user.emailAddress) || 'an unknown account'

    return finish('Done. Agora can now use this Google Drive. You can close this tab.', [
      `\nDone. Agora uses the Google Drive of ${email}.`,
      'AGORA_GOOGLE_OAUTH_REFRESH_TOKEN is now in apps/backend/.env. Restart Agora.',
      'If that is not the account made for Agora, run this script again and log in as that account.\n'
    ].join('\n'))
  } catch (err) {
    return finish('Something went wrong. Close this tab and look in the Terminal.', `Could not reach Google: ${err.message}`, true)
  }
})

server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${server.address().port}`
  const auth = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  console.log('\nYour browser opens Google\'s login page now.')
  console.log('Log in as the Google account made for Agora, never your own or an admin account, and choose Allow.')
  console.log('If Google says it has not verified the app: choose Advanced, then "Go to Agora".')
  console.log('\nIf no browser opens, copy this address into one:\n')
  console.log(auth + '\n')
  if (process.platform === 'darwin') execFile('open', [auth], () => {})
})
