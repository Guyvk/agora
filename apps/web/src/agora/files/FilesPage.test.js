// Agora: the Files page inside the app, with a pretend server.
import React from 'react'
import { useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor, within } from 'util/testing/reactTestingLibraryExtended'
import FilesPage from './FilesPage'
import FolderPicker from './FolderPicker'
import { sortItems, selectionActions, googleUrl, viewKind } from './helpers'

const WAIT = { timeout: 30000 }
// A busy test computer can be very slow.
jest.setTimeout(120000)

const item = (id, name, kind, extra = {}) => ({
  id, name, kind, size: kind === 'file' ? 100 : null, changedAt: '2026-10-20T10:00:00Z', addedBy: 'Amara', canChange: true, ...extra
})

// A tiny pretend kDrive: folders by id, each with items.
function tree () {
  return {
    root: { name: 'Governance', isCircleFolder: true, path: [{ id: 'c', name: 'Governance', isCircleFolder: true }], canAdd: true, items: [
      item('f1', 'Reports', 'folder'),
      item('f2', 'Budget', 'folder'),
      item('m1', 'Minutes', 'folder', { canChange: false, kept: true, addedBy: null }),
      item('a1', 'plan.pdf', 'file', { size: 5000 }),
      item('a2', 'agenda.txt', 'file', { size: 20, addedBy: 'Mei', canChange: false }),
      item('link-3', 'Budget sheet', 'link', { service: 'sheets', url: 'https://docs.google.com/spreadsheets/d/abc/edit', size: null })
    ] },
    f1: { name: 'Reports', isCircleFolder: false, path: [{ id: 'c', name: 'Governance', isCircleFolder: true }, { id: 'f1', name: 'Reports', isCircleFolder: false }], canAdd: true, items: [item('r1', 'q3.pdf', 'file')] },
    f2: { name: 'Budget', isCircleFolder: false, path: [{ id: 'c', name: 'Governance', isCircleFolder: true }, { id: 'f2', name: 'Budget', isCircleFolder: false }], canAdd: true, items: [] },
    m1: { name: 'Minutes', isCircleFolder: false, path: [{ id: 'c', name: 'Governance', isCircleFolder: true }, { id: 'm1', name: 'Minutes', isCircleFolder: false }], canAdd: false, items: [] }
  }
}

let calls, drive, failMove
function fakeServer () {
  calls = []
  drive = tree()
  failMove = null
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url, method, headers: options.headers, body })
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data })
    if (method === 'GET' && url.includes('/kd/list')) {
      const id = new URL(url, 'http://x').searchParams.get('folder') || 'root'
      const f = drive[id]
      if (!f) return reply(404, { error: 'This file or folder is not part of this circle.' })
      return reply(200, { configured: true, maxUploadMb: 100, folder: { id: id === 'root' ? 'c' : id, name: f.name, isCircleFolder: f.isCircleFolder, canAdd: f.canAdd, path: f.path }, items: f.items, isSteward: false })
    }
    if (url.endsWith('/kd/move')) {
      if (failMove) return reply(409, { error: failMove })
      return reply(200, { item: { id: body.item, folder: body.folder } })
    }
    return reply(200, { item: { id: 'x', name: body.name || 'x' } })
  })
}

function renderPage (path = '/groups/governance/files', props = {}) {
  useParams.mockReturnValue({ groupSlug: 'governance' })
  return render(<FilesPage {...props} />, { wrapper: AllTheProviders({}, [path]) })
}

const rowOf = name => screen.getAllByTestId('files-row').find(r => r.textContent.includes(name))
const posts = suffix => calls.filter(c => c.method === 'POST' && c.url.endsWith(suffix))

describe('FilesPage', () => {
  const originalFetch = global.fetch
  const originalXhr = global.XMLHttpRequest
  afterEach(() => { global.fetch = originalFetch; global.XMLHttpRequest = originalXhr })

  it('shows the folder with folders first, then files and links, and who added them', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    const rows = screen.getAllByTestId('files-row')
    expect(rows[0].textContent).toMatch(/^Budget/)
    expect(rows[1].textContent).toMatch(/^Minutes/)
    expect(rows[2].textContent).toMatch(/^Reports/)
    expect(rows[3].textContent).toMatch(/agenda\.txt/)
    expect(rows[4].textContent).toMatch(/Budget sheet/)
    expect(rows[5].textContent).toMatch(/plan\.pdf/)
    expect(within(rows[3]).getByText('Mei')).toBeInTheDocument()
    expect(within(rows[5]).getByText('4.9 KB')).toBeInTheDocument()
    expect(screen.getByTestId('files-path').textContent).toEqual('Governance')
    // the link opens the Google document in a new tab; a file downloads through Agora
    const link = within(rows[4]).getAllByRole('link')[0]
    expect(link.getAttribute('href')).toEqual('https://docs.google.com/spreadsheets/d/abc/edit')
    expect(link.getAttribute('target')).toEqual('_blank')
    expect(within(rows[5]).getAllByRole('link')[0].getAttribute('href')).toEqual('/noo/agora/files/governance/kd/download?file=a1')
  })

  it('shows a plain file in a pop-up instead of downloading it', async () => {
    fakeServer()
    drive.root.items.push(item('a3', 'budget.xlsx', 'file'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'plan.pdf' }, WAIT))
    const viewer = await screen.findByTestId('file-viewer', {}, WAIT)
    expect(within(viewer).getByTitle('plan.pdf').getAttribute('src')).toEqual('/noo/agora/files/governance/kd/download?file=a1&view=1')
    expect(within(viewer).getByRole('link', { name: 'Download' }).getAttribute('href')).toEqual('/noo/agora/files/governance/kd/download?file=a1')
    // a spreadsheet cannot be shown, so it stays a download
    const row = screen.getAllByTestId('files-row').find(r => r.textContent.includes('budget.xlsx'))
    expect(within(row).queryByRole('button', { name: 'View', hidden: true })).toBeNull()
    expect(within(row).getByRole('link', { name: 'budget.xlsx', hidden: true }).getAttribute('href')).toEqual('/noo/agora/files/governance/kd/download?file=a3')
  })

  it('opens a folder in the same page and shows a clickable path', async () => {
    fakeServer()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Reports' }, WAIT))
    await screen.findByText('q3.pdf', {}, WAIT)
    expect(calls.some(c => c.url.includes('/kd/list?folder=f1'))).toBe(true)
    const path = screen.getByTestId('files-path')
    expect(path.textContent).toEqual('Governance/Reports')
    fireEvent.click(within(path).getByRole('button', { name: 'Governance' }))
    await screen.findByText('plan.pdf', {}, WAIT)
  })

  it('sorts by a column, folders always first', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    const first = () => screen.getAllByTestId('files-row').map(r => r.textContent)
    fireEvent.click(screen.getByRole('button', { name: 'Size' }))
    let rows = first()
    expect(rows[0]).toMatch(/^Budget/)
    expect(rows[2]).toMatch(/^Reports/)
    expect(rows[3]).toMatch(/agenda\.txt/)
    expect(rows[4]).toMatch(/plan\.pdf/)
    expect(rows[5]).toMatch(/Budget sheet/)
    fireEvent.click(screen.getByRole('button', { name: 'Size' }))
    rows = first()
    expect(rows[0]).toMatch(/^Budget/)
    expect(rows[3]).toMatch(/plan\.pdf/)
    expect(rows[4]).toMatch(/agenda\.txt/)
    expect(rows[5]).toMatch(/Budget sheet/)
    expect(screen.getByRole('columnheader', { name: /Size/ })).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(first()[3]).toMatch(/agenda\.txt/)
    expect(first()[5]).toMatch(/plan\.pdf/)
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(first()[0]).toMatch(/^Reports/)
    expect(first()[3]).toMatch(/plan\.pdf/)
    expect(first()[5]).toMatch(/agenda\.txt/)
  })

  it('moves one item with the folder picker', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    fireEvent.click(within(rowOf('plan.pdf')).getByRole('button', { name: 'Move to…' }))
    const picker = await screen.findByTestId('files-move-picker', {}, WAIT)
    await within(picker).findByRole('button', { name: 'Reports' }, WAIT)
    // Minutes is not offered, nor the item's own place
    expect(within(picker).queryByRole('button', { name: 'Minutes' })).toBeNull()
    expect(within(picker).getByRole('button', { name: 'Move here' })).toBeDisabled()
    fireEvent.click(within(picker).getByRole('button', { name: 'Reports' }))
    await waitFor(() => expect(within(picker).getByRole('button', { name: 'Move here' })).not.toBeDisabled(), WAIT)
    fireEvent.click(within(picker).getByRole('button', { name: 'Move here' }))
    await waitFor(() => expect(posts('/kd/move')).toHaveLength(1), WAIT)
    expect(posts('/kd/move')[0].body).toEqual({ item: 'a1', folder: 'f1' })
    expect(posts('/kd/move')[0].headers['X-Agora']).toEqual('1')
    await screen.findByText('Moved.', {}, WAIT)
  })

  it('does not offer a folder inside what is being moved, or Minutes, in the picker', async () => {
    fakeServer()
    useParams.mockReturnValue({ groupSlug: 'governance' })
    render(
      <FolderPicker groupSlug='governance' moving={[item('f1', 'Reports', 'folder')]} startFolderId={null} currentFolderId={null} onPick={() => {}} onCancel={() => {}} />,
      { wrapper: AllTheProviders({}, ['/x']) }
    )
    await screen.findByRole('button', { name: 'Budget' }, WAIT)
    expect(screen.queryByRole('button', { name: 'Reports' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Minutes' })).toBeNull()
  })

  it('moves an item dragged onto a folder, and onto a part of the path', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    fireEvent.dragStart(rowOf('plan.pdf'), { dataTransfer: { setData: jest.fn() } })
    fireEvent.dragOver(rowOf('Reports'), { dataTransfer: { types: [] } })
    fireEvent.drop(rowOf('Reports'), { dataTransfer: { types: [] } })
    await waitFor(() => expect(posts('/kd/move')).toHaveLength(1), WAIT)
    expect(posts('/kd/move')[0].body).toEqual({ item: 'a1', folder: 'f1' })
    await screen.findByText('Moved.', {}, WAIT)

    // inside a folder, onto the circle at the top of the path: the circle's own folder is ''
    fireEvent.click(await screen.findByRole('button', { name: 'Reports' }, WAIT))
    await screen.findByText('q3.pdf', {}, WAIT)
    fireEvent.dragStart(rowOf('q3.pdf'), { dataTransfer: { setData: jest.fn() } })
    const part = within(screen.getByTestId('files-path')).getByRole('button', { name: 'Governance' })
    fireEvent.dragOver(part, { dataTransfer: { types: [] } })
    fireEvent.drop(part, { dataTransfer: { types: [] } })
    await waitFor(() => expect(posts('/kd/move')).toHaveLength(2), WAIT)
    expect(posts('/kd/move')[1].body).toEqual({ item: 'r1', folder: '' })
  })

  it('does not let an item that may not be changed be dragged, and takes no drop on a file', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    expect(rowOf('agenda.txt').getAttribute('draggable')).toEqual('false')
    expect(rowOf('plan.pdf').getAttribute('draggable')).toEqual('true')
    fireEvent.dragStart(rowOf('plan.pdf'), { dataTransfer: { setData: jest.fn() } })
    fireEvent.drop(rowOf('agenda.txt'), { dataTransfer: { types: [] } })
    // the Minutes folder takes no drop either
    fireEvent.drop(rowOf('Minutes'), { dataTransfer: { types: [] } })
    expect(posts('/kd/move')).toHaveLength(0)
  })

  it('selects several and offers only what is allowed for all of them', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    fireEvent.click(screen.getByLabelText('Select plan.pdf'))
    let bar = screen.getByTestId('files-selection-bar')
    expect(within(bar).getByText('1 selected')).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Move to…' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    // a file somebody else added: no Move or Delete
    fireEvent.click(screen.getByLabelText('Select agenda.txt'))
    bar = screen.getByTestId('files-selection-bar')
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()
    expect(within(bar).queryByRole('button', { name: 'Move to…' })).toBeNull()
    expect(within(bar).queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(within(bar).getByRole('button', { name: 'Download' })).toBeInTheDocument()
    // a folder: no Download
    fireEvent.click(screen.getByLabelText('Select agenda.txt'))
    fireEvent.click(screen.getByLabelText('Select Reports'))
    bar = screen.getByTestId('files-selection-bar')
    expect(within(bar).queryByRole('button', { name: 'Download' })).toBeNull()
    expect(within(bar).getByRole('button', { name: 'Move to…' })).toBeInTheDocument()
  })

  it('selects all, and deletes the selection after one question', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    fireEvent.click(screen.getByLabelText('Select Minutes'))
    fireEvent.click(screen.getByLabelText('Select Minutes'))
    fireEvent.click(screen.getByLabelText('Select all'))
    expect(within(screen.getByTestId('files-selection-bar')).getByText('6 selected')).toBeInTheDocument()
    // Minutes and a file of someone else are in it: no Delete is offered
    expect(within(screen.getByTestId('files-selection-bar')).queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(screen.getByLabelText('Select all'))
    fireEvent.click(screen.getByLabelText('Select plan.pdf'))
    fireEvent.click(screen.getByLabelText('Select Reports'))
    fireEvent.click(screen.getByLabelText('Select Budget sheet'))
    fireEvent.click(within(screen.getByTestId('files-selection-bar')).getByRole('button', { name: 'Delete' }))
    expect(posts('/kd/delete')).toHaveLength(0)
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Delete these 3 items/)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(posts('/kd/delete')).toHaveLength(3), WAIT)
    expect(posts('/kd/delete').map(c => c.body.item).sort()).toEqual(['a1', 'f1', 'link-3'])
    await screen.findByText('Deleted.', {}, WAIT)
  })

  it('moves the selection with Move to…', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    fireEvent.click(screen.getByLabelText('Select plan.pdf'))
    fireEvent.click(screen.getByLabelText('Select Budget sheet'))
    fireEvent.click(within(screen.getByTestId('files-selection-bar')).getByRole('button', { name: 'Move to…' }))
    const picker = await screen.findByTestId('files-move-picker', {}, WAIT)
    fireEvent.click(await within(picker).findByRole('button', { name: 'Budget' }, WAIT))
    await waitFor(() => expect(within(picker).getByRole('button', { name: 'Move here' })).not.toBeDisabled(), WAIT)
    fireEvent.click(within(picker).getByRole('button', { name: 'Move here' }))
    await waitFor(() => expect(posts('/kd/move')).toHaveLength(2), WAIT)
    expect(posts('/kd/move').map(c => c.body)).toEqual([{ item: 'link-3', folder: 'f2' }, { item: 'a1', folder: 'f2' }])
    await screen.findByText('Moved 2 items.', {}, WAIT)
  })

  it('says what the server said when a move is refused', async () => {
    fakeServer()
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    failMove = 'Something with this name is already there.'
    fireEvent.dragStart(rowOf('plan.pdf'), { dataTransfer: { setData: jest.fn() } })
    fireEvent.drop(rowOf('Reports'), { dataTransfer: { types: [] } })
    await screen.findByText('plan.pdf: Something with this name is already there.', {}, WAIT)
  })

  it('adds files into the open folder, with progress', async () => {
    fakeServer()
    const sent = []
    global.XMLHttpRequest = class {
      constructor () { this.upload = {}; this.headers = {} }
      open (method, url) { this.method = method; this.url = url }
      setRequestHeader (k, v) { this.headers[k] = v }
      send (file) {
        sent.push({ method: this.method, url: this.url, headers: this.headers, name: file.name })
        this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 })
        this.status = 200
        this.responseText = '{"item":{}}'
        this.onload()
      }
    }
    renderPage('/groups/governance/files?folder=f1')
    await screen.findByText('q3.pdf', {}, WAIT)
    const file = new File(['hello'], 'new plan.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('files-input'), { target: { files: [file] } })
    await screen.findByText('Added.', {}, WAIT)
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toEqual('/noo/agora/files/governance/kd/upload?name=new%20plan.txt&folder=f1')
    expect(sent[0].headers['X-Agora']).toEqual('1')
    expect(sent[0].headers['Content-Type']).toEqual('application/octet-stream')
  })

  it('takes files dropped on the list, and refuses empty ones', async () => {
    fakeServer()
    const sent = []
    global.XMLHttpRequest = class {
      constructor () { this.upload = {} }
      open (method, url) { this.url = url }
      setRequestHeader () {}
      send (file) { sent.push(file.name); this.status = 200; this.responseText = '{}'; this.onload() }
    }
    renderPage()
    await screen.findByText('plan.pdf', {}, WAIT)
    const list = screen.getByTestId('files-list')
    const files = [new File(['abc'], 'one.txt'), new File([''], 'empty.txt')]
    fireEvent.dragOver(list, { dataTransfer: { types: ['Files'] } })
    fireEvent.drop(list, { dataTransfer: { types: ['Files'], files } })
    await screen.findByText(/empty\.txt: empty, so not added\./, {}, WAIT)
    expect(sent).toEqual(['one.txt'])
  })

  it('adds nothing to the Minutes folder, and shows why', async () => {
    fakeServer()
    renderPage('/groups/governance/files?folder=m1')
    await screen.findByText('This folder is empty.', {}, WAIT)
    expect(screen.queryByRole('button', { name: 'Add files' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull()
    expect(screen.getByText('This folder is only for the meeting minutes.')).toBeInTheDocument()
  })

  it('makes a folder, renames, and adds a link in the open folder', async () => {
    fakeServer()
    renderPage('/groups/governance/files?folder=f1')
    await screen.findByText('q3.pdf', {}, WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    const form = screen.getByRole('form', { name: 'New folder' })
    fireEvent.change(within(form).getByLabelText('Name of the new folder'), { target: { value: 'Drafts' } })
    fireEvent.submit(form)
    await waitFor(() => expect(posts('/kd/folder')).toHaveLength(1), WAIT)
    expect(posts('/kd/folder')[0].body).toEqual({ name: 'Drafts', folder: 'f1' })
    await screen.findByText('Folder made.', {}, WAIT)

    fireEvent.click(within(rowOf('q3.pdf')).getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'q3 final.pdf' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Rename' }))
    await waitFor(() => expect(posts('/kd/rename')).toHaveLength(1), WAIT)
    expect(posts('/kd/rename')[0].body).toEqual({ item: 'r1', name: 'q3 final.pdf' })
    await screen.findByText('Renamed.', {}, WAIT)

    fireEvent.click(screen.getByRole('button', { name: 'Add a Google Doc' }))
    const linkForm = screen.getByRole('form', { name: 'Add a Google Doc' })
    fireEvent.change(within(linkForm).getByLabelText('Link to the Google document'), { target: { value: 'https://docs.google.com/document/d/abc/edit' } })
    fireEvent.change(within(linkForm).getByLabelText('Title (optional)'), { target: { value: 'Plan' } })
    fireEvent.submit(linkForm)
    await waitFor(() => expect(posts('/kd/link')).toHaveLength(1), WAIT)
    expect(posts('/kd/link')[0].body).toEqual({ url: 'https://docs.google.com/document/d/abc/edit', title: 'Plan', folder: 'f1' })
  })

  it('says plainly when the person is not a member', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Only members of this circle can see and add its files.' }) }))
    renderPage()
    expect((await screen.findByRole('alert', {}, WAIT)).textContent).toEqual('Only members of this circle can see and add its files.')
  })

  it('uses the group it is given (a space) instead of the address', async () => {
    fakeServer()
    renderPage('/groups/governance/spaces/budget/files', { groupSlug: 'governance-budget' })
    await screen.findByText('plan.pdf', {}, WAIT)
    expect(calls[0].url).toContain('/noo/agora/files/governance-budget/kd/list')
  })
})

describe('Files helpers', () => {
  const list = [
    item('1', 'b.txt', 'file', { size: 10, changedAt: '2026-01-02T00:00:00Z', addedBy: 'Zed' }),
    item('2', 'A folder', 'folder'),
    item('3', 'a.txt', 'file', { size: 30, changedAt: '2026-01-01T00:00:00Z', addedBy: 'Amy' }),
    item('4', 'a link', 'link', { size: null, changedAt: null, addedBy: null }),
    item('5', 'file 10', 'file', { size: 5 }),
    item('6', 'file 9', 'file', { size: 5 })
  ]
  const order = (key, dir) => sortItems(list, key, dir).map(i => i.name)

  it('puts folders first for every column and direction', () => {
    for (const key of ['name', 'addedBy', 'date', 'size']) {
      for (const dir of ['asc', 'desc']) expect(order(key, dir)[0]).toEqual('A folder')
    }
  })

  it('mixes files and links by name, with numbers in order', () => {
    expect(order('name', 'asc')).toEqual(['A folder', 'a link', 'a.txt', 'b.txt', 'file 9', 'file 10'])
    expect(order('name', 'desc')).toEqual(['A folder', 'file 10', 'file 9', 'b.txt', 'a.txt', 'a link'])
  })

  it('sorts by who added it, date and size, empty values last', () => {
    expect(order('addedBy', 'asc')).toEqual(['A folder', 'file 9', 'file 10', 'a.txt', 'b.txt', 'a link'])
    expect(order('date', 'asc').slice(1, 3)).toEqual(['a.txt', 'b.txt'])
    expect(order('size', 'asc').slice(1, 4)).toEqual(['file 9', 'file 10', 'b.txt'])
    expect(order('size', 'desc').slice(1, 3)).toEqual(['a.txt', 'b.txt'])
    expect(order('size', 'asc').pop()).toEqual('a link')
    expect(order('size', 'desc').pop()).toEqual('a link')
  })

  it('offers only what may be done with every selected item', () => {
    const mine = item('1', 'a', 'file')
    const theirs = item('2', 'b', 'file', { canChange: false })
    const folder = item('3', 'c', 'folder')
    expect(selectionActions([])).toEqual({ move: false, remove: false, download: false })
    expect(selectionActions([mine])).toEqual({ move: true, remove: true, download: true })
    expect(selectionActions([mine, theirs])).toEqual({ move: false, remove: false, download: true })
    expect(selectionActions([mine, folder])).toEqual({ move: true, remove: true, download: false })
  })

  it('shows only plain files in the viewer, never a web page', () => {
    expect(viewKind('Plan.PDF')).toEqual('pdf')
    expect(viewKind('photo.jpeg')).toEqual('image')
    expect(viewKind('notes.md')).toEqual('text')
    for (const name of ['page.html', 'logo.svg', 'data.xml', 'budget.xlsx', 'report.docx', 'pdf', '']) {
      expect(viewKind(name)).toBeNull()
    }
  })

  it('opens links only at Google', () => {
    expect(googleUrl('https://docs.google.com/document/d/1/edit')).toMatch(/^https:\/\/docs\.google\.com/)
    expect(googleUrl('javascript:alert(1)')).toBeNull()
    expect(googleUrl('https://evil.example/docs.google.com')).toBeNull()
    expect(googleUrl('http://docs.google.com/x')).toBeNull()
  })
})
