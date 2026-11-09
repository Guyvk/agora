import { projectFullPageUrl } from './projectFullPage'

describe('projectFullPageUrl', () => {
  it('drops the stream view and keeps the circle', () => {
    expect(projectFullPageUrl({ pathname: '/groups/7bp/projects/post/12' }, '12')).toEqual('/groups/7bp/post/12')
    expect(projectFullPageUrl({ pathname: '/groups/7bp/stream/post/12/' }, '12')).toEqual('/groups/7bp/post/12')
  })

  it('keeps the space', () => {
    expect(projectFullPageUrl({ pathname: '/groups/7bp/spaces/gov/all/post/12' }, '12')).toEqual('/groups/7bp/spaces/gov/post/12')
  })

  it('keeps a comment, the query string and the hash', () => {
    expect(projectFullPageUrl({ pathname: '/groups/7bp/all/post/12/comments/5', search: '?x=1', hash: '#c' }, '12'))
      .toEqual('/groups/7bp/post/12/comments/5?x=1#c')
  })

  it('uses the plain post page outside a circle', () => {
    expect(projectFullPageUrl({ pathname: '/search/post/12' }, '12')).toEqual('/post/12')
  })
})
