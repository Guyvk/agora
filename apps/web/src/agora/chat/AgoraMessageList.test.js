/* eslint-env jest */
import React, { createRef } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import AgoraMessageList, { useMessageListLocation } from './AgoraMessageList'

// jsdom draws nothing, so give it a pretend layout: every message is 100px
// high, the pane shows 500px, and the content scrolls by scrollTop.
const ROW = 100
const PANE = 500
let originalRect

function scrollerOf (container) {
  return container.querySelector('[data-agora-chat-scroller]')
}

function fakeLayout (scroller) {
  let scrollTop = 0
  const rows = () => scroller.querySelectorAll('[data-item-index]').length
  const maxTop = () => Math.max(0, rows() * ROW - PANE)
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => PANE })
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => Math.max(PANE, rows() * ROW) })
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: value => { scrollTop = Math.min(Math.max(0, value), maxTop()) }
  })
  scroller.scrollTo = undefined
}

beforeAll(() => {
  originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    const scroller = this.closest('[data-agora-chat-scroller]') || (this.matches('[data-agora-chat-scroller]') ? this : null)
    if (this.hasAttribute && this.hasAttribute('data-agora-chat-scroller')) {
      return { top: 0, bottom: PANE, height: PANE, left: 0, right: 100, width: 100 }
    }
    if (this.hasAttribute && this.hasAttribute('data-item-index') && scroller) {
      const index = Number(this.getAttribute('data-item-index'))
      const top = index * ROW - scroller.scrollTop
      return { top, bottom: top + ROW, height: ROW, left: 0, right: 100, width: 100 }
    }
    return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 }
  }
})

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect
})

const posts = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: String(from + i), text: `message ${from + i}` }))

const ItemContent = ({ data, prevData }) => (
  <div data-testid='row' data-prev={prevData?.id || ''}>{data.text}</div>
)

function renderList (props = {}) {
  const ref = createRef()
  const utils = render(
    <AgoraMessageList
      ref={ref}
      context={{}}
      computeItemKey={({ data }) => data.id}
      ItemContent={ItemContent}
      {...props}
    />
  )
  const scroller = scrollerOf(utils.container)
  fakeLayout(scroller)
  return { ...utils, ref, scroller }
}

describe('AgoraMessageList', () => {
  it('shows the messages oldest first, newest at the bottom', () => {
    renderList({ initialData: posts(1, 3) })
    const rows = screen.getAllByTestId('row')
    expect(rows.map(r => r.textContent)).toEqual(['message 1', 'message 2', 'message 3'])
    expect(rows[1].getAttribute('data-prev')).toBe('1')
  })

  it('shows the empty placeholder when there are no messages', () => {
    renderList({ initialData: [], EmptyPlaceholder: () => <div>quiet room</div> })
    expect(screen.getByText('quiet room')).toBeInTheDocument()
  })

  it('opens at the given message', () => {
    const { ref, scroller } = renderList({ initialData: [] })
    act(() => { ref.current.data.replace(posts(1, 20), { initialLocation: { index: 19, align: 'start-no-overflow' } }) })
    // 20 rows of 100px in a 500px pane: the newest at the bottom
    expect(scroller.scrollTop).toBe(1500)
    act(() => { ref.current.data.replace(posts(1, 20), { initialLocation: { index: 5, align: 'start-no-overflow' } }) })
    expect(scroller.scrollTop).toBe(500)
  })

  it('scrolls down for a new message when asked, and asks whether it is at the bottom', () => {
    const { ref, scroller } = renderList({ initialData: [] })
    act(() => { ref.current.data.replace(posts(1, 10), { initialLocation: { index: 9, align: 'end' } }) })
    expect(scroller.scrollTop).toBe(500)
    const decide = jest.fn(() => 'auto')
    act(() => { ref.current.data.append(posts(11, 11), decide) })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ atBottom: true }))
    expect(scroller.scrollTop).toBe(600)
    expect(screen.getAllByTestId('row')).toHaveLength(11)
  })

  it('keeps its place when newer messages arrive while reading older ones', () => {
    const { ref, scroller } = renderList({ initialData: [] })
    act(() => { ref.current.data.replace(posts(1, 10), { initialLocation: { index: 2, align: 'start' } }) })
    expect(scroller.scrollTop).toBe(200)
    const decide = jest.fn(({ atBottom }) => atBottom ? 'smooth' : false)
    act(() => { ref.current.data.append(posts(11, 12), decide) })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ atBottom: false }))
    expect(scroller.scrollTop).toBe(200)
  })

  it('keeps the same message on screen when older messages load at the top', () => {
    const { ref, scroller } = renderList({ initialData: [] })
    act(() => { ref.current.data.replace(posts(11, 20), { initialLocation: { index: 1, align: 'start' } }) })
    expect(scroller.scrollTop).toBe(100)
    fireEvent.scroll(scroller)
    act(() => { ref.current.data.prepend(posts(1, 10)) })
    // message 12 was at the top of the pane and still is: 10 rows were added above it
    expect(scroller.scrollTop).toBe(1100)
  })

  it('stays at the bottom when a message changes while at the bottom', () => {
    const { ref, scroller } = renderList({ initialData: [] })
    act(() => { ref.current.data.replace(posts(1, 10), { initialLocation: { index: 9, align: 'end' } }) })
    act(() => { ref.current.data.map(item => item.id === '10' ? { ...item, text: 'edited' } : item) })
    expect(screen.getByText('edited')).toBeInTheDocument()
    expect(scroller.scrollTop).toBe(500)
  })

  it('deletes a message', () => {
    const { ref } = renderList({ initialData: posts(1, 3) })
    act(() => { ref.current.data.findAndDelete(item => item.id === '2') })
    expect(screen.getAllByTestId('row').map(r => r.textContent)).toEqual(['message 1', 'message 3'])
  })

  it('reports the messages on screen, for marking the room as read', () => {
    const onRenderedDataChange = jest.fn()
    const { ref, scroller } = renderList({ initialData: [], onRenderedDataChange })
    act(() => { ref.current.data.replace(posts(1, 10), { initialLocation: { index: 9, align: 'end' } }) })
    const lastCall = onRenderedDataChange.mock.calls[onRenderedDataChange.mock.calls.length - 1][0]
    expect(lastCall.map(p => p.id)).toEqual(['6', '7', '8', '9', '10'])
    act(() => { scroller.scrollTop = 0; fireEvent.scroll(scroller) })
    const afterScroll = onRenderedDataChange.mock.calls[onRenderedDataChange.mock.calls.length - 1][0]
    expect(afterScroll.map(p => p.id)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('tells the room where it is scrolled, for loading more', () => {
    const onScroll = jest.fn()
    const { ref, scroller } = renderList({ initialData: [], onScroll })
    act(() => { ref.current.data.replace(posts(1, 10), { initialLocation: { index: 9, align: 'end' } }) })
    act(() => { scroller.scrollTop = 0; fireEvent.scroll(scroller) })
    expect(onScroll).toHaveBeenLastCalledWith(expect.objectContaining({ listOffset: -0, bottomOffset: 500 }))
    expect(ref.current.getScrollLocation().bottomOffset).toBe(500)
  })

  it('scrolls to the last message with scrollToItem LAST', () => {
    const { ref, scroller } = renderList({ initialData: [] })
    act(() => { ref.current.data.replace(posts(1, 10), { initialLocation: { index: 0, align: 'start' } }) })
    expect(scroller.scrollTop).toBe(0)
    act(() => { ref.current.scrollToItem({ index: 'LAST', align: 'end', behavior: 'auto' }) })
    expect(scroller.scrollTop).toBe(500)
  })

  it('gives StickyFooter the scroll location', () => {
    const StickyFooter = () => {
      const location = useMessageListLocation()
      return <div>{location.isAtBottom ? 'at bottom' : 'reading back'}</div>
    }
    const { ref, scroller } = renderList({ initialData: [], StickyFooter })
    act(() => { ref.current.data.replace(posts(1, 10), { initialLocation: { index: 9, align: 'end' } }) })
    expect(screen.getByText('at bottom')).toBeInTheDocument()
    act(() => { scroller.scrollTop = 0; fireEvent.scroll(scroller) })
    expect(screen.getByText('reading back')).toBeInTheDocument()
  })
})
