import { get } from 'lodash/fp'
import { AnalyticsEvents } from '@hylo/shared'

export const MODULE_NAME = 'Signup'
export const REGISTER = `${MODULE_NAME}/REGISTER`
export const SEND_EMAIL_VERIFICATION = `${MODULE_NAME}/SEND_EMAIL_VERIFICATION`
export const VERIFY_EMAIL = `${MODULE_NAME}/VERIFY_EMAIL`
export const CHECK_REGISTRATION_STATUS = `${MODULE_NAME}/CHECK_REGISTRATION_STATUS`

// Agora: invitation is { invitationToken } or { accessCode }, the invitation a new person signs up with
export function sendEmailVerification (email, invitation) {
  return {
    type: SEND_EMAIL_VERIFICATION,
    graphql: {
      query: `
        mutation SendEmailVerification ($email: String!, $invitationToken: String, $accessCode: String) {
          sendEmailVerification(email: $email, invitationToken: $invitationToken, accessCode: $accessCode) {
            success
            error
          }
        }
      `,
      variables: {
        email,
        invitationToken: invitation?.invitationToken,
        accessCode: invitation?.accessCode
      }
    },
    meta: {
      extractModel: [
        {
          getRoot: get('sendEmailVerification.me'),
          modelName: 'Me'
        }
      ],
      analytics: {
        eventName: AnalyticsEvents.SIGNUP_EMAIL_VERIFICATION_SENT,
        email
      }
    }
  }
}

export function verifyEmail (email, code, token) {
  return {
    type: VERIFY_EMAIL,
    graphql: {
      query: `
        mutation ($email: String!, $code: String, $token: String) {
          verifyEmail(email: $email, code: $code, token: $token) {
            me {
              id
              email
              emailValidated
              hasRegistered
              name
              settings {
                alreadySeenTour
                toursSeen
                colorScheme
                dmNotifications
                commentNotifications
                locale
                globalNavStyle
                groupNavStyle
                signupInProgress
                stackGroups
                streamChildPosts
                streamViewMode
                streamSortBy
                streamPostType
                theme
              }
            }
            error
          }
        }
      `,
      variables: {
        code,
        email,
        token
      }
    },
    meta: {
      extractModel: [
        {
          getRoot: get('verifyEmail.me'),
          modelName: 'Me'
        }
      ],
      analytics: {
        eventName: AnalyticsEvents.SIGNUP_EMAIL_VERIFIED,
        email
      }
    }
  }
}

export function register (name, password) {
  return {
    type: REGISTER,
    graphql: {
      query: `
        mutation Register ($name: String!, $password: String!) {
          register(name: $name, password: $password) {
            me {
              id
              email
              emailValidated
              hasRegistered
              name
              settings {
                alreadySeenTour
                toursSeen
                colorScheme
                dmNotifications
                commentNotifications
                signupInProgress
                locale
                globalNavStyle
                groupNavStyle
                stackGroups
                streamChildPosts
                streamViewMode
                streamSortBy
                streamPostType
                theme
              }
            }
          }
        }
      `,
      variables: {
        name,
        password
      }
    },
    meta: {
      extractModel: [
        {
          getRoot: get('register.me'),
          modelName: 'Me'
        }
      ],
      analytics: {
        eventName: AnalyticsEvents.SIGNUP_REGISTERED
      }
    }
  }
}
