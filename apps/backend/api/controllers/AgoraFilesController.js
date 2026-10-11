/**
 * Agora: a circle's Files page, a live view of its Google Drive folder.
 *
 *   /noo/agora/files/<circle>        the page, for anyone logged in to Agora
 *   /noo/agora/files/<circle>/list   what the page shows, as JSON
 *
 * <circle> is the circle's short name from its address in Agora, for example
 * "governance" in /groups/governance. The folder is found by the circle's
 * name, see lib/agora/drive.js.
 */
import fs from 'fs'
import path from 'path'
import Drive from '../../lib/agora/drive'

const PAGE_PATH = path.join(__dirname, '..', '..', 'agora', 'files.html')
let pageTemplate = null

function loadPage () {
  if (!pageTemplate || process.env.NODE_ENV === 'development') {
    pageTemplate = fs.readFileSync(PAGE_PATH, 'utf8')
  }
  return pageTemplate
}

function webUrl (pathname) {
  return `${process.env.PROTOCOL}://${process.env.DOMAIN}${pathname}`
}

async function loadCircle (req, res) {
  const slug = String(req.param('groupSlug') || '')
  const group = /^[a-z0-9-]{1,100}$/i.test(slug) ? await Group.findActive(slug) : null
  if (!group) {
    res.status(404).send({ error: 'This circle does not exist.' })
    return null
  }
  return group
}

module.exports = {
  /**
   * The page itself.
   */
  page: async function (req, res) {
    if (!UserSession.isLoggedIn(req)) {
      return res.redirect(webUrl(`/login?returnToUrl=${encodeURIComponent(req.originalUrl)}`))
    }
    const group = await loadCircle(req, res)
    if (!group) return

    const boot = {
      circleName: group.get('name'),
      circleUrl: webUrl(`/groups/${group.get('slug')}`),
      api: `/noo/agora/files/${group.get('slug')}/list`
    }
    // A function is used so that "$" in a name is not read as a replace pattern.
    const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c')
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.set('Cache-Control', 'no-store')
    return res.send(loadPage().replace('"__AGORA_BOOT__"', () => bootJson))
  },

  /**
   * The files in the circle's folder, or in a folder inside it (?folder=<id>).
   */
  list: async function (req, res) {
    const group = await loadCircle(req, res)
    if (!group) return
    res.set('Cache-Control', 'no-store')

    if (!Drive.isConfigured()) {
      return res.ok({ configured: false })
    }
    try {
      const result = await Drive.circleFiles(group.get('name'), req.param('folder'))
      return res.ok({ configured: true, robotEmail: Drive.robotEmail(), ...result })
    } catch (err) {
      if (err instanceof Drive.DriveError) {
        if (err.code !== 'not_found') sails.log.error(`Agora files: ${err.message}`)
        return res.status(err.code === 'not_found' ? 404 : 502).send({ error: err.message })
      }
      throw err
    }
  }
}
