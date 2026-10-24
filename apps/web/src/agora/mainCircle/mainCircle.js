/**
 * Agora: the 7BP Home (main circle) as the web sees it. The server says which
 * circle is the main one and which circles are ACTIVE children of it
 * (apps/backend/lib/agora/mainCircle.js); a circle taken out of the main
 * circle on purpose is not in that list, so it is treated like any other.
 */
import { useEffect, useState } from 'react'

const GRAPHQL = '/noo/graphql'
const MAX_AGE_MS = 60 * 1000

export const MAIN_CIRCLE_QUERY = `query AgoraMainCircle {
  agoraMainCircle { id slug name avatarUrl circles { id slug name avatarUrl memberCount } }
}`

// The accent colour of the 7BP Home, as Tailwind classes (light and dark)
export const ACCENT_BG = 'bg-[hsl(190_90%_36%)] dark:bg-[hsl(190_80%_46%)]'
export const ACCENT_RING = 'ring-[hsl(190_90%_36%)] dark:ring-[hsl(190_80%_46%)]'
export const ACCENT_TEXT = 'text-[hsl(190_90%_30%)] dark:text-[hsl(190_80%_60%)]'
export const ACCENT_LINE = 'bg-[hsl(190_90%_36%)]/60 dark:bg-[hsl(190_80%_46%)]/60'

let cache = null // { at, data }
let inflight = null

export function resetMainCircleCache () {
  cache = null
  inflight = null
}

async function load () {
  try {
    const res = await fetch(GRAPHQL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: MAIN_CIRCLE_QUERY })
    })
    const body = await res.json()
    return (body && body.data && body.data.agoraMainCircle) || null
  } catch (err) {
    return null
  }
}

/** The main circle { id, slug, name, avatarUrl, circles } or null (none, or not a member). */
export default function useMainCircle () {
  const [data, setData] = useState(cache ? cache.data : null)
  useEffect(() => {
    let cancelled = false
    if (cache && Date.now() - cache.at < MAX_AGE_MS) {
      setData(cache.data)
      return undefined
    }
    if (!inflight) {
      inflight = load().then(result => {
        cache = { at: Date.now(), data: result }
        inflight = null
        return result
      })
    }
    inflight.then(result => { if (!cancelled) setData(result) })
    return () => { cancelled = true }
  }, [])
  return data
}

export function isMainCircleGroup (mainCircle, group) {
  return Boolean(mainCircle && group && group.slug === mainCircle.slug)
}

export function isActiveChildOfMain (mainCircle, group) {
  return Boolean(mainCircle && group && (mainCircle.circles || []).some(c => c.slug === group.slug))
}

/**
 * Splits the person's circles for the left bar: the main circle first, then
 * the active children of it, then every other circle (including a circle
 * that is switched off as a child). Order inside each part is kept as given.
 */
export function arrangeNavGroups (groups, mainCircle) {
  if (!mainCircle) return { main: null, children: [], others: groups }
  const main = groups.find(g => isMainCircleGroup(mainCircle, g)) || null
  const children = []
  const others = []
  for (const g of groups) {
    if (g === main) continue
    if (isActiveChildOfMain(mainCircle, g)) children.push(g)
    else others.push(g)
  }
  return { main, children, others }
}
