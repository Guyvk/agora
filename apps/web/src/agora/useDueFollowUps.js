import { useEffect, useState } from 'react'

/**
 * Agora: how many of my contact follow-ups are due today or earlier, for the
 * count on the Contacts button. Asks again every five minutes. Anyone who may
 * not see contacts simply gets 0.
 */
export const CONTACTS_URL = '/noo/agora/contacts'

export default function useDueFollowUps () {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let stopped = false
    async function check () {
      try {
        const res = await fetch(`${CONTACTS_URL}/api/due`, { credentials: 'same-origin' })
        const body = res.ok ? await res.json() : { count: 0 }
        if (!stopped) setCount(Number(body.count) || 0)
      } catch (e) {
        if (!stopped) setCount(0)
      }
    }
    check()
    const timer = setInterval(check, 5 * 60 * 1000)
    return () => { stopped = true; clearInterval(timer) }
  }, [])

  return count
}
