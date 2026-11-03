import { LOGOUT } from 'store/constants'
import { resetMainCircleCache } from '@/agora/mainCircle/mainCircle' // Agora

export default function logout () {
  resetMainCircleCache() // Agora: never show one person's 7BP circles to the next
  return {
    type: LOGOUT,
    payload: {
      api: { path: '/noo/session', method: 'DELETE' }
    }
  }
}
