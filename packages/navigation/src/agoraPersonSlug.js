/**
 * Agora: readable profile links, /members/5-mariam instead of /members/5.
 *
 * The part after the id is only there for people to read. Whatever follows the
 * id is ignored when the link is opened, so old links (/members/5) and links
 * with an old or wrong name (/members/5-someone-else) still open person 5.
 */

const MAX_SLUG_LENGTH = 40

/**
 * The name part of a profile link: small letters, accents removed, anything
 * that is not a letter or digit turned into one hyphen, at most 40 characters.
 * "Mariam:)" -> "mariam", "José Núñez" -> "jose-nunez". Empty when nothing is left.
 * @param {string} [name]
 * @returns {string}
 */
export function personNameSlug (name) {
  if (!name) return ''
  const slug = String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= MAX_SLUG_LENGTH) return slug
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
}

/**
 * The person part of a profile link: "5-mariam", or just "5" without a usable name.
 * @param {string|number} id
 * @param {string} [name]
 * @returns {string}
 */
export function personPathSegment (id, name) {
  if (id === undefined || id === null || id === '') return ''
  const slug = personNameSlug(name)
  return slug ? `${id}-${slug}` : String(id)
}

/**
 * The person id inside a :personId route parameter: "5-mariam" -> "5", "5" -> "5".
 * Anything that does not start with digits followed by a hyphen or the end is
 * returned unchanged, so callers that check for a valid id still reject it.
 * @param {string} [param]
 * @returns {string|undefined}
 */
export function personIdFromParam (param) {
  if (param === undefined || param === null) return param
  const match = String(param).match(/^(\d+)(?:-|$)/)
  return match ? match[1] : param
}
