import { postUrl } from '@hylo/navigation'

// Where a project post opens: its own page inside the app (circle menu and top bar stay),
// not Hylo's pop-up. Keeps the circle (and space) of the current address, drops the stream
// view (/projects, /stream, /chat ...), and keeps anything after the post id (a comment) plus
// the query string and hash. Outside a circle it uses the plain /post/:id page.
export function projectFullPageUrl ({ pathname = '', search = '', hash = '' }, postId) {
  const circle = pathname.match(/^\/groups\/([^/]+)(?:\/spaces\/([^/]+))?(?:\/|$)/)
  const base = circle
    ? postUrl(postId, { context: 'groups', groupSlug: circle[1], spaceSlug: circle[2] })
    : postUrl(postId, { context: '' })
  const rest = pathname.match(/\/post\/\d+(\/.*)?$/)?.[1] || ''
  return `${base}${rest.replace(/\/+$/, '')}${search}${hash}`
}
