// Agora: the name people see in the browser tab, in shared links and on the
// home screen. One place, so no page says Hylo by mistake.
export const APP_NAME = 'Agora'
export const DEMO_APP_NAME = 'Agora Demo'

// Builds a tab title from its parts, ending in the app name:
// agoraTitle('Chat', 'Governance') gives 'Chat | Governance | Agora'.
// Empty parts are left out.
export function agoraTitle (...parts) {
  return [...parts.filter(Boolean), APP_NAME].join(' | ')
}
