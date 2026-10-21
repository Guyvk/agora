/* eslint-disable key-spacing */

/**
 * http://sailsjs.org/#/documentation/concepts/Routes/RouteTargetSyntax.html
 */

module.exports.routes = {
  // for OIDC
  // XXX: unclear if its ok to redirect like this, can we somehow directly call the oidc-provider discovery function here?
  'GET    /.well-known/openid-configuration':             '/noo/oauth/.well-known/openid-configuration',

  'POST   /noo/user':                                     'UserController.create',
  'POST   /noo/user/update-notification-settings':        'UserController.updateNotificationSettings',
  'GET    /noo/user/notification-settings':               'UserController.getNotificationSettings',

  'POST   /noo/post/:postId/update-last-read':            'PostController.updateLastRead',

  'GET    /noo/admin/login':                              'AdminSessionController.create',
  'GET    /noo/admin/login/oauth':                        'AdminSessionController.oauth',
  'GET    /noo/admin/logout':                             'AdminSessionController.destroy',
  'GET    /noo/admin/raw-metrics':                        'AdminController.rawMetrics',
  'GET    /noo/admin/stripe-analytics':                   'AdminController.stripeAnalytics',
  'POST   /noo/admin/stripe-sales-pause':                 'AdminController.setStripeSalesPaused',
  'GET    /noo/admin/login-as/:userId':                   'AdminController.loginAsUser',

  'POST   /noo/hook/comment':                             'CommentController.createFromEmail',
  'GET    /noo/hook/postForm':                            'PostController.createFromEmailForm',
  'POST   /noo/hook/postForm':                            'PostController.createFromEmailForm',
  'GET    /noo/hook/batchCommentForm':                    'CommentController.createBatchFromEmailForm',
  'POST   /noo/hook/batchCommentForm':                    'CommentController.createBatchFromEmailForm',

  'POST   /noo/login':                                    'SessionController.create',
  'POST   /noo/login/native':                             'SessionController.nativeLogin',
  'POST   /noo/session/from-token':                       'SessionController.fromToken',
  'GET    /noo/login/token':                              'SessionController.createWithToken',
  'POST   /noo/login/token':                              'SessionController.createWithToken',
  'GET    /noo/login/jwt':                                'SessionController.createWithJWT',
  'POST   /noo/login/jwt':                                'SessionController.createWithJWT',
  'POST   /noo/login/apple/oauth':                        'SessionController.finishAppleOAuth',
  'GET    /noo/login/google':                             'SessionController.startGoogleOAuth',
  'GET    /noo/login/google/oauth':                       'SessionController.finishGoogleOAuth',
  'GET    /noo/login/facebook':                           'SessionController.startFacebookOAuth',
  'GET    /noo/login/facebook/oauth':                     'SessionController.finishFacebookOAuth',
  'GET    /noo/login/linkedin':                           'SessionController.startLinkedinOAuth',
  'GET    /noo/login/linkedin/oauth':                     'SessionController.finishLinkedinOAuth',
  'GET    /noo/login/facebook-token/oauth':               'SessionController.finishFacebookTokenOAuth',
  'POST   /noo/login/facebook-token/oauth':               'SessionController.finishFacebookTokenOAuth',
  'GET    /noo/login/google-token/oauth':                 'SessionController.finishGoogleTokenOAuth',
  'POST   /noo/login/google-token/oauth':                 'SessionController.finishGoogleTokenOAuth',
  'GET    /noo/login/linkedin-token/oauth':               'SessionController.finishLinkedinTokenOAuth',
  'POST   /noo/login/linkedin-token/oauth':               'SessionController.finishLinkedinTokenOAuth',
  'GET    /noo/logout':                                   'SessionController.destroy',
  'DELETE /noo/session':                                  'SessionController.destroySession',

  // TODO: dont exist right now
  // 'POST   /noo/access-token':                             'AccessTokenController.create',
  // 'DELETE /noo/access-token/revoke':                      'AccessTokenController.destroy',

  'POST   /noo/cookie-consent':                           'CookieConsentController.upsert',

  'GET     /noo/mobile/check-should-update':              'MobileAppController.checkShouldUpdate',
  'GET     /noo/mobile/auto-update-info':                 'MobileAppController.updateInfo',
  'POST    /noo/mobile/logerror':                         'MobileAppController.logError',

  'GET     /noo/payment/registerStripe':                  'PaymentController.registerStripe',
  'POST    /noo/payment/registerStripe':                  'PaymentController.registerStripe',

  // Stripe Connect routes
  'GET     /noo/stripe/health':                          'StripeController.health',
  'GET     /noo/stripe/checkout/success':                'StripeController.checkoutSuccess',
  'GET     /noo/stripe/checkout/cancel':                 'StripeController.checkoutCancel',
  'POST    /noo/stripe/webhook':                         'StripeController.webhook',

  // websockets routes
  'POST   /noo/user/subscribe':                           'UserController.subscribeToUpdates',
  'POST   /noo/user/unsubscribe':                         'UserController.unsubscribeFromUpdates',
  'POST   /noo/group/:groupId/subscribe':                 'GroupController.subscribe',
  'POST   /noo/group/:groupId/unsubscribe':               'GroupController.unsubscribe',
  'POST   /noo/group/:groupId/typing':                    'GroupController.typing',
  'POST   /noo/post/:postId/subscribe':                   'PostController.subscribe', // to comments
  'POST   /noo/post/:postId/unsubscribe':                 'PostController.unsubscribe', // from comments
  'POST   /noo/post/:postId/typing':                      'PostController.typing',

  'GET    /noo/group/:groupSlug/murmurations':            'MurmurationsController.group',

  'POST   /noo/upload':                                   'UploadController.create',

  // Agora meetings: the room page, and the calls it makes
  'GET    /noo/meeting/:postId/room':                     'MeetingController.room',
  'POST   /noo/meeting/:postId/join':                     'MeetingController.join',
  'POST   /noo/meeting/:postId/segment':                  'MeetingController.segment',
  'GET    /noo/meeting/:postId/transcript':               'MeetingController.transcript',
  'POST   /noo/meeting/:postId/end':                      'MeetingController.end',
  // Agora: guest links. Making and closing one is for members (MeetingController);
  // the guest's own room and calls need no login (MeetingGuestController)
  'GET    /noo/meeting/:postId/guest-link':               'MeetingController.guestLink',
  'POST   /noo/meeting/:postId/guest-link':               'MeetingController.createGuestLink',
  'POST   /noo/meeting/:postId/guest-link/revoke':        'MeetingController.revokeGuestLink',
  'GET    /noo/meeting/:postId/guest/:token':             'MeetingGuestController.page',
  'POST   /noo/meeting/:postId/guest/:token/join':        'MeetingGuestController.join',
  'POST   /noo/meeting/:postId/guest/:token/segment':     'MeetingGuestController.segment',
  'GET    /noo/meeting/:postId/guest/:token/status':      'MeetingGuestController.status',
  'POST   /noo/meeting/:postId/guest/:token/end':         'MeetingGuestController.end',

  // Agora files: a circle's Google Drive folder. Members may add files and folders
  'GET    /noo/agora/files/:groupSlug':                   'AgoraFilesController.page',
  'GET    /noo/agora/files/:groupSlug/list':              'AgoraFilesController.list',
  'POST   /noo/agora/files/:groupSlug/upload-session':    'AgoraFilesController.startUpload',
  'POST   /noo/agora/files/:groupSlug/uploaded':          'AgoraFilesController.uploaded',
  'POST   /noo/agora/files/:groupSlug/upload':            'AgoraFilesController.upload',
  'POST   /noo/agora/files/:groupSlug/folder':            'AgoraFilesController.createFolder',
  'POST   /noo/agora/files/:groupSlug/my-folder':         'AgoraFilesController.myFolder',

  // Agora contacts: one shared list of people and organisations outside Agora
  'GET    /noo/agora/contacts':                           'AgoraContactsController.page',
  'GET    /noo/agora/contacts/api/list':                  'AgoraContactsController.list',
  'GET    /noo/agora/contacts/api/meta':                  'AgoraContactsController.meta',
  'GET    /noo/agora/contacts/api/due':                   'AgoraContactsController.dueCount',
  'POST   /noo/agora/contacts/api/create':                'AgoraContactsController.create',
  'GET    /noo/agora/contacts/api/:contactId':            'AgoraContactsController.show',
  'POST   /noo/agora/contacts/api/:contactId/update':     'AgoraContactsController.update',
  'POST   /noo/agora/contacts/api/:contactId/notes':      'AgoraContactsController.addNote',
  'POST   /noo/agora/contacts/api/:contactId/delete':     'AgoraContactsController.destroy',

  // Agora sign-up: whether new accounts need an invitation
  'GET    /noo/agora/signup':                             'AgoraSignupController.policy',

  // Agora help: the Help window for everyone logged in, the Help desk for its admins
  'GET    /noo/agora/help/api/status':                    'AgoraHelpController.status',
  'GET    /noo/agora/help/api/mine':                      'AgoraHelpController.mine',
  'POST   /noo/agora/help/api/create':                    'AgoraHelpController.create',
  'POST   /noo/agora/help/api/chat':                      'AgoraHelpController.chat',
  'GET    /noo/agora/help/api/mine/:requestId':           'AgoraHelpController.showMine',
  'POST   /noo/agora/help/api/mine/:requestId/reply':     'AgoraHelpController.replyMine',
  'GET    /noo/agora/help/api/desk':                      'AgoraHelpController.deskList',
  'GET    /noo/agora/help/api/desk/:requestId':           'AgoraHelpController.deskShow',
  'POST   /noo/agora/help/api/desk/:requestId/update':    'AgoraHelpController.deskUpdate',
  'POST   /noo/agora/help/api/desk/:requestId/reply':     'AgoraHelpController.deskReply',
  'POST   /noo/agora/help/api/desk/:requestId/build':     'AgoraHelpController.deskBuild',

  // Agora admin dashboard (/admin in the web app): for Agora admins only, each action checks
  'GET    /noo/agora/admin/api/me':                       'AgoraAdminController.me',
  'GET    /noo/agora/admin/api/overview':                 'AgoraAdminController.overview',
  'GET    /noo/agora/admin/api/invitations':              'AgoraAdminController.invitations',
  'POST   /noo/agora/admin/api/invitations/:invitationId/resend': 'AgoraAdminController.resendInvitation',
  'POST   /noo/agora/admin/api/invitations/:invitationId/revoke': 'AgoraAdminController.revokeInvitation',
  'GET    /noo/agora/admin/api/joins':                    'AgoraAdminController.joins',
  'GET    /noo/agora/admin/api/accounts':                 'AgoraAdminController.accounts',
  'POST   /noo/agora/admin/api/accounts/let-in':          'AgoraAdminController.letIn',
  'POST   /noo/agora/admin/api/accounts/:accountId/deactivate': 'AgoraAdminController.deactivate',
  'POST   /noo/agora/admin/api/accounts/:accountId/reactivate': 'AgoraAdminController.reactivate',
  'POST   /noo/agora/admin/api/accounts/:accountId/role':  'AgoraAdminController.setRole', // Agora: change someone's Agora role
  'GET    /noo/agora/admin/api/system':                   'AgoraAdminController.system',
  'GET    /noo/agora/admin/api/activity':                 'AgoraAdminController.activity',

  'GET    /noo/export/group':                             'ExportController.groupData',
  'POST   /noo/export/user-account':                      'ExportController.userAccountData'
}
