/**
 * Agora: switches for parts of Hylo that Agora does not use for now.
 *
 * Each switch is read in the few Hylo files that need it, next to a comment
 * that starts with "Agora:". Set a switch to true to bring that part back.
 */

/**
 * The Commons: Hylo's public area, with public posts, a public group
 * directory and a public map. Agora has nothing public yet, so the Commons
 * button and tab are hidden, and its pages send people to My Home.
 */
export const showCommons = false

/** True for the Commons pages, /public and everything under it. */
export function isCommonsPath (pathname) {
  return pathname === '/public' || String(pathname).startsWith('/public/')
}
