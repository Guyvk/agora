import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import { useLocation, useNavigate, Navigate, useParams } from 'react-router-dom'
import { every, isEmpty } from 'lodash/fp'
import { baseUrl, groupUrl, localSpaceSlug, spaceUrl } from '@hylo/navigation'
import setReturnToPath from 'store/actions/setReturnToPath'
import getQuerystringParam from 'store/selectors/getQuerystringParam'
import getMyMemberships from 'store/selectors/getMyMemberships'
import { getSignupComplete } from 'store/selectors/getSignupState'
import checkInvitation from 'store/actions/checkInvitation'
import joinSpace from 'store/actions/joinSpace'
import { joinGroup } from 'routes/GroupDetail/GroupDetail.store' // Agora: join straight from the link
import fetchGroupDetails from 'store/actions/fetchGroupDetails' // Agora: look for agreements and join questions first
import Loading from 'components/Loading'
import getMe from 'store/selectors/getMe'
import { isInvitationForOtherAccount } from '@/agora/signup'
import AgoraInvitationForOtherAccount from '@/agora/AgoraInvitationForOtherAccount'

export const SIGNUP_PATH = '/signup'

/**
 * Build the redirect URL for the group about page with invitation params
 * @param groupSlug {string} the group slug
 * @param accessCode {string|null} the access code if present
 * @param invitationToken {string|null} the invitation token if present
 * @returns {string} the redirect URL with query params
 */
function buildAboutRedirectUrl (groupSlug, accessCode, invitationToken) {
  const baseRedirectUrl = groupUrl(groupSlug, 'about')
  const params = new URLSearchParams()

  if (accessCode) {
    params.set('accessCode', accessCode)
  } else if (invitationToken) {
    params.set('token', invitationToken)
  }

  const queryString = params.toString()
  return queryString ? `${baseRedirectUrl}?${queryString}` : baseRedirectUrl
}

/**
 * Nested space URL so SpaceContent can enter the space (or show SpaceJoinPage
 * if auto-join did not succeed, e.g. a paid space).
 * @param parentGroupSlug {string}
 * @param spaceSlug {string}
 * @returns {string}
 */
function buildSpaceRedirectUrl (parentGroupSlug, spaceSlug) {
  return spaceUrl(parentGroupSlug, localSpaceSlug(parentGroupSlug, spaceSlug))
}

/** Agora: true when the circle has agreements to accept or join questions to answer. */
async function circleNeedsAnswers ({ dispatch, slug, accessCode, invitationToken }) {
  try {
    const result = await dispatch(fetchGroupDetails({ slug, accessCode, invitationToken, withExtensions: false, withTopics: false, withPrerequisites: false }))
    const group = result?.payload?.data?.group ?? result?.payload?.getData?.()?.group
    if (!group) return false
    const count = list => (list?.items ?? list ?? []).length
    const hasAgreements = count(group.agreements) > 0
    const hasQuestions = !!group.settings?.askJoinQuestions && count(group.joinQuestions) > 0
    return hasAgreements || hasQuestions
  } catch (error) {
    return false
  }
}

/**
 * Agora: makes someone who is logged in a member of the circle of the
 * invitation, with the same join as the Join button on the About page (the
 * link is the steward's permission). A space invitation joins the parent
 * circle, and the server then joins the space too. Someone who is already a
 * member is not joined again.
 * Returns where to go (the circle, or the space), or null when it did not work.
 */
export async function joinFromInvitation ({ dispatch, myMemberships = [], groupId, groupSlug, isSpace, parentGroupId, parentGroupSlug, accessCode, invitationToken }) {
  const forSpace = !!(isSpace && parentGroupSlug)
  const joinId = forSpace ? parentGroupId : groupId
  const joinSlug = forSpace ? parentGroupSlug : groupSlug
  const destination = forSpace ? buildSpaceRedirectUrl(parentGroupSlug, groupSlug) : groupUrl(groupSlug)
  if (myMemberships.some(m => m.group?.slug === joinSlug)) return destination
  if (!joinId) return null
  try {
    // Agora: a circle with agreements or join questions shows that step on its About page first.
    // If the circle cannot be read here, join anyway: the welcome window asks them after joining.
    if (await circleNeedsAnswers({ dispatch, slug: joinSlug, accessCode, invitationToken })) return null
    const result = await dispatch(joinGroup(joinId, [], accessCode, invitationToken, false))
    if (result?.error || !(result?.payload?.data?.joinGroup ?? result?.payload?.getData?.())) return null
    return destination
  } catch (error) {
    return null
  }
}

/**
 * JoinGroup route component - validates invitation and redirects.
 * Group invites go to the about page so the user can review and join.
 * Space invites auto-join when the user is already a parent-group member
 * and then open the space. Otherwise they go to the parent group's about page.
 * Agora: someone logged in is joined at once instead (joinFromInvitation) and
 * only sees the about page when that does not work. Someone without an account
 * is joined by the server when their sign-up is finished (backend lib/agora/signup.js).
 */
export default function JoinGroup (props) {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const signupComplete = useSelector(getSignupComplete)
  const myMemberships = useSelector(getMyMemberships)
  const [redirectTo, setRedirectTo] = useState()
  // Agora: an invitation email for another address than the one logged in
  const me = useSelector(getMe)
  const [otherAccount, setOtherAccount] = useState()
  const { t } = useTranslation()
  const routeParams = useParams()
  const location = useLocation()

  useEffect(() => {
    (async function () {
      try {
        const invitationToken = getQuerystringParam('token', location)
        const accessCode = routeParams.accessCode

        if (every(isEmpty, { invitationToken, accessCode })) {
          throw new Error(t('Please provide either a token query string parameter or accessCode route param'))
        }

        // Check if the invitation is valid and get group info
        const result = await dispatch(checkInvitation({ invitationToken, accessCode }))
        const checkResult = result?.payload?.data?.checkInvitation ?? result?.payload?.getData?.()

        if (!checkResult?.valid) {
          throw new Error(t('Invalid invitation'))
        }

        // Agora: do not use an invitation sent to another address; say so instead
        if (isInvitationForOtherAccount({ invitationToken, invitationEmail: checkResult.email, myEmail: me?.email })) {
          setOtherAccount({ invitationToken, invitationEmail: checkResult.email })
          return
        }

        const { groupId, groupSlug, isSpace, parentGroupId, parentGroupSlug } = checkResult

        if (!groupSlug) {
          throw new Error(t('Could not determine group from invitation'))
        }

        const isParentMember = !!(parentGroupSlug && myMemberships.some(m => m.group?.slug === parentGroupSlug))

        if (signupComplete && isSpace && parentGroupSlug && isParentMember) {
          if (groupId) {
            await dispatch(joinSpace(groupId, accessCode, invitationToken)).catch(() => {})
          }
          const spaceDest = buildSpaceRedirectUrl(parentGroupSlug, groupSlug)
          const params = new URLSearchParams()
          if (accessCode) params.set('accessCode', accessCode)
          else if (invitationToken) params.set('token', invitationToken)
          const queryString = params.toString()
          setRedirectTo(queryString ? `${spaceDest}?${queryString}` : spaceDest)
          return
        }

        const destinationSlug = (isSpace && parentGroupSlug && !isParentMember)
          ? parentGroupSlug
          : groupSlug

        if (signupComplete) {
          // Agora: someone logged in who opens a join link or invitation becomes a member
          // right away and lands in the circle (a space invitation joins the parent circle
          // and the space). Agreements and join questions follow in the circle's welcome
          // window. If joining does not work, the About page with its Join button as before.
          const joined = await joinFromInvitation({
            dispatch,
            myMemberships,
            groupId,
            groupSlug,
            isSpace,
            parentGroupId,
            parentGroupSlug,
            accessCode,
            invitationToken
          })
          if (joined) {
            setRedirectTo(joined)
            return
          }
          // Redirect authenticated users to the group about page with invitation params.
          // Space invites for non-parent-members go to the parent group's join page.
          setRedirectTo(buildAboutRedirectUrl(destinationSlug, accessCode, invitationToken))
        } else {
          // Redirect non-authenticated users to signup, then back to group about page
          const returnToUrl = buildAboutRedirectUrl(destinationSlug, accessCode, invitationToken)
          dispatch(setReturnToPath(returnToUrl))
          setRedirectTo(SIGNUP_PATH)
        }
      } catch (error) {
        window.alert(t('Sorry, your invitation to this group is expired, has already been used, or is invalid. Please contact a group Host for another one.'))
        navigate(baseUrl({}))
      }
    })()
  }, [])

  if (otherAccount) {
    return <AgoraInvitationForOtherAccount {...otherAccount} myName={me?.name} myEmail={me?.email} />
  }

  if (redirectTo) return <Navigate to={redirectTo} replace />

  return <><Loading /></>
}
