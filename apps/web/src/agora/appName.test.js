import { APP_NAME, agoraTitle } from './appName'

describe('agoraTitle', () => {
  it('ends every title in Agora', () => {
    expect(APP_NAME).toBe('Agora')
    expect(agoraTitle('Chat', 'Governance')).toBe('Chat | Governance | Agora')
  })

  it('leaves out empty parts', () => {
    expect(agoraTitle('Chat', undefined, '')).toBe('Chat | Agora')
    expect(agoraTitle()).toBe('Agora')
  })
})
