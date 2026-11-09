// Agora: the three notification choices for a room, kept on the member's own
// membership of the room (Hylo's postNotifications setting: all, important, none).
export const ROOM_NOTIFICATION_CHOICES = [
  { value: 'all', labelKey: 'agoraRooms.all', helpKey: 'agoraRooms.allHelp' },
  { value: 'important', labelKey: 'agoraRooms.mentions', helpKey: 'agoraRooms.mentionsHelp' },
  { value: 'none', labelKey: 'agoraRooms.muted', helpKey: 'agoraRooms.mutedHelp' }
]

/** Hylo treats a missing setting as "all". */
export function roomNotificationChoice (membership) {
  const value = membership?.settings?.postNotifications
  return value === 'important' || value === 'none' ? value : 'all'
}

/** A muted room shows its unread count quietly (no bold badge). */
export function isRoomMuted (membership) {
  return roomNotificationChoice(membership) === 'none'
}

/** The description is stored as text, but older ones may hold simple HTML. */
export function plainDescription (description) {
  return (description || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}
