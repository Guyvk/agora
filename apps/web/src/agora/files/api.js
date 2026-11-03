/**
 * Agora: talks to the server part of the Files page
 * (apps/backend/api/controllers/AgoraKdriveController.js). Who may see,
 * add, move, rename or delete what is checked there, not here.
 *
 * Every call that changes something carries the header X-Agora: 1, which a
 * form on another website cannot send.
 */

export const base = groupSlug => `/noo/agora/files/${encodeURIComponent(groupSlug)}/kd`

export const downloadUrl = (groupSlug, fileId) => `${base(groupSlug)}/download?file=${encodeURIComponent(fileId)}`

/** The same file, to be shown in the viewer instead of downloaded (only plain types; the server decides). */
export const viewUrl = (groupSlug, fileId) => `${downloadUrl(groupSlug, fileId)}&view=1`

const OFFLINE = 'Agora could not be reached. Check your connection and try again.'

/** One folder: { ok, status, data }. folderId null: the circle's own folder. */
export async function listFolder (groupSlug, folderId) {
  try {
    const res = await fetch(`${base(groupSlug)}/list${folderId ? `?folder=${encodeURIComponent(folderId)}` : ''}`, { credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: { error: OFFLINE }, offline: true }
  }
}

/** A call that changes something. path: '/folder', '/rename', '/move', '/delete', '/link'. */
export async function post (groupSlug, path, body) {
  try {
    const res = await fetch(`${base(groupSlug)}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Agora': '1' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: { error: OFFLINE }, offline: true }
  }
}

/**
 * Sends one file to Agora, which passes it on to kDrive. XMLHttpRequest,
 * because only it reports progress. Sent as plain bytes, so the server never
 * reads the file as a form or as JSON.
 */
export function sendFile (groupSlug, file, folderId, onProgress) {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest()
    const query = `?name=${encodeURIComponent(file.name)}${folderId ? `&folder=${encodeURIComponent(folderId)}` : ''}`
    xhr.open('POST', `${base(groupSlug)}/upload${query}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Agora', '1')
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      let body = {}
      try { body = JSON.parse(xhr.responseText) } catch (e) {}
      resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, error: body.error || null })
    }
    xhr.onerror = () => resolve({ ok: false, error: OFFLINE })
    xhr.send(file)
  })
}
