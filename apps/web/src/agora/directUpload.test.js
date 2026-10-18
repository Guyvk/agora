// Agora: uploads that go straight to Agora's server, without Filestack.
import { UPLOAD_ATTACHMENT } from 'store/constants'
import {
  MAX_UPLOAD_BYTES, directFilePicker, sendFile, directUploadAttachment, uploadPickedFile, usesDirectUpload
} from './directUpload'
// The test browser uses Node's own FormData, which only takes Node's own File.
const { File } = require('buffer')

function okResponse (body) {
  return { status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('directUpload', () => {
  let alert
  beforeEach(() => {
    alert = jest.spyOn(window, 'alert').mockImplementation(() => {})
  })
  afterEach(() => alert.mockRestore())

  it('is used when there is no Filestack key', () => {
    expect(usesDirectUpload()).toBe(true)
  })

  it('sends the type and id before the file, to /noo/upload', async () => {
    const fetchImpl = jest.fn(async () => okResponse({ url: 'https://agora.test/noo/uploads/a.png' }))
    const file = new File(['picture'], 'my photo.png', { type: 'image/png' })
    const result = await sendFile('userAvatar', '42', file, fetchImpl)

    expect(result.url).toBe('https://agora.test/noo/uploads/a.png')
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${window.location.origin}/noo/upload`)
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('same-origin')
    const entries = Array.from(options.body.entries())
    expect(entries.map(([name]) => name)).toEqual(['type', 'id', 'file'])
    expect(entries[0][1]).toBe('userAvatar')
    expect(entries[1][1]).toBe('42')
    expect(entries[2][1].name).toBe('my-photo.png')
  })

  it('fails when the server refuses', async () => {
    const fetchImpl = async () => ({ status: 422, text: async () => '{"error":"Validation error"}' })
    await expect(sendFile('userAvatar', '1', new File(['x'], 'a.png'), fetchImpl)).rejects.toThrow('Validation error')
  })

  it('makes the same Redux action as a Filestack upload', async () => {
    const realFetch = global.fetch
    global.fetch = jest.fn(async () => okResponse({ url: 'https://agora.test/noo/uploads/a.pdf', attachmentType: 'file' }))
    try {
      const action = directUploadAttachment('post', 'new', new File(['x'], 'a.pdf'), 'file')
      expect(action.type).toBe(UPLOAD_ATTACHMENT)
      expect(action.meta).toEqual({ type: 'post', id: 'new', attachmentType: 'file' })
      expect(await action.payload).toEqual({ url: 'https://agora.test/noo/uploads/a.pdf', attachmentType: 'file' })
    } finally {
      global.fetch = realFetch
    }
  })

  it('refuses files over 10 MB before sending them', async () => {
    const onUploadDone = jest.fn()
    const onCancel = jest.fn()
    let input
    const createElement = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation(tag => {
      const element = createElement(tag)
      if (tag === 'input') {
        input = element
        element.click = () => {}
      }
      return element
    })
    directFilePicker({ attachmentType: 'image', onUploadDone, onCancel }).open()
    document.createElement.mockRestore()

    const big = new File(['x'], 'big.mov')
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 })
    Object.defineProperty(input, 'files', { value: [big] })
    input.dispatchEvent(new Event('change'))
    await Promise.resolve()

    expect(alert).toHaveBeenCalledWith('big.mov is larger than 10 MB, the most Agora accepts.')
    expect(onUploadDone).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
    expect(input.accept).toBe('image/*')
  })

  it('hands over the address for a circle that does not exist yet', async () => {
    const realFetch = global.fetch
    const fakeFetch = jest.fn(async () => okResponse({ url: 'https://agora.test/noo/uploads/new.png' }))
    global.fetch = fakeFetch
    const onInitialUpload = jest.fn()
    const file = new File(['x'], 'banner.png', { type: 'image/png' })
    try {
      await uploadPickedFile({
        fileUploaded: { file, filename: 'banner.png', mimetype: 'image/png' },
        type: 'groupBanner',
        id: 'new',
        attachmentType: 'image',
        onInitialUpload,
        dispatch: jest.fn()
      })
    } finally {
      global.fetch = realFetch
    }

    expect(onInitialUpload).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://agora.test/noo/uploads/new.png', attachmentType: 'image' }))
    // The circle does not exist yet, so the picture is kept as a new upload of the person
    const fields = Array.from(fakeFetch.mock.calls[0][1].body.entries()).slice(0, 2)
    expect(fields).toEqual([['type', 'post'], ['id', 'new']])
  })

  it('says so when an upload fails', async () => {
    const onDone = jest.fn()
    const realFetch = global.fetch
    global.fetch = jest.fn(async () => ({ status: 500, text: async () => 'no' }))
    try {
      await uploadPickedFile({
        fileUploaded: { file: new File(['x'], 'a.png'), filename: 'a.png', mimetype: 'image/png' },
        type: 'userAvatar',
        id: '1',
        attachmentType: 'image',
        onDone,
        // Like redux-promise: the action comes back marked as an error
        dispatch: async action => action.payload.then(payload => ({ payload }), payload => ({ error: true, payload }))
      })
    } finally {
      global.fetch = realFetch
    }
    expect(alert).toHaveBeenCalledWith('a.png could not be uploaded. Please try again.')
    expect(onDone).toHaveBeenCalledWith({ error: true, payload: expect.any(Error) })
  })
})
