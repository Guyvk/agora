/**
 * Agora: a plain chat message list, used in place of Hylo's paid
 * `@virtuoso.dev/message-list`. That library needs a commercial licence key and
 * shows nothing at all without one. This list draws every loaded message (no
 * virtual scrolling) and offers the small part of that library's interface the
 * chat room uses, so `routes/ChatRoom/ChatRoom.js` changes by only a few lines:
 *
 * - newest at the bottom, short rooms sit at the bottom of the pane
 * - `initialLocation` / `data.replace(..., { initialLocation })` place the
 *   chosen message (last read, or the newest) when a room opens
 * - `data.append(items, fn)` asks `fn({ atBottom, scrollInProgress })` whether
 *   to scroll down ('smooth', 'auto' or false), so one's own new message and
 *   new messages while at the bottom scroll into view
 * - `data.prepend(items)` (older messages loaded at the top) keeps what is on
 *   screen in place
 * - when the list is at the bottom, it stays there while messages, pictures or
 *   the pane itself change size
 * - `onScroll(location)` drives loading older and newer pages
 * - `onRenderedDataChange(items)` reports the messages actually on screen, for
 *   marking the room as read up to the lowest one
 */
import React, {
  createContext,
  forwardRef,
  memo,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'

// Within this many pixels of the end counts as "at the bottom"
export const BOTTOM_THRESHOLD = 8

const DEFAULT_LOCATION = { listOffset: 0, bottomOffset: 0, visibleListHeight: 0, scrollHeight: 0, isAtBottom: true }

function createStore (initial) {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    set: next => {
      value = next
      listeners.forEach(listener => listener())
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

const ListContext = createContext(null)
const emptyStore = createStore(DEFAULT_LOCATION)
const noMethods = { scrollToItem: () => {}, getScrollLocation: () => DEFAULT_LOCATION }

/** Where the list is scrolled to; for parts drawn by the list, such as StickyFooter. */
export function useMessageListLocation () {
  const store = useContext(ListContext)?.locationStore || emptyStore
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** The list's methods (scrollToItem and so on), for parts drawn by the list. */
export function useMessageListMethods () {
  return useContext(ListContext)?.methods || noMethods
}

function shallowEqual (a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every(key => a[key] === b[key])
}

const Row = memo(function Row ({ ItemContent, item, prevItem, nextItem, index, context, itemKey }) {
  return (
    <div data-item-index={index} data-item-key={itemKey}>
      <ItemContent data={item} prevData={prevItem} nextData={nextItem} index={index} context={context} />
    </div>
  )
}, (a, b) => a.item === b.item && a.prevItem === b.prevItem && a.nextItem === b.nextItem &&
  a.index === b.index && a.itemKey === b.itemKey && a.ItemContent === b.ItemContent &&
  shallowEqual(a.context, b.context))

function rowsOf (content) {
  if (!content) return []
  return Array.from(content.children).filter(child => child.dataset?.itemKey != null)
}

const AgoraMessageList = forwardRef(function AgoraMessageList ({
  initialData,
  initialLocation,
  context,
  computeItemKey,
  onScroll,
  onRenderedDataChange,
  ItemContent,
  Header,
  Footer,
  StickyFooter,
  EmptyPlaceholder,
  style,
  className
}, ref) {
  const scrollerRef = useRef(null)
  const contentRef = useRef(null)
  const dataRef = useRef(initialData || [])
  const [, setVersion] = useState(0)
  // A change to the data that React has not drawn yet
  const dirtyRef = useRef(false)
  const mutationRef = useRef(null)
  const pendingScrollRef = useRef(
    !initialData?.length
      ? null
      : initialLocation && initialLocation.index != null ? { location: initialLocation } : { bottom: 'auto' }
  )
  const atBottomRef = useRef(true)
  // A smooth scroll to the bottom that we started and that has not arrived yet
  const followRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  // The top message on screen and its distance from the top of the pane
  const anchorRef = useRef(null)
  const visibleSigRef = useRef(null)
  const locationStore = useMemo(() => createStore(DEFAULT_LOCATION), [])

  const propsRef = useRef({})
  propsRef.current = { onScroll, onRenderedDataChange, computeItemKey, context }

  const keyFor = (item, index) => {
    const compute = propsRef.current.computeItemKey
    const key = compute ? compute({ data: item, index, context: propsRef.current.context }) : (item?.id ?? index)
    return String(key)
  }

  const api = useMemo(() => {
    const measure = () => {
      const el = scrollerRef.current
      if (!el) return null
      const bottomOffset = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight)
      return {
        listOffset: -el.scrollTop,
        bottomOffset,
        visibleListHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        isAtBottom: bottomOffset <= BOTTOM_THRESHOLD
      }
    }

    const publish = loc => {
      if (!loc) return
      const prev = locationStore.get()
      if (Math.round(prev.bottomOffset) !== Math.round(loc.bottomOffset) ||
          Math.round(prev.listOffset) !== Math.round(loc.listOffset) ||
          prev.visibleListHeight !== loc.visibleListHeight ||
          prev.isAtBottom !== loc.isAtBottom) {
        locationStore.set(loc)
      }
    }

    const recordAnchor = () => {
      const scroller = scrollerRef.current
      if (!scroller) { anchorRef.current = null; return }
      const top = scroller.getBoundingClientRect().top
      for (const row of rowsOf(contentRef.current)) {
        const rect = row.getBoundingClientRect()
        if (rect.bottom > top) {
          anchorRef.current = { key: row.dataset.itemKey, offset: rect.top - top }
          return
        }
      }
      anchorRef.current = null
    }

    const restoreAnchor = () => {
      const scroller = scrollerRef.current
      const anchor = anchorRef.current
      if (!scroller || !anchor) return
      const row = rowsOf(contentRef.current).find(r => r.dataset.itemKey === anchor.key)
      if (!row) return
      const diff = (row.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - anchor.offset
      if (Math.abs(diff) >= 1) scroller.scrollTop = scroller.scrollTop + diff
    }

    const reportVisible = () => {
      const report = propsRef.current.onRenderedDataChange
      const scroller = scrollerRef.current
      if (!report || !scroller) return
      const { top, bottom } = scroller.getBoundingClientRect()
      let first = -1
      let last = -1
      for (const row of rowsOf(contentRef.current)) {
        const rect = row.getBoundingClientRect()
        const index = Number(row.dataset.itemIndex)
        if (rect.bottom > top && rect.top < bottom) {
          if (first === -1) first = index
          last = index
        } else if (first !== -1) {
          break
        }
      }
      const data = dataRef.current
      const sig = first === -1 ? 'none' : `${first}:${last}:${keyFor(data[first], first)}:${keyFor(data[last], last)}`
      if (sig === visibleSigRef.current) return
      visibleSigRef.current = sig
      report(first === -1 ? [] : data.slice(first, last + 1))
    }

    // After any change of scroll position or size: remember where we are
    const settle = () => {
      const loc = measure()
      if (!loc) return null
      atBottomRef.current = loc.isAtBottom || followRef.current
      lastScrollTopRef.current = scrollerRef.current.scrollTop
      publish(loc)
      recordAnchor()
      reportVisible()
      return loc
    }

    const scrollTo = (top, behavior) => {
      const el = scrollerRef.current
      if (behavior === 'smooth' && typeof el.scrollTo === 'function') {
        el.scrollTo({ top, behavior: 'smooth' })
      } else {
        el.scrollTop = top
      }
    }

    const scrollToBottom = (behavior = 'auto') => {
      const el = scrollerRef.current
      if (!el) return
      const top = Math.max(0, el.scrollHeight - el.clientHeight)
      followRef.current = behavior === 'smooth' && el.scrollTop < top - BOTTOM_THRESHOLD
      scrollTo(top, behavior)
      atBottomRef.current = true
    }

    const scrollToItem = ({ index, align = 'start', behavior = 'auto' } = {}) => {
      if (dirtyRef.current) {
        // Not drawn yet: do it right after drawing
        pendingScrollRef.current = { location: { index, align, behavior } }
        return
      }
      const scroller = scrollerRef.current
      const data = dataRef.current
      if (!scroller || data.length === 0) return
      const last = data.length - 1
      const target = index === 'LAST' ? last : index
      if (typeof target !== 'number' || target < 0 || target > last) return
      const row = rowsOf(contentRef.current).find(r => Number(r.dataset.itemIndex) === target)
      if (!row) return
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const rect = row.getBoundingClientRect()
      const itemTop = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop
      let top
      if (align === 'end') {
        top = target === last ? maxTop : itemTop + rect.height - scroller.clientHeight
      } else if (align === 'center') {
        top = itemTop - (scroller.clientHeight - rect.height) / 2
      } else {
        // 'start' and 'start-no-overflow'
        top = itemTop
      }
      top = Math.min(Math.max(0, top), maxTop)
      const toBottom = top >= maxTop - BOTTOM_THRESHOLD
      followRef.current = toBottom && behavior === 'smooth'
      scrollTo(top, behavior)
      if (behavior !== 'smooth') settle()
      else atBottomRef.current = toBottom
    }

    const commit = (next, kind, scroll) => {
      dataRef.current = next
      dirtyRef.current = true
      // An append that must keep its place wins over other changes in the same batch
      mutationRef.current = mutationRef.current === 'append-keep' ? 'append-keep' : kind
      if (scroll) pendingScrollRef.current = scroll
      setVersion(v => v + 1)
    }

    const data = {
      get: () => dataRef.current,
      find: fn => dataRef.current.find(fn),
      findIndex: fn => dataRef.current.findIndex(fn),
      map: fn => {
        const current = dataRef.current
        const next = current.map(fn)
        if (next.some((item, i) => item !== current[i])) commit(next, 'map')
      },
      append: (items, scrollToEnd) => {
        if (!items || items.length === 0) return
        const loc = measure()
        const atBottom = loc ? loc.isAtBottom : true
        const answer = typeof scrollToEnd === 'function'
          ? scrollToEnd({ atBottom, scrollInProgress: followRef.current, context: propsRef.current.context })
          : scrollToEnd
        let scroll = null
        if (answer && typeof answer === 'object') scroll = { location: answer }
        else if (answer) scroll = { bottom: answer === 'smooth' ? 'smooth' : 'auto' }
        commit([...dataRef.current, ...items], scroll ? 'append' : 'append-keep', scroll)
      },
      prepend: items => {
        if (!items || items.length === 0) return
        commit([...items, ...dataRef.current], 'prepend')
      },
      replace: (items, options = {}) => {
        const next = items || []
        const location = options.initialLocation
        commit(next, 'replace', next.length > 0 && location && location.index != null ? { location } : null)
        visibleSigRef.current = null
      },
      findAndDelete: fn => {
        const current = dataRef.current
        const next = current.filter(item => !fn(item))
        if (next.length !== current.length) commit(next, 'delete')
      }
    }

    return {
      data,
      scrollToItem,
      getScrollLocation: () => measure() || locationStore.get(),
      scrollerElement: () => scrollerRef.current,
      // used inside this file only
      _internal: { measure, settle, restoreAnchor, scrollToBottom, publish, reportVisible }
    }
  }, [locationStore])

  useImperativeHandle(ref, () => api, [api])

  const contextValue = useMemo(() => ({
    locationStore,
    methods: { scrollToItem: api.scrollToItem, getScrollLocation: api.getScrollLocation }
  }), [locationStore, api])

  // After each drawing that changed the data or asked for a scroll
  useLayoutEffect(() => {
    if (!dirtyRef.current && !pendingScrollRef.current) return
    const { settle, restoreAnchor, scrollToBottom } = api._internal
    const mutation = mutationRef.current
    mutationRef.current = null
    dirtyRef.current = false
    const pending = pendingScrollRef.current
    pendingScrollRef.current = null

    if (pending?.location) {
      api.scrollToItem(pending.location)
    } else if (pending?.bottom) {
      scrollToBottom(pending.bottom)
    } else if (mutation === 'append-keep') {
      restoreAnchor()
    } else if (atBottomRef.current) {
      scrollToBottom('auto')
    } else {
      restoreAnchor()
    }
    const loc = settle()
    // Nothing to scroll: still tell the room, so it can load more if there is more
    if (loc && loc.scrollHeight <= loc.visibleListHeight) propsRef.current.onScroll?.(loc)
  })

  // Pictures loading, a message growing, the pane getting smaller
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content || typeof ResizeObserver === 'undefined') return
    const { settle, restoreAnchor, scrollToBottom } = api._internal
    const observer = new ResizeObserver(() => {
      if (dirtyRef.current) return
      if (atBottomRef.current) scrollToBottom('auto')
      else restoreAnchor()
      settle()
    })
    observer.observe(scroller)
    observer.observe(content)
    return () => observer.disconnect()
  }, [api])

  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const loc = api._internal.measure()
    if (followRef.current) {
      // Arrived, or the reader scrolled up while we were scrolling down
      if (loc.isAtBottom || el.scrollTop < lastScrollTopRef.current - 1) followRef.current = false
    }
    api._internal.settle()
    propsRef.current.onScroll?.(loc)
  }

  const items = dataRef.current

  return (
    <ListContext.Provider value={contextValue}>
      <div
        data-testid='agora-message-list'
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}
      >
        <div
          ref={scrollerRef}
          data-agora-chat-scroller=''
          className={className}
          onScroll={handleScroll}
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            overflowAnchor: 'none',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative'
          }}
        >
          {Header && <Header context={context} />}
          {/* margin-top auto: a short room sits at the bottom, by the composer */}
          <div ref={contentRef} style={{ marginTop: 'auto' }}>
            {items.length === 0 && EmptyPlaceholder && <EmptyPlaceholder context={context} />}
            {items.map((item, index) => {
              const itemKey = keyFor(item, index)
              return (
                <Row
                  key={itemKey}
                  itemKey={itemKey}
                  ItemContent={ItemContent}
                  item={item}
                  prevItem={items[index - 1]}
                  nextItem={items[index + 1]}
                  index={index}
                  context={context}
                />
              )
            })}
            {Footer && <Footer context={context} />}
          </div>
        </div>
        {StickyFooter && <StickyFooter context={context} />}
      </div>
    </ListContext.Provider>
  )
})

export default AgoraMessageList
