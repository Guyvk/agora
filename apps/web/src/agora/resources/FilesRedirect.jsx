/**
 * Agora: the old Files address (/groups/<circle>/files) now leads to the
 * Resources page, keeping the query (for example ?folder=<id>), so saved
 * links and bookmarks still work.
 */
import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'

export default function FilesRedirect () {
  const { search } = useLocation()
  return <Navigate to={`../resources${search}`} replace relative='path' />
}
