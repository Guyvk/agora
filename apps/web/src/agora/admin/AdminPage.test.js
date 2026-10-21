// Agora: the admin dashboard page, with a pretend server.
import React from 'react'
import { Routes, Route, useParams } from 'react-router-dom'
import { AllTheProviders, render, screen, fireEvent, waitFor } from 'util/testing/reactTestingLibraryExtended'
import AdminPage, { OldHelpDeskAddress } from './AdminPage'
import { forgetAdminCheck } from './api'

const noMail = { transport: 'log', sends: false }

const responses = {
  '/me': { isAdmin: true },
  '/overview': {
    members: 12,
    signups: { last7: 2, last30: 5 },
    circles: 6,
    activeLast7: 7,
    pendingInvitations: 3,
    joinRequests: 1,
    helpRequests: 4,
    help: { byStatus: { new: 3, looking: 1, fixed: 2 }, newest: [{ id: '7', title: 'Save fails', status: 'new', type: 'fault', urgency: 'urgent', createdAt: '2026-10-19T08:00:00Z', from: 'Amara' }] },
    meetings: { held: 2, transcribedMinutes: 95, estimatedCost: 0.57, pricePerMinute: 0.006 },
    email: noMail
  },
  '/invitations': {
    page: 1,
    pageSize: 50,
    total: 2,
    email: noMail,
    circles: [{ id: '1', name: 'Governance', slug: 'governance' }],
    invitations: [
      { id: '10', email: 'new@agora.test', status: 'waiting', circle: { id: '1', name: 'Governance' }, invitedBy: { id: '1', name: 'Guy' }, createdAt: '2026-10-18T08:00:00Z', lastSentAt: null, sentCount: 0, link: 'https://agora.example.org/h/use-invitation?token=abc&email=new%40agora.test' },
      { id: '11', email: 'amara@agora.test', status: 'accepted', circle: { id: '1', name: 'Governance' }, invitedBy: { id: '1', name: 'Guy' }, createdAt: '2026-10-17T08:00:00Z', lastSentAt: '2026-10-17T08:00:00Z', sentCount: 1, usedBy: { id: '2', name: 'Amara' }, usedAt: '2026-10-17T09:00:00Z', link: null }
    ]
  },
  '/joins': {
    circles: [{ id: '1', name: 'Governance', slug: 'governance', members: 5, joinedWithoutInvitation: 2, joinLink: 'https://agora.example.org/groups/governance/join/xyz' }],
    joinRequests: [{ id: '3', createdAt: '2026-10-18T08:00:00Z', person: { id: '4', name: 'Lars' }, circle: { id: '1', name: 'Governance', slug: 'governance' } }]
  },
  '/accounts': {
    page: 1,
    pageSize: 50,
    total: 1,
    email: noMail,
    circles: [{ id: '1', name: 'Governance', slug: 'governance' }],
    accounts: [
      { id: '2', name: 'Amara', email: 'amara@agora.test', state: 'active', emailConfirmed: true, joinedAt: '2026-10-01T08:00:00Z', lastActiveAt: null, circles: [{ id: '1', name: 'Governance' }], role: 'member', roleSetOnServer: false, isAgoraAdmin: false, isMe: false },
      { id: '1', name: 'Guy', email: 'guy@agora.test', state: 'active', emailConfirmed: true, joinedAt: '2026-10-01T08:00:00Z', lastActiveAt: null, circles: [], role: 'admin', roleSetOnServer: true, isAgoraAdmin: true, isMe: true },
      { id: '5', name: 'Helper', email: 'helper@agora.test', state: 'deactivated', emailConfirmed: true, joinedAt: '2026-10-01T08:00:00Z', lastActiveAt: null, circles: [], role: 'helpdesk', roleSetOnServer: true, isAgoraAdmin: false, isMe: false }
    ]
  },
  '/accounts/2/role': { ok: true, from: 'member', role: 'admin', emailed: false, email: noMail },
  '/accounts/let-in': { kind: 'signup', email: 'newcomer@agora.test', link: 'https://agora.example.org/signup/verify-email?email=newcomer%40agora.test&token=t0k', hoursValid: 4, emailStatus: noMail },
  '/invitations/10/resend': { ok: true, email: noMail },
  '/accounts/2/deactivate': { ok: true },
  '/system': {
    version: 'abc1234',
    node: 'v24.0.0',
    serverUptimeSeconds: 7200,
    machineUptimeSeconds: 90000,
    memory: { totalBytes: 4294967296, freeBytes: 1073741824 },
    disk: { totalBytes: 42949672960, freeBytes: 21474836480, usedPercent: 50 },
    databaseBytes: 10485760,
    address: 'https://agora.example.org',
    services: { speechToText: false, claude: true, email: noMail, googleDrive: false, driveUploads: false, meetDomain: null, inviteOnly: true },
    backups: { nightly: null, offsite: { configured: null, lastAt: null } }
  },
  '/activity': {
    page: 1,
    pageSize: 50,
    hasMore: false,
    events: [
      { kind: 'invited', at: '2026-10-18T08:00:00Z', person: { id: '1', name: 'Guy' }, circle: { id: '1', name: 'Governance' }, detail: 'new@agora.test' },
      { kind: 'meeting_ended', at: '2026-10-17T08:00:00Z', person: null, circle: null, meeting: { postId: '9', title: 'Weekly call' } },
      { kind: 'role_changed', at: '2026-10-16T08:00:00Z', person: { id: '1', name: 'Guy' }, circle: null, meeting: null, detail: null, target: { id: '6', name: 'David' }, role: { from: 'member', to: 'admin' } }
    ]
  }
}

let calls
function fakeServer ({ admin = true, helpDesk = admin } = {}) {
  calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined })
    if (url.startsWith('/noo/agora/help/api/desk')) {
      if (!helpDesk) return { ok: false, status: 403, json: async () => ({ error: 'The Help desk is for the people who run Agora.' }) }
      return { ok: true, status: 200, json: async () => ({ requests: [{ id: '7', title: 'Save fails', type: 'fault', urgency: 'urgent', status: 'new', user_name: 'Amara', updated_at: '2026-10-19T08:00:00Z', unread: true }], counts: { new: 1 } }) }
    }
    const path = url.replace('/noo/agora/admin/api', '').replace(/\?.*$/, '')
    if (path === '/me') return { ok: true, status: 200, json: async () => ({ isAdmin: admin, helpDesk }) }
    if (!admin || !responses[path]) return { ok: false, status: 404, json: async () => ({ error: 'This page does not exist.' }) }
    return { ok: true, status: 200, json: async () => responses[path] }
  })
}

function renderAt (tab, props = {}) {
  useParams.mockReturnValue(tab ? { tab } : {})
  return render(<AdminPage {...props} />, { wrapper: AllTheProviders({}, ['/admin']) })
}

describe('AdminPage', () => {
  const originalFetch = global.fetch
  const originalConfirm = window.confirm
  beforeEach(() => { forgetAdminCheck(); window.confirm = jest.fn(() => true) })
  afterEach(() => { global.fetch = originalFetch; window.confirm = originalConfirm })

  it('tells someone who is not an admin that the page does not exist, and asks for nothing else', async () => {
    fakeServer({ admin: false })
    renderAt(null)
    expect(await screen.findByText('This page does not exist.')).toBeInTheDocument()
    expect(calls.map(c => c.url)).toEqual(['/noo/agora/admin/api/me'])
  })

  it('shows someone who only runs the Help desk only the Help desk tab, and asks for nothing else of the admin area', async () => {
    fakeServer({ admin: false, helpDesk: true })
    renderAt(null, { tab: 'help-desk' })
    expect(await screen.findByText('Save fails')).toBeInTheDocument()
    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument()
    expect(calls.filter(c => c.url.startsWith('/noo/agora/admin/api')).map(c => c.url)).toEqual(['/noo/agora/admin/api/me'])
  })

  it('shows an Agora admin the Help desk as one of the tabs', async () => {
    fakeServer()
    renderAt(null, { tab: 'help-desk' })
    expect(await screen.findByText('Save fails')).toBeInTheDocument()
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Help desk', { selector: 'button' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows the overview numbers and the speech to text estimate', async () => {
    fakeServer()
    renderAt(null)
    expect(await screen.findByText('Members')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('5 in the last 30 days')).toBeInTheDocument()
    expect(screen.getByText(/95 minutes of meeting sound .* about 0\.57/)).toBeInTheDocument()
    expect(screen.getByText('This is an estimate. The real bill comes from Infomaniak.')).toBeInTheDocument()
    expect(screen.getByText(/Agora cannot send email yet/)).toBeInTheDocument()
    expect(screen.getByText('Help desk: 4 open requests')).toBeInTheDocument()
    expect(screen.getByText('Save fails').closest('a')).toHaveAttribute('href', '/admin/help-desk/7')
    expect(calls.every(c => c.options.headers['X-Agora'] === '1')).toBe(true)
  })

  it('lists invitations, copies a link and resends, saying no email went out', async () => {
    fakeServer()
    Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => {}) } })
    renderAt('invitations')
    expect(await screen.findByText('new@agora.test')).toBeInTheDocument()
    expect(screen.getByText(/Accepted by Amara/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Copy invitation link'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(responses['/invitations'].invitations[0].link))
    fireEvent.click(screen.getByText('Send again'))
    expect(await screen.findByText(/no email went out/)).toBeInTheDocument()
    const resend = calls.find(c => c.url.endsWith('/invitations/10/resend'))
    expect(resend.options.method).toBe('POST')
    expect(resend.options.headers['X-Agora']).toBe('1')
    expect(await screen.findByText('2 joined without an email invitation', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/Lars asked to join Governance/)).toBeInTheDocument()
  })

  it('lets someone in and shows the link to send yourself', async () => {
    fakeServer()
    renderAt('accounts')
    expect(await screen.findByText('Amara')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'newcomer@agora.test' } })
    fireEvent.click(screen.getByText('Make the link'))
    expect(await screen.findByText(responses['/accounts/let-in'].link)).toBeInTheDocument()
    expect(screen.getByText('Send it yourself: Agora cannot email yet.')).toBeInTheDocument()
    expect(calls.find(c => c.url.endsWith('/accounts/let-in')).body).toEqual({ email: 'newcomer@agora.test' })
  })

  it('switches an account off after asking', async () => {
    fakeServer()
    renderAt('accounts')
    fireEvent.click(await screen.findByText('Switch off'))
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/accounts/2/deactivate'))).toBeDefined())
  })

  describe('roles on the Accounts tab', () => {
    const roleCalls = () => calls.filter(c => c.url.endsWith('/role'))

    it('shows each role, and does not let the page change roles from the server settings or your own', async () => {
      fakeServer()
      renderAt('accounts')
      expect(await screen.findByText('Admin (set on the server)')).toBeInTheDocument()
      expect(screen.getByText('Help desk (set on the server)')).toBeInTheDocument()
      // Only Amara's role can be chosen: Guy is named on the server (and is you), Helper too
      const selects = screen.getAllByLabelText('Role')
      expect(selects).toHaveLength(1)
      expect(selects[0]).toHaveValue('member')
      expect([...selects[0].options].map(o => o.textContent)).toEqual(['Member', 'Help desk', 'Admin'])
    })

    it('asks on the page before making someone an admin, and then sends it', async () => {
      fakeServer()
      renderAt('accounts')
      fireEvent.change(await screen.findByLabelText('Role'), { target: { value: 'admin' } })
      expect(screen.getByText(/Make Amara an admin\? Admins can open the whole admin area/)).toBeInTheDocument()
      expect(roleCalls()).toHaveLength(0)
      expect(window.confirm).not.toHaveBeenCalled()
      fireEvent.click(screen.getByText('Yes, make it Admin'))
      expect(await screen.findByText('Done: Amara is now Admin.')).toBeInTheDocument()
      expect(roleCalls()).toHaveLength(1)
      expect(roleCalls()[0].url).toBe('/noo/agora/admin/api/accounts/2/role')
      expect(roleCalls()[0].options.method).toBe('POST')
      expect(roleCalls()[0].options.headers['X-Agora']).toBe('1')
      expect(roleCalls()[0].body).toEqual({ role: 'admin' })
      expect(window.confirm).not.toHaveBeenCalled()
    })

    it('sends nothing when the change is cancelled', async () => {
      fakeServer()
      renderAt('accounts')
      const select = await screen.findByLabelText('Role')
      fireEvent.change(select, { target: { value: 'helpdesk' } })
      expect(screen.getByText(/Let Amara run the Help desk\?/)).toBeInTheDocument()
      fireEvent.click(screen.getByText('Cancel'))
      expect(screen.queryByText(/Let Amara run the Help desk\?/)).not.toBeInTheDocument()
      expect(select).toHaveValue('member')
      expect(roleCalls()).toHaveLength(0)
    })

    it('shows the reason when the server refuses', async () => {
      fakeServer()
      const answer = global.fetch
      global.fetch = jest.fn(async (url, options) => url.endsWith('/role')
        ? { ok: false, status: 409, json: async () => ({ error: 'Only an account that is switched on can get a role.' }) }
        : answer(url, options))
      renderAt('accounts')
      const select = await screen.findByLabelText('Role')
      fireEvent.change(select, { target: { value: 'admin' } })
      fireEvent.click(screen.getByText('Yes, make it Admin'))
      expect(await screen.findByText('Only an account that is switched on can get a role.')).toBeInTheDocument()
      expect(select).toHaveValue('member')
    })
  })

  it('shows the system and says to check on the server what it cannot read', async () => {
    fakeServer()
    renderAt('system')
    expect(await screen.findByText('abc1234')).toBeInTheDocument()
    expect(screen.getByText('Not sent: emails only go into the server log')).toBeInTheDocument()
    expect(screen.getAllByText('check on the server').length).toBeGreaterThan(0)
    expect(screen.getByText('50% used, 20.0 GB free of 40.0 GB')).toBeInTheDocument()
  })

  it('writes the activity log in plain sentences', async () => {
    fakeServer()
    renderAt('activity')
    expect(await screen.findByText('Guy invited new@agora.test to Governance')).toBeInTheDocument()
    expect(screen.getByText('The meeting "Weekly call" ended')).toBeInTheDocument()
    expect(screen.getByText('Guy changed the role of David from Member to Admin')).toBeInTheDocument()
  })

  it('sends the old Help desk address to the Help desk tab', async () => {
    useParams.mockReturnValue({ requestId: '7' })
    render(
      <Routes>
        <Route path='/help-desk/:requestId' element={<OldHelpDeskAddress />} />
        <Route path='/admin/help-desk/7' element={<p>Help desk tab, request 7</p>} />
      </Routes>,
      { wrapper: AllTheProviders({}, ['/help-desk/7']) }
    )
    expect(await screen.findByText('Help desk tab, request 7')).toBeInTheDocument()
  })
})
