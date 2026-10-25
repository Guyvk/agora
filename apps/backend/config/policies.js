/* eslint key-spacing:0 */

/**
 * Policy Mappings
 * (sails.config.policies)
 *
 * Policies are simple functions which run **before** your controllers.
 * You can apply one or more policies to a given controller, or protect
 * its actions individually.
 *
 * Any policy file (e.g. `api/policies/authenticated.js`) can be accessed
 * below by its filename, minus the extension, (e.g. "authenticated")
 *
 * For more information on how policies work, see:
 * http://sailsjs.org/#/documentation/concepts/Policies
 *
 * For more information on configuring policies, check out:
 * http://sailsjs.org/#/documentation/reference/sails.config/sails.config.policies.html
 */

module.exports.policies = {
  '*': false,

  AdminController: {
    '*': 'isAdmin'
  },

  MobileAppController: {
    '*': true
  },

  SessionController: {
    createWithJWT: ['checkJWT'],
    '*': true
  },

  CookieConsentController: {
    '*': true
  },

  UploadController: {
    '*': 'sessionAuth'
  },

  // Agora meetings. The room page sends people to the login page itself.
  MeetingController: {
    room: true,
    '*': 'sessionAuth'
  },

  // Agora: guests in a meeting have no login. Each call checks the guest link's
  // secret and the guest's own secret instead (lib/agora/meetingGuests.js).
  // These are the only actions; there is none to read the notes or end the meeting.
  // The chat and the end screen only show the meeting the guest is in.
  MeetingGuestController: {
    page: true,
    join: true,
    segment: true,
    status: true,
    chat: true,
    summary: true,
    end: true
  },

  // Agora files: for anyone logged in. The page sends people to the login page itself.
  // Adding files also checks that the person is a member of the circle.
  AgoraFilesController: {
    page: true,
    '*': 'sessionAuth'
  },

  // Agora: circle files in kDrive. Every action also checks that the person is
  // an active member of the circle.
  AgoraKdriveController: {
    '*': 'sessionAuth'
  },

  // Agora contacts: for Agora members. The page sends people to the login page itself.
  AgoraContactsController: {
    page: true,
    '*': 'sessionAuth'
  },

  // Agora help: for anyone logged in. Each action checks who may see which request,
  // and the Help desk actions check for a Help desk admin.
  AgoraHelpController: {
    '*': 'sessionAuth'
  },

  // Agora: "This week in 7BP", for anyone logged in. The answer only holds what the person may see.
  AgoraThisWeekController: {
    '*': 'sessionAuth'
  },

  // Agora admin dashboard: for anyone logged in, and each action checks for an Agora admin.
  AgoraAdminController: {
    '*': 'sessionAuth'
  },

  // Agora sign-up: the sign-up page asks whether new accounts need an invitation, before anyone is logged in
  AgoraSignupController: {
    policy: true
  },

  ExportController: {
    '*': 'sessionAuth'
  },

  AdminSessionController: {
    create:  true,
    oauth:   true,
    destroy: true
  },

  CommentController: {
    createFromEmail: true,
    createBatchFromEmailForm: ['checkAndDecodeToken']
  },

  GroupController: {
    subscribe:   ['isSocket', 'sessionAuth', 'checkAndSetMembership'],
    unsubscribe: ['isSocket', 'sessionAuth', 'checkAndSetMembership'],
    typing:      ['isSocket', 'sessionAuth', 'checkAndSetMembership']
  },

  MurmurationsController: {
    group: true
  },

  PostController: {
    updateLastRead:         ['sessionAuth', 'checkAndSetPost'],
    subscribe:              ['isSocket', 'sessionAuth', 'checkAndSetPost'],
    unsubscribe:            ['isSocket', 'sessionAuth', 'checkAndSetPost'],
    typing:                 ['isSocket', 'sessionAuth', 'checkAndSetPost'],
    createFromEmailForm:    ['checkAndDecodeToken']
  },

  UserController: {
    create: ['checkClientCredentials'],
    getNotificationSettings: true,
    updateNotificationSettings: true,

    subscribeToUpdates:     ['isSocket', 'sessionAuth'],
    unsubscribeFromUpdates: ['isSocket', 'sessionAuth']
  },

  PaymentController: {
    registerStripe: ['sessionAuth']
  },

  StripeController: {
    webhook: true,
    checkoutSuccess: true,
    checkoutCancel: true,
    health: true
  }
}
