/**
 * Agora: open the Help window from anywhere, on a given view.
 *
 *   openHelp()                                    the Guide, the first view
 *   openHelp({ view: 'guide', part: 'events' })   one part of the guide (its id in guideParts.json)
 *   openHelp({ view: 'new' })                     the form, or the chat with Claude
 *   openHelp({ view: 'mine' })                    My requests
 *
 * It sends a browser event that HelpWindow.jsx listens for, so a page needs
 * nothing else. Help shows only for people who are logged in.
 */
export const OPEN_HELP_EVENT = 'agora:open-help'

export function openHelp ({ view = 'guide', part = null } = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new window.CustomEvent(OPEN_HELP_EVENT, { detail: { view, part } }))
}
