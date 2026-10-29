import React from 'react'

/** Agora: the 7BP mark in white, for the accent coloured tiles and bands. */
export default function MainCircleMark ({ className = 'h-8' }) {
  return (
    <span
      aria-hidden='true'
      className={`inline-block bg-white aspect-[324/396] ${className}`}
      style={{
        WebkitMask: 'url(/agora-7bp-logo.png) center / contain no-repeat',
        mask: 'url(/agora-7bp-logo.png) center / contain no-repeat'
      }}
    />
  )
}
