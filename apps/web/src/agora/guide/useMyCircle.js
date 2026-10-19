/**
 * Agora: the circle a person most likely means by "my circle": the circle
 * (not a space inside one) they opened last, or else the first one they are
 * in. `opened` says whether they have opened any circle yet. Null for
 * someone who is in no circle yet.
 */
import { useSelector } from 'react-redux'
import getMyMemberships from 'store/selectors/getMyMemberships'

export function pickMyCircle (memberships) {
  const circles = (memberships || [])
    .map(m => ({ group: m.group, lastViewedAt: m.lastViewedAt }))
    .filter(m => m.group && m.group.slug && m.group.type !== 'space')
  if (circles.length === 0) return null
  const viewed = circles.filter(m => m.lastViewedAt)
    .sort((a, b) => new Date(b.lastViewedAt).getTime() - new Date(a.lastViewedAt).getTime())
  const pick = (viewed[0] || circles[0]).group
  return { slug: pick.slug, name: pick.name, opened: viewed.length > 0 }
}

export default function useMyCircle () {
  const memberships = useSelector(getMyMemberships)
  return pickMyCircle(memberships)
}
