// Agora: live reply counters under chat messages (see apps/backend/lib/agora/chatThreads.js)
export const RECEIVE_CHAT_THREAD_UPDATE = 'Agora/RECEIVE_CHAT_THREAD_UPDATE'

/** The server says a chat message got a new reply: new count, who replied, when. */
export function receiveChatThreadUpdate (data) {
  return { type: RECEIVE_CHAT_THREAD_UPDATE, payload: data }
}
