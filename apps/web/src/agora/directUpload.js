/**
 * Agora: uploading pictures and files without Filestack.
 *
 * Hylo's upload buttons open Filestack's picker, which sends the file to
 * Filestack's own servers first. Agora has no Filestack key, so instead the
 * browser's own file picker opens and the file goes straight to Agora's server
 * (POST /noo/upload, which Hylo's server already accepts). The server keeps it
 * on its own disk and answers with its address, exactly like a Filestack upload
 * that the server has copied.
 */
import { filestackKey } from 'config/index'
import { acceptFromAttachmentType, uploadedFileToAttachment } from 'client/filestack'
import { isSandboxMode } from 'sandbox/isSandbox'
import { UPLOAD_ATTACHMENT } from 'store/constants'
import { getHost } from 'store/middleware/apiMiddleware'

// The most the server accepts in one file (api/controllers/UploadController.js).
export const MAX_UPLOAD_BYTES = 10 * 1048576

// Used when no translation function is given: fills in {{name}} and the like.
const plainText = (text, values = {}) => text.replace(/{{(\w+)}}/g, (_, key) => values[key] ?? '')

/** True when uploads go straight to Agora's server: there is no Filestack key. */
export function usesDirectUpload () {
  return !filestackKey && !isSandboxMode()
}

/**
 * Opens the browser's file picker. Takes the same callbacks as Hylo's
 * filestackPicker; each chosen file comes back as { file, filename, mimetype },
 * where `file` is the browser's own File, still to be sent.
 */
export function directFilePicker ({
  attachmentType = 'image',
  maxFiles = 1,
  onFileSelected,
  onUploadDone,
  onCancel,
  t = plainText
}) {
  return {
    open () {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = maxFiles > 1
      const accept = acceptFromAttachmentType(attachmentType)
      if (Array.isArray(accept)) input.accept = accept.join(',')

      input.addEventListener('change', async () => {
        const chosen = Array.from(input.files || []).slice(0, maxFiles)
        const files = chosen.filter(file => {
          if (file.size <= MAX_UPLOAD_BYTES) return true
          window.alert(t('{{name}} is larger than 10 MB, the most Agora accepts.', { name: file.name }))
          return false
        })
        if (!files.length) return onCancel?.()
        onFileSelected?.()
        await onUploadDone?.({
          filesUploaded: files.map(file => ({
            file,
            filename: file.name.replace(/\s+/g, '-'),
            mimetype: file.type || 'application/octet-stream'
          }))
        })
      })
      input.addEventListener('cancel', () => onCancel?.())
      input.click()
    }
  }
}

/** Sends one file to Agora's server. Resolves with the server's answer ({ url, type, id, attachmentType }). */
export async function sendFile (type, id, file, fetchImpl = fetch) {
  const body = new FormData()
  // The server reads these before the file, so they go first.
  body.append('type', type)
  body.append('id', id)
  body.append('file', file, file.name.replace(/\s+/g, '-'))
  const response = await fetchImpl(`${getHost()}/noo/upload`, {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  })
  if (response.status !== 200) {
    const error = new Error(await response.text())
    error.response = { status: response.status }
    throw error
  }
  return response.json()
}

/**
 * The same Redux action as Hylo's uploadAttachment, so everything that waits
 * for an upload behaves the same, but the file itself is sent instead of a
 * Filestack address.
 */
export function directUploadAttachment (type, id, file, attachmentType) {
  return {
    type: UPLOAD_ATTACHMENT,
    payload: sendFile(type, id, file),
    meta: { type, id, attachmentType }
  }
}

/**
 * What an upload button does with a file from directFilePicker. With
 * `onInitialUpload` (a new circle or space that does not exist yet) the file is
 * kept as a new upload of the person and its address handed over; otherwise it
 * is stored for the button's own type and id, and `onDone` gets the result.
 */
export async function uploadPickedFile ({ fileUploaded, type, id, attachmentType, onInitialUpload, onDone, dispatch, t = plainText }) {
  const { file, filename, mimetype } = fileUploaded
  const failed = () => window.alert(t('{{name}} could not be uploaded. Please try again.', { name: file.name }))
  if (onInitialUpload) {
    try {
      const { url } = await sendFile('post', 'new', file)
      return onInitialUpload(uploadedFileToAttachment({ url, filename, mimetype, attachmentType }))
    } catch (err) {
      failed()
      return null
    }
  }
  const result = await dispatch(directUploadAttachment(type, id, file, attachmentType))
  if (!result || result.error) failed()
  return onDone(result)
}
