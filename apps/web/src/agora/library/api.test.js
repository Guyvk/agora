// Agora: sending files to the circle library, with a pretend server and pretend storage.
import { uploadFile } from './api'

function fakeFile (size, name = 'Plan.pdf', type = 'application/pdf') {
  return new File([new Uint8Array(size)], name, { type })
}

function fakeApi (plans) {
  const calls = []
  const api = jest.fn(async (path, body) => {
    calls.push({ path, body })
    if (path.endsWith('/uploads')) return { upload: plans.start }
    if (path.endsWith('/part-urls')) return { urls: Object.fromEntries(body.parts.map(n => [n, `https://s3.test/part${n}`])) }
    if (path.endsWith('/relay')) return { upload: plans.relay }
    if (path.endsWith('/finish')) return { stored: true }
    throw new Error(`unexpected ${path}`)
  })
  return { api, calls }
}

describe('uploadFile', () => {
  it('sends a file to Agora in pieces, with progress, and tries a broken piece again', async () => {
    const { api, calls } = fakeApi({ start: { id: '7', mode: 'chunks', chunkSize: 4, chunkCount: 3 } })
    const sent = []
    let failedOnce = false
    const send = jest.fn(async ({ url, body, onProgress }) => {
      if (url.endsWith('/chunk/1') && !failedOnce) { failedOnce = true; return { status: 0 } }
      sent.push({ url, size: body.size })
      onProgress(body.size)
      return { status: 200 }
    })
    const progress = []
    const id = await uploadFile({ groupSlug: 'water', file: fakeFile(10), onProgress: p => progress.push(p), api, send, wait: 0 })
    expect(id).toBe('7')
    expect(calls[0]).toEqual({ path: '/circles/water/uploads', body: { name: 'Plan.pdf', type: 'application/pdf', size: 10 } })
    expect(sent).toEqual([
      { url: '/noo/agora/library/uploads/7/chunk/0', size: 4 },
      { url: '/noo/agora/library/uploads/7/chunk/1', size: 4 },
      { url: '/noo/agora/library/uploads/7/chunk/2', size: 2 }
    ])
    expect(calls[calls.length - 1]).toEqual({ path: '/uploads/7/finish', body: {} })
    expect(progress[progress.length - 1]).toBe(1)
  })

  it('sends a big file straight to object storage in parts, with their ETags', async () => {
    const { api, calls } = fakeApi({ start: { id: '8', mode: 'multipart', partSize: 4, partCount: 3 } })
    const send = jest.fn(async ({ method, url }) => ({ status: 200, etag: `"${url.slice(-5)}"` }))
    await uploadFile({ groupSlug: 'water', file: fakeFile(10), api, send, wait: 0 })
    expect(send.mock.calls.map(c => [c[0].method, c[0].url])).toEqual([
      ['PUT', 'https://s3.test/part1'], ['PUT', 'https://s3.test/part2'], ['PUT', 'https://s3.test/part3']
    ])
    expect(calls.find(c => c.path === '/uploads/8/finish').body).toEqual({
      parts: [{ partNumber: 1, etag: '"part1"' }, { partNumber: 2, etag: '"part2"' }, { partNumber: 3, etag: '"part3"' }]
    })
  })

  it('goes through Agora when the browser cannot reach object storage', async () => {
    const { api, calls } = fakeApi({
      start: { id: '9', mode: 'single', url: 'https://s3.test/whole', headers: { 'Content-Type': 'application/pdf' } },
      relay: { id: '9', mode: 'chunks', chunkSize: 8, chunkCount: 2 }
    })
    const send = jest.fn(async ({ url }) => url.startsWith('https://s3.test') ? { status: 0 } : { status: 200 })
    await uploadFile({ groupSlug: 'water', file: fakeFile(10), api, send, wait: 0 })
    expect(calls.map(c => c.path)).toEqual(['/circles/water/uploads', '/uploads/9/relay', '/uploads/9/finish'])
    expect(send.mock.calls.filter(c => c[0].url.includes('/chunk/')).length).toBe(2)
  })

  it('stops with the server\'s reason when a piece is refused', async () => {
    const { api } = fakeApi({ start: { id: '10', mode: 'chunks', chunkSize: 8, chunkCount: 1 } })
    const send = jest.fn(async () => ({ status: 403, error: 'Only members of this circle can use its library.' }))
    await expect(uploadFile({ groupSlug: 'water', file: fakeFile(3), api, send, wait: 0 })).rejects.toThrow('Only members')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
