/**
 * Agora: remember small things per person, such as "closed the welcome steps"
 * or "opened the guide".
 *
 * This uses Hylo's own `toursSeen` user setting, a list of names that Hylo
 * keeps for its guided tours. It is stored with the account, so it follows a
 * person to every device, and it needs no change to the server. Agora's names
 * all start with "agora-", so they never clash with Hylo's tours.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import getMe from 'store/selectors/getMe'
import updateUserSettings from 'store/actions/updateUserSettings'

export const WELCOME_DISMISSED = 'agora-welcome-dismissed'
export const GUIDE_READ = 'agora-guide-read'
export const SAID_HI = 'agora-said-hi'

export default function useAgoraSeen () {
  const dispatch = useDispatch()
  const me = useSelector(getMe)
  const seen = (me && me.settings && me.settings.toursSeen) || []

  // Read through a ref, so two marks in a row both land in the list
  const seenRef = useRef(seen)
  useEffect(() => { seenRef.current = seen }, [seen])

  const hasSeen = useCallback(name => seen.includes(name), [seen])

  const markSeen = useCallback(name => {
    const now = seenRef.current
    if (!me || now.includes(name)) return
    const next = [...now, name]
    seenRef.current = next
    dispatch(updateUserSettings({ settings: { toursSeen: next } }))
  }, [dispatch, me])

  return { me, hasSeen, markSeen }
}
