// Agora: the circle library on the Resources tab, with a pretend server.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import LibraryPage from './LibraryPage'
import { uploadFile } from './api'

jest.mock('./api', () => ({ ...jest.requireActual('./api'), uploadFile: jest.fn() }))

const items = [
  { id: '11', title: 'River plan', kind: 'document', description: 'The plan we agreed.', tags: ['water'], createdAt: '2026-10-12T08:00:00Z', addedBy: { id: '2', name: 'Amara' }, link: null, meeting: false, fileCount: 1, size: 2048, textStatus: 'done', snippet: null },
  { id: '12', title: 'Meeting notes: River call (2026-10-18)', kind: 'meeting', description: '', tags: ['minutes'], createdAt: '2026-10-18T08:00:00Z', addedBy: { id: '9', name: 'Agora Assistant' }, link: null, meeting: true, fileCount: 1, size: 300, textStatus: 'done', snippet: null }
]

const recording = {
  ...items[0],
  id: '13',
  title: 'Call with the mayor',
  kind: 'audio',
  descriptionHtml: '',
  postUrl: '/post/13',
  files: [{ mediaId: '5', name: 'Call.m4a', url: 'https://agora.test/noo/agora/library/file/3/Call.m4a', kind: 'audio', mimeType: 'audio/mp4', size: 5000000 }],
  texts: [{ id: '1', mediaId: '5', kind: 'audio', title: 'Call.m4a', status: 'done', text: '[0:00] We will clean the river on Saturday.', cut: false }]
}

let calls
function fakeServer ({ status = 200, list = items } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const reply = body => ({ ok: status < 400, status, json: async () => body })
    if (status >= 400) return reply({ error: 'Only members of this circle can use its library.' })
    if (url.endsWith('/settings')) return reply({ circleName: 'Water circle', storage: 'disk', maxMediaMb: 500, maxDocumentMb: 100, canAdd: true })
    if (url.includes('/items/13')) return reply({ item: recording })
    if (url.includes('/items') && options.method === 'POST') return reply({ item: { ...items[0], id: '20' } })
    if (url.includes('/items/20')) return reply({ item: { ...recording, id: '20', title: 'New report', files: [], texts: [] } })
    if (url.includes('/items')) return reply({ items: url.includes('search=mayor') ? [{ ...recording, snippet: 'clean the river on Saturday' }] : list, hasMore: false, offset: 0 })
    return reply({})
  })
}

function renderPage (path = '/groups/water/resources') {
  useParams.mockReturnValue({ groupSlug: 'water' })
  return render(<LibraryPage />, { wrapper: AllTheProviders({}, [path]) })
}

describe('LibraryPage', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch; uploadFile.mockReset() })

  it('lists the items with their kind, who added them, when, and their tags', async () => {
    fakeServer()
    renderPage()
    const rows = await screen.findAllByTestId('library-item', {}, { timeout: 10000 })
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('River plan')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/Document · .* by Amara · 2 KB/)).toBeInTheDocument()
    expect(within(rows[0]).getByText('#water')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Text ready')).toBeInTheDocument()
    expect(within(rows[1]).getByText(/Meeting notes · .* by Agora Assistant/)).toBeInTheDocument()
    expect(calls[0].url).toBe('/noo/agora/library/circles/water/settings')
    expect(calls[1].url).toBe('/noo/agora/library/circles/water/items')
  })

  it('searches titles, descriptions and the text inside files, and shows where it was found', async () => {
    fakeServer()
    renderPage()
    await screen.findAllByTestId('library-item', {}, { timeout: 10000 })
    fireEvent.change(screen.getByLabelText('Search the library'), { target: { value: 'mayor' } })
    await waitFor(() => expect(calls.some(c => c.url === '/noo/agora/library/circles/water/items?search=mayor')).toBe(true))
    expect(await screen.findByText(/clean the river on Saturday/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'meeting' } })
    await waitFor(() => expect(calls.some(c => c.url.includes('kind=meeting'))).toBe(true))
  })

  it('opens an item: plays the recording and shows its transcript', async () => {
    fakeServer()
    const { container } = renderPage('/groups/water/resources?item=13')
    const detail = await screen.findByTestId('library-detail')
    expect(within(detail).getByText('Call with the mayor')).toBeInTheDocument()
    expect(container.querySelector('audio').getAttribute('src')).toBe('https://agora.test/noo/agora/library/file/3/Call.m4a')
    expect(within(detail).getByText('Transcript')).toBeInTheDocument()
    expect(within(detail).getByText(/We will clean the river on Saturday/)).toBeInTheDocument()
    expect(within(detail).getByRole('link', { name: 'Download' })).toHaveAttribute('href', 'https://agora.test/noo/agora/library/file/3/Call.m4a?download=1')
  })

  it('adds a dropped file with a title and tags, as an item of the library', async () => {
    fakeServer()
    uploadFile.mockImplementation(async ({ onProgress }) => { onProgress(0.5); onProgress(1); return '77' })
    renderPage()
    const page = await screen.findByTestId('library-page')
    await screen.findAllByTestId('library-item', {}, { timeout: 10000 })
    const file = new File(['hello'], 'Report.pdf', { type: 'application/pdf' })
    fireEvent.drop(page, { dataTransfer: { files: [file], types: ['Files'] } })
    const form = await screen.findByTestId('library-add')
    expect(within(form).getByText('Report.pdf')).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'New report' } })
    fireEvent.change(within(form).getByLabelText('Tags, separated by commas'), { target: { value: 'budget, water' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls.some(c => c.options.method === 'POST')).toBe(true))
    const post = calls.find(c => c.options.method === 'POST')
    expect(post.url).toBe('/noo/agora/library/circles/water/items')
    expect(post.options.headers['X-Agora']).toBe('1')
    expect(JSON.parse(post.options.body)).toEqual({ title: 'New report', description: '', tags: 'budget, water', link: '', fileIds: ['77'] })
    expect(uploadFile.mock.calls[0][0].groupSlug).toBe('water')
    expect(uploadFile.mock.calls[0][0].file).toBe(file)
  })

  it('refuses a file that is too big before sending it', async () => {
    fakeServer()
    renderPage()
    await screen.findAllByTestId('library-item', {}, { timeout: 10000 })
    fireEvent.click(screen.getByRole('button', { name: /Add to the library/ }))
    const form = await screen.findByTestId('library-add')
    const big = new File(['x'], 'Huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 101 * 1048576 })
    fireEvent.change(screen.getByTestId('library-file-input'), { target: { files: [big] } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Huge.pdf is larger than 100 MB')
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('says so when the person is not a member of the circle', async () => {
    fakeServer({ status: 403 })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Only members of this circle can use its library.')
    expect(screen.queryByTestId('library-item')).toBeNull()
  })
})
