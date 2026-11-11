const { env } = require('../../config/env');

function ref(name) {
  return { $ref: `#/components/${name}` };
}

function jsonBody(schema, required = true) {
  return {
    required,
    content: {
      'application/json': { schema }
    }
  };
}

function successResponse(description = 'Success') {
  return {
    description,
    content: {
      'application/json': {
        schema: ref('schemas/ApiSuccessResponse')
      }
    }
  };
}

function stdResponses(overrides = null) {
  const errors = {
    400: ref('responses/BadRequest'),
    401: ref('responses/Unauthorized'),
    403: ref('responses/Forbidden'),
    404: ref('responses/NotFound'),
    409: ref('responses/Conflict'),
    429: ref('responses/TooManyRequests'),
    500: ref('responses/InternalError')
  };

  if (!overrides) {
    return { 200: successResponse(), ...errors };
  }

  const success = {};
  const other = {};

  for (const [key, value] of Object.entries(overrides)) {
    const code = Number(key);
    if (Number.isInteger(code) && code >= 200 && code < 300) {
      success[key] = value;
    } else {
      other[key] = value;
    }
  }

  if (Object.keys(success).length === 0) {
    success[200] = successResponse();
  }

  return { ...success, ...errors, ...other };
}

function op(method, path, options) {
  return { method, path, ...options };
}

function buildPaths(includeDev) {
  const routes = [
    // Root
    op('get', '/', {
      tags: ['General'],
      summary: 'API service info',
      security: [],
      responses: stdResponses()
    }),

    // Health
    op('get', '/api/v1/health', { tags: ['Health'], summary: 'Health check', security: [], responses: stdResponses() }),
    op('get', '/api/v1/health/db', { tags: ['Health'], summary: 'Database health check', security: [], responses: stdResponses() }),

    // Auth
    op('post', '/api/v1/auth/register', {
      tags: ['Auth'],
      summary: 'Register a new user',
      security: [],
      requestBody: jsonBody(ref('schemas/RegisterRequest')),
      responses: stdResponses({ 201: successResponse('User registered') })
    }),
    op('post', '/api/v1/auth/login', {
      tags: ['Auth'],
      summary: 'Login with email and password',
      security: [],
      requestBody: jsonBody(ref('schemas/LoginRequest')),
      responses: stdResponses()
    }),
    op('post', '/api/v1/auth/child-login', {
      tags: ['Auth'],
      summary: 'Child login with username/email and PIN',
      security: [],
      requestBody: jsonBody(ref('schemas/ChildLoginRequest')),
      responses: stdResponses()
    }),
    op('post', '/api/v1/auth/refresh', { tags: ['Auth'], summary: 'Refresh access token', security: [], responses: stdResponses() }),
    op('post', '/api/v1/auth/logout', { tags: ['Auth'], summary: 'Logout and invalidate session', security: [], responses: stdResponses() }),
    op('get', '/api/v1/auth/me', { tags: ['Auth'], summary: 'Get current authenticated user', responses: stdResponses() }),
    op('patch', '/api/v1/auth/password', {
      tags: ['Auth'],
      summary: 'Change password',
      requestBody: jsonBody(ref('schemas/ChangePasswordRequest')),
      responses: stdResponses()
    }),
    op('get', '/api/v1/auth/google', { tags: ['Auth'], summary: 'Start Google OAuth flow', security: [], responses: stdResponses() }),
    op('get', '/api/v1/auth/google/callback', { tags: ['Auth'], summary: 'Google OAuth callback', security: [], responses: stdResponses() }),
    op('post', '/api/v1/auth/forgot-password', {
      tags: ['Auth'],
      summary: 'Request password reset email',
      security: [],
      requestBody: jsonBody(ref('schemas/ForgotPasswordRequest')),
      responses: stdResponses()
    }),
    op('post', '/api/v1/auth/reset-password', {
      tags: ['Auth'],
      summary: 'Reset password with token',
      security: [],
      requestBody: jsonBody(ref('schemas/ResetPasswordRequest')),
      responses: stdResponses()
    }),

    // Dashboard
    op('get', '/api/v1/dashboard/data', {
      tags: ['Dashboard'],
      summary: 'Get aggregated dashboard data',
      parameters: [ref('parameters/ProfileIdHeader')],
      responses: stdResponses()
    }),

    // Profiles
    op('get', '/api/v1/profiles', { tags: ['Profiles'], summary: 'List user profiles', responses: stdResponses() }),
    op('get', '/api/v1/profiles/active', { tags: ['Profiles'], summary: 'Get active profile', responses: stdResponses() }),
    op('get', '/api/v1/profiles/children/direct', { tags: ['Profiles'], summary: 'Get direct child profile for logged-in child', responses: stdResponses() }),
    op('get', '/api/v1/profiles/children/accessible', {
      tags: ['Profiles'],
      summary: 'List children accessible to user',
      parameters: [{ name: 'profileId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: stdResponses()
    }),
    op('get', '/api/v1/profiles/children/{childId}', {
      tags: ['Profiles'],
      summary: 'Get child profile details',
      parameters: [
        ref('parameters/ChildId'),
        { name: 'includeStats', in: 'query', schema: { type: 'string' } }
      ],
      responses: stdResponses()
    }),
    op('delete', '/api/v1/profiles/children/{childId}', {
      tags: ['Profiles'],
      summary: 'Delete child profile',
      parameters: [ref('parameters/ChildId')],
      responses: stdResponses()
    }),
    op('patch', '/api/v1/profiles/children/{childId}', {
      tags: ['Profiles'],
      summary: 'Update child profile',
      parameters: [ref('parameters/ChildId')],
      requestBody: {
        content: {
          'multipart/form-data': { schema: ref('schemas/ChildProfileUpdate') },
          'application/json': { schema: ref('schemas/ChildProfileUpdate') }
        }
      },
      responses: stdResponses()
    }),
    op('post', '/api/v1/profiles/children/{childId}/verify-pin', {
      tags: ['Profiles'],
      summary: 'Verify child PIN',
      parameters: [ref('parameters/ChildId')],
      requestBody: jsonBody({ type: 'object', required: ['pin'], properties: { pin: { type: 'string', minLength: 4, maxLength: 4 } } }),
      responses: stdResponses()
    }),
    op('post', '/api/v1/profiles/children/{childId}/unlock', {
      tags: ['Profiles'],
      summary: 'Unlock locked child account',
      parameters: [ref('parameters/ChildId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/profiles', {
      tags: ['Profiles'],
      summary: 'Create profile',
      requestBody: jsonBody(ref('schemas/CreateProfileRequest')),
      responses: stdResponses({ 201: successResponse('Profile created') })
    }),
    op('get', '/api/v1/profiles/{profileId}', {
      tags: ['Profiles'],
      summary: 'Get profile by ID',
      parameters: [ref('parameters/ProfileId')],
      responses: stdResponses()
    }),
    op('get', '/api/v1/profiles/{profileId}/children', {
      tags: ['Profiles'],
      summary: 'List children under profile',
      parameters: [
        ref('parameters/ProfileId'),
        { name: 'activeOnly', in: 'query', schema: { type: 'string' } },
        { name: 'includePendingTaskCounts', in: 'query', schema: { type: 'string' } }
      ],
      responses: stdResponses()
    }),
    op('post', '/api/v1/profiles/{profileId}/children', {
      tags: ['Profiles'],
      summary: 'Create child under profile',
      parameters: [ref('parameters/ProfileId')],
      requestBody: {
        content: {
          'multipart/form-data': { schema: ref('schemas/CreateChildProfileRequest') },
          'application/json': { schema: ref('schemas/CreateChildProfileRequest') }
        }
      },
      responses: stdResponses({ 201: successResponse('Child profile created') })
    }),
    op('patch', '/api/v1/profiles/{profileId}', {
      tags: ['Profiles'],
      summary: 'Update profile',
      parameters: [ref('parameters/ProfileId')],
      requestBody: jsonBody(ref('schemas/UpdateProfileRequest')),
      responses: stdResponses()
    }),
    op('post', '/api/v1/profiles/{profileId}/switch', {
      tags: ['Profiles'],
      summary: 'Switch active profile',
      parameters: [ref('parameters/ProfileId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/profiles/{profileId}/reset-financial-data', {
      tags: ['Profiles'],
      summary: 'Reset financial data (owner only)',
      parameters: [ref('parameters/ProfileId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/profiles/{profileId}/reset-user-data', {
      tags: ['Profiles'],
      summary: 'Reset user data (owner only)',
      parameters: [ref('parameters/ProfileId')],
      responses: stdResponses()
    }),

    // Collaboration
    op('get', '/api/v1/collaboration/invitations/token/{token}', {
      tags: ['Collaboration'],
      summary: 'Get invitation by token',
      security: [],
      parameters: [ref('parameters/InvitationToken')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/collaboration/invitations/{token}/accept', {
      tags: ['Collaboration'],
      summary: 'Accept invitation and set password',
      security: [],
      parameters: [ref('parameters/InvitationToken')],
      requestBody: jsonBody(ref('schemas/AcceptInvitationRequest')),
      responses: stdResponses()
    }),
    op('post', '/api/v1/collaboration/invitations/expire-old', {
      tags: ['Collaboration'],
      summary: 'Expire stale invitations',
      security: [],
      responses: stdResponses()
    }),
    op('get', '/api/v1/collaboration/children/{childId}/invitations/active', {
      tags: ['Collaboration'],
      summary: 'Get active invitation for child',
      parameters: [ref('parameters/ChildId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/collaboration/children/{childId}/invitations', {
      tags: ['Collaboration'],
      summary: 'Create invitation for child',
      parameters: [ref('parameters/ChildId')],
      requestBody: jsonBody(ref('schemas/CreateInvitationRequest')),
      responses: stdResponses({ 201: successResponse('Invitation created') })
    }),
    op('patch', '/api/v1/collaboration/invitations/{invitationId}/resend', {
      tags: ['Collaboration'],
      summary: 'Resend invitation',
      parameters: [ref('parameters/InvitationId')],
      requestBody: jsonBody(ref('schemas/ResendInvitationRequest'), false),
      responses: stdResponses()
    }),
    op('patch', '/api/v1/collaboration/invitations/{invitationId}/revoke', {
      tags: ['Collaboration'],
      summary: 'Revoke invitation',
      parameters: [ref('parameters/InvitationId')],
      responses: stdResponses()
    }),
    op('get', '/api/v1/collaboration/children/{childId}/shares', {
      tags: ['Collaboration'],
      summary: 'List shares for child',
      parameters: [ref('parameters/ChildId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/collaboration/children/{childId}/shares', {
      tags: ['Collaboration'],
      summary: 'Share child profile',
      parameters: [ref('parameters/ChildId')],
      requestBody: jsonBody(ref('schemas/CreateShareRequest')),
      responses: stdResponses({ 201: successResponse('Share created') })
    }),
    op('patch', '/api/v1/collaboration/shares/{shareId}/revoke', {
      tags: ['Collaboration'],
      summary: 'Revoke share',
      parameters: [ref('parameters/ShareId')],
      responses: stdResponses()
    }),

    // Contacts
    op('get', '/api/v1/contacts/incoming', { tags: ['Contacts'], summary: 'List incoming contact requests', responses: stdResponses() }),
    op('get', '/api/v1/contacts', {
      tags: ['Contacts'],
      summary: 'List contacts (paginated)',
      parameters: [
        ref('parameters/ProfileIdHeader'),
        ref('parameters/Page'),
        ref('parameters/Limit'),
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'groupName', in: 'query', schema: { type: 'string' } },
        { name: 'contactType', in: 'query', schema: { type: 'string' } },
        { name: 'orderBy', in: 'query', schema: { type: 'string' } }
      ],
      responses: stdResponses()
    }),
    op('post', '/api/v1/contacts', {
      tags: ['Contacts'],
      summary: 'Create contact',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody(ref('schemas/ContactRequest')),
      responses: stdResponses({ 201: successResponse('Contact created') })
    }),
    op('get', '/api/v1/contacts/account-detection', {
      tags: ['Contacts'],
      summary: 'Detect if contact has existing account',
      parameters: [
        ref('parameters/ProfileIdHeader'),
        { name: 'email', in: 'query', schema: { type: 'string', format: 'email' } },
        { name: 'phone', in: 'query', schema: { type: 'string' } }
      ],
      responses: stdResponses()
    }),
    op('get', '/api/v1/contacts/{contactId}', {
      tags: ['Contacts'],
      summary: 'Get contact',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ContactId')],
      responses: stdResponses()
    }),
    op('patch', '/api/v1/contacts/{contactId}', {
      tags: ['Contacts'],
      summary: 'Update contact',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ContactId')],
      requestBody: {
        content: {
          'multipart/form-data': { schema: ref('schemas/ContactRequest') },
          'application/json': { schema: ref('schemas/ContactRequest') }
        }
      },
      responses: stdResponses()
    }),
    op('post', '/api/v1/contacts/{contactId}/accept', {
      tags: ['Contacts'],
      summary: 'Accept incoming contact request',
      parameters: [ref('parameters/ContactId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/contacts/{contactId}/withdraw', {
      tags: ['Contacts'],
      summary: 'Withdraw contact request',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ContactId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/contacts/{contactId}/connection-request', {
      tags: ['Contacts'],
      summary: 'Send connection request',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ContactId')],
      requestBody: jsonBody({ type: 'object', required: ['targetUserId'], properties: { targetUserId: { type: 'string', format: 'uuid' } } }),
      responses: stdResponses()
    }),
    op('post', '/api/v1/contacts/{contactId}/invitation', {
      tags: ['Contacts'],
      summary: 'Invite contact to platform',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ContactId')],
      requestBody: jsonBody({ type: 'object', properties: { email: { type: 'string' }, phone: { type: 'string' } } }, false),
      responses: stdResponses()
    }),
    op('delete', '/api/v1/contacts/{contactId}', {
      tags: ['Contacts'],
      summary: 'Delete contact',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ContactId')],
      responses: stdResponses()
    }),

    // Tasks
    op('get', '/api/v1/tasks/children/{childId}/tasks', { tags: ['Tasks'], summary: 'List tasks for child', parameters: [ref('parameters/ChildId')], responses: stdResponses() }),
    op('get', '/api/v1/tasks/children/{childId}/completions', {
      tags: ['Tasks'],
      summary: 'List task completions for child',
      parameters: [ref('parameters/ChildId'), { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } }],
      responses: stdResponses()
    }),
    op('get', '/api/v1/tasks/children/{childId}/star-balance', { tags: ['Tasks'], summary: 'Get child star balance', parameters: [ref('parameters/ChildId')], responses: stdResponses() }),
    op('post', '/api/v1/tasks/children/{childId}/award-stars', {
      tags: ['Tasks'],
      summary: 'Manually award stars',
      parameters: [ref('parameters/ChildId')],
      requestBody: jsonBody({ type: 'object', required: ['stars'], properties: { stars: { type: 'number' }, note: { type: 'string' }, taskId: { type: 'string', format: 'uuid' } } }),
      responses: stdResponses()
    }),
    op('post', '/api/v1/tasks/profiles/{profileId}/tasks', {
      tags: ['Tasks'],
      summary: 'Create task for child',
      parameters: [ref('parameters/ProfileId')],
      requestBody: jsonBody(ref('schemas/CreateTaskRequest')),
      responses: stdResponses({ 201: successResponse('Task created') })
    }),
    op('post', '/api/v1/tasks/{taskId}/completions', {
      tags: ['Tasks'],
      summary: 'Submit task completion',
      parameters: [ref('parameters/TaskId')],
      requestBody: jsonBody({ type: 'object', properties: { submissionNotes: { type: 'string' } } }, false),
      responses: stdResponses({ 201: successResponse('Completion submitted') })
    }),
    op('patch', '/api/v1/tasks/{taskId}', {
      tags: ['Tasks'],
      summary: 'Update task',
      parameters: [ref('parameters/TaskId')],
      requestBody: jsonBody(ref('schemas/UpdateTaskRequest'), false),
      responses: stdResponses()
    }),
    op('delete', '/api/v1/tasks/{taskId}', { tags: ['Tasks'], summary: 'Delete task', parameters: [ref('parameters/TaskId')], responses: stdResponses() }),
    op('post', '/api/v1/tasks/completions/{completionId}/approve', {
      tags: ['Tasks'],
      summary: 'Approve task completion',
      parameters: [ref('parameters/CompletionId')],
      requestBody: jsonBody({ type: 'object', properties: { reviewNotes: { type: 'string' } } }, false),
      responses: stdResponses()
    }),
    op('post', '/api/v1/tasks/completions/{completionId}/reject', {
      tags: ['Tasks'],
      summary: 'Reject task completion',
      parameters: [ref('parameters/CompletionId')],
      requestBody: jsonBody({ type: 'object', properties: { reviewNotes: { type: 'string' } } }, false),
      responses: stdResponses()
    }),

    // Rewards
    op('get', '/api/v1/rewards/children/{childId}/rewards', { tags: ['Rewards'], summary: 'List rewards for child', parameters: [ref('parameters/ChildId')], responses: stdResponses() }),
    op('get', '/api/v1/rewards/children/{childId}/redemptions', {
      tags: ['Rewards'],
      summary: 'List redemptions for child',
      parameters: [ref('parameters/ChildId'), { name: 'status', in: 'query', schema: { type: 'string' } }],
      responses: stdResponses()
    }),
    op('get', '/api/v1/rewards/children/{childId}/activity', { tags: ['Rewards'], summary: 'List reward activity', parameters: [ref('parameters/ChildId')], responses: stdResponses() }),
    op('post', '/api/v1/rewards/profiles/{profileId}/rewards', {
      tags: ['Rewards'],
      summary: 'Create reward',
      parameters: [ref('parameters/ProfileId')],
      requestBody: { content: { 'multipart/form-data': { schema: ref('schemas/CreateRewardRequest') }, 'application/json': { schema: ref('schemas/CreateRewardRequest') } } },
      responses: stdResponses({ 201: successResponse('Reward created') })
    }),
    op('post', '/api/v1/rewards/children/{childId}/rewards/{rewardId}/redeem', {
      tags: ['Rewards'],
      summary: 'Redeem reward',
      parameters: [ref('parameters/ChildId'), ref('parameters/RewardId')],
      responses: stdResponses()
    }),
    op('patch', '/api/v1/rewards/{rewardId}', {
      tags: ['Rewards'],
      summary: 'Update reward',
      parameters: [ref('parameters/RewardId')],
      requestBody: { content: { 'multipart/form-data': { schema: ref('schemas/UpdateRewardRequest') }, 'application/json': { schema: ref('schemas/UpdateRewardRequest') } } },
      responses: stdResponses()
    }),
    op('delete', '/api/v1/rewards/{rewardId}', { tags: ['Rewards'], summary: 'Delete reward', parameters: [ref('parameters/RewardId')], responses: stdResponses() }),
    op('post', '/api/v1/rewards/redemptions/{redemptionId}/approve', { tags: ['Rewards'], summary: 'Approve redemption', parameters: [ref('parameters/RedemptionId')], responses: stdResponses() }),
    op('post', '/api/v1/rewards/redemptions/{redemptionId}/reject', {
      tags: ['Rewards'],
      summary: 'Reject redemption',
      parameters: [ref('parameters/RedemptionId')],
      requestBody: jsonBody({ type: 'object', properties: { reason: { type: 'string' } } }, false),
      responses: stdResponses()
    }),
    op('post', '/api/v1/rewards/redemptions/{redemptionId}/fulfill', {
      tags: ['Rewards'],
      summary: 'Fulfill redemption',
      parameters: [ref('parameters/RedemptionId')],
      requestBody: jsonBody({ type: 'object', properties: { notes: { type: 'string' } } }, false),
      responses: stdResponses()
    }),

    // Accounts
    op('get', '/api/v1/accounts/templates', {
      tags: ['Accounts'],
      summary: 'List chart-of-accounts templates',
      parameters: [ref('parameters/ProfileIdHeader'), { name: 'class', in: 'query', schema: ref('schemas/AccountClass') }],
      responses: stdResponses()
    }),
    op('post', '/api/v1/accounts/activate-template', {
      tags: ['Accounts'],
      summary: 'Activate template as account',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody(ref('schemas/ActivateTemplateRequest'), false),
      responses: stdResponses({ 201: successResponse('Account activated') })
    }),
    op('get', '/api/v1/accounts', {
      tags: ['Accounts'],
      summary: 'List accounts',
      parameters: [
        ref('parameters/ProfileIdHeader'),
        ref('parameters/Page'),
        ref('parameters/Limit'),
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'class', in: 'query', schema: ref('schemas/AccountClass') },
        { name: 'accountType', in: 'query', schema: { type: 'string' } },
        { name: 'isActive', in: 'query', schema: { type: 'string' } },
        { name: 'orderBy', in: 'query', schema: { type: 'string' } }
      ],
      responses: stdResponses()
    }),
    op('post', '/api/v1/accounts', {
      tags: ['Accounts'],
      summary: 'Create account',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody(ref('schemas/AccountRequest')),
      responses: stdResponses({ 201: successResponse('Account created') })
    }),
    op('get', '/api/v1/accounts/{accountId}', {
      tags: ['Accounts'],
      summary: 'Get account',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/AccountId')],
      responses: stdResponses()
    }),
    op('patch', '/api/v1/accounts/{accountId}', {
      tags: ['Accounts'],
      summary: 'Update account',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/AccountId')],
      requestBody: jsonBody(ref('schemas/AccountRequest'), false),
      responses: stdResponses()
    }),
    op('delete', '/api/v1/accounts/{accountId}', {
      tags: ['Accounts'],
      summary: 'Delete account',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/AccountId')],
      responses: stdResponses()
    }),

    // Transactions
    op('get', '/api/v1/transactions', {
      tags: ['Transactions'],
      summary: 'List transactions',
      parameters: [
        ref('parameters/ProfileIdHeader'),
        ref('parameters/Page'),
        ref('parameters/Limit'),
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'orderBy', in: 'query', schema: { type: 'string' } }
      ],
      responses: stdResponses()
    }),
    op('post', '/api/v1/transactions', {
      tags: ['Transactions'],
      summary: 'Create transaction',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody(ref('schemas/TransactionRequest')),
      responses: stdResponses({ 201: successResponse('Transaction created') })
    }),
    op('post', '/api/v1/transactions/bulk', {
      tags: ['Transactions'],
      summary: 'Bulk create transactions',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody({ type: 'object' }, false),
      responses: stdResponses({ 201: successResponse('Transactions created') })
    }),
    op('get', '/api/v1/transactions/{transactionId}/splits', {
      tags: ['Transactions'],
      summary: 'List transaction splits',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      responses: stdResponses()
    }),
    op('put', '/api/v1/transactions/{transactionId}/splits', {
      tags: ['Transactions'],
      summary: 'Replace transaction splits',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      requestBody: jsonBody({ type: 'object', required: ['splits'], properties: { splits: { type: 'array', items: { type: 'object' } } } }),
      responses: stdResponses()
    }),
    op('delete', '/api/v1/transactions/{transactionId}/splits', {
      tags: ['Transactions'],
      summary: 'Delete transaction splits',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      responses: stdResponses()
    }),
    op('get', '/api/v1/transactions/{transactionId}', {
      tags: ['Transactions'],
      summary: 'Get transaction',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      responses: stdResponses()
    }),
    op('patch', '/api/v1/transactions/{transactionId}', {
      tags: ['Transactions'],
      summary: 'Update transaction',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      requestBody: jsonBody(ref('schemas/TransactionRequest'), false),
      responses: stdResponses()
    }),
    op('post', '/api/v1/transactions/{transactionId}/undo', {
      tags: ['Transactions'],
      summary: 'Undo posted transaction',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/transactions/{transactionId}/post', {
      tags: ['Transactions'],
      summary: 'Post transaction',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      responses: stdResponses()
    }),
    op('delete', '/api/v1/transactions/{transactionId}', {
      tags: ['Transactions'],
      summary: 'Delete transaction',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      responses: stdResponses()
    }),

    // Transfer matches
    op('get', '/api/v1/transfer-matches/candidates/{transactionId}', {
      tags: ['Transfer Matching'],
      summary: 'Find transfer match candidates',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/transfer-matches', {
      tags: ['Transfer Matching'],
      summary: 'Manually pair transfers',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody({
        type: 'object',
        required: ['transactionId', 'matchedTransactionId'],
        properties: {
          transactionId: { type: 'string', format: 'uuid' },
          matchedTransactionId: { type: 'string', format: 'uuid' }
        }
      }),
      responses: stdResponses()
    }),
    op('delete', '/api/v1/transfer-matches/{transactionId}', {
      tags: ['Transfer Matching'],
      summary: 'Unmatch transfer pair',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/TransactionId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/transfer-matches/auto', {
      tags: ['Transfer Matching'],
      summary: 'Auto-match transfers',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody({ type: 'object', properties: { minConfidence: { type: 'number' } } }, false),
      responses: stdResponses()
    }),

    // Transaction rules
    op('get', '/api/v1/transaction-rules', {
      tags: ['Transaction Rules'],
      summary: 'List categorization rules',
      parameters: [ref('parameters/ProfileIdHeader'), { name: 'enabled', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }],
      responses: stdResponses()
    }),
    op('post', '/api/v1/transaction-rules', {
      tags: ['Transaction Rules'],
      summary: 'Create rule',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody({ type: 'object' }, false),
      responses: stdResponses({ 201: successResponse('Rule created') })
    }),
    op('post', '/api/v1/transaction-rules/preview', {
      tags: ['Transaction Rules'],
      summary: 'Preview rule matches',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody({ type: 'object' }, false),
      responses: stdResponses()
    }),
    op('get', '/api/v1/transaction-rules/{ruleId}', {
      tags: ['Transaction Rules'],
      summary: 'Get rule',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/RuleId')],
      responses: stdResponses()
    }),
    op('patch', '/api/v1/transaction-rules/{ruleId}', {
      tags: ['Transaction Rules'],
      summary: 'Update rule',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/RuleId')],
      requestBody: jsonBody({ type: 'object' }, false),
      responses: stdResponses()
    }),
    op('delete', '/api/v1/transaction-rules/{ruleId}', {
      tags: ['Transaction Rules'],
      summary: 'Delete rule',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/RuleId')],
      responses: stdResponses()
    }),
    op('post', '/api/v1/transaction-rules/{ruleId}/duplicate', {
      tags: ['Transaction Rules'],
      summary: 'Duplicate rule',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/RuleId')],
      responses: stdResponses({ 201: successResponse('Rule duplicated') })
    }),
    op('post', '/api/v1/transaction-rules/{ruleId}/apply', {
      tags: ['Transaction Rules'],
      summary: 'Apply rule to transactions',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/RuleId')],
      responses: stdResponses()
    }),

    // Banking
    op('get', '/api/v1/banking/recurring-payments', {
      tags: ['Banking'],
      summary: 'List recurring payments',
      parameters: [ref('parameters/ProfileIdHeader')],
      responses: stdResponses()
    }),

    // Plaid
    op('get', '/api/v1/plaid/status', { tags: ['Plaid'], summary: 'Plaid connection status', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('post', '/api/v1/plaid/link-token', { tags: ['Plaid'], summary: 'Create Plaid Link token', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('post', '/api/v1/plaid/exchange-token', { tags: ['Plaid'], summary: 'Exchange Plaid public token', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('post', '/api/v1/plaid/sync', { tags: ['Plaid'], summary: 'Sync Plaid item', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),

    // Budgets
    op('get', '/api/v1/budgets', {
      tags: ['Budgets'],
      summary: 'List budgets',
      parameters: [ref('parameters/ProfileIdHeader'), { name: 'isActive', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }],
      responses: stdResponses()
    }),
    op('get', '/api/v1/budgets/analytics/historical-spending/{categoryAccountId}', { tags: ['Budgets'], summary: 'Historical spending analytics', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/CategoryAccountId')], responses: stdResponses() }),
    op('get', '/api/v1/budgets/analytics/vendor-breakdown/{categoryAccountId}', { tags: ['Budgets'], summary: 'Vendor breakdown analytics', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/CategoryAccountId')], responses: stdResponses() }),
    op('get', '/api/v1/budgets/analytics/transaction-patterns/{categoryAccountId}', { tags: ['Budgets'], summary: 'Transaction patterns analytics', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/CategoryAccountId')], responses: stdResponses() }),
    op('get', '/api/v1/budgets/analytics/performance-history/{categoryAccountId}', { tags: ['Budgets'], summary: 'Budget performance history', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/CategoryAccountId')], responses: stdResponses() }),
    op('get', '/api/v1/budgets/analytics/monthly-actuals/{categoryAccountId}', { tags: ['Budgets'], summary: 'Monthly actuals analytics', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/CategoryAccountId')], responses: stdResponses() }),
    op('get', '/api/v1/budgets/analytics/spending-forecast/{categoryAccountId}', { tags: ['Budgets'], summary: 'Spending forecast', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/CategoryAccountId')], responses: stdResponses() }),
    op('get', '/api/v1/budgets/analytics/comparative-analysis/{categoryAccountId}', { tags: ['Budgets'], summary: 'Comparative analysis', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/CategoryAccountId')], responses: stdResponses() }),
    op('post', '/api/v1/budgets', { tags: ['Budgets'], summary: 'Create budget', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses({ 201: successResponse('Budget created') }) }),
    op('get', '/api/v1/budgets/{budgetId}', { tags: ['Budgets'], summary: 'Get budget', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/BudgetId')], responses: stdResponses() }),
    op('patch', '/api/v1/budgets/{budgetId}', { tags: ['Budgets'], summary: 'Update budget', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/BudgetId')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('delete', '/api/v1/budgets/{budgetId}', { tags: ['Budgets'], summary: 'Delete budget', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/BudgetId')], responses: stdResponses() }),

    // Goals
    op('get', '/api/v1/goals/summary', { tags: ['Goals'], summary: 'Goals summary', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('get', '/api/v1/goals', {
      tags: ['Goals'],
      summary: 'List savings goals',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/Page'), ref('parameters/Limit'), { name: 'search', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string' } }],
      responses: stdResponses()
    }),
    op('post', '/api/v1/goals', {
      tags: ['Goals'],
      summary: 'Create goal',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody(ref('schemas/CreateGoalRequest')),
      responses: stdResponses({ 201: successResponse('Goal created') })
    }),
    op('get', '/api/v1/goals/{goalId}', { tags: ['Goals'], summary: 'Get goal', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/GoalId'), { name: 'includeContributions', in: 'query', schema: { type: 'string' } }], responses: stdResponses() }),
    op('patch', '/api/v1/goals/{goalId}', { tags: ['Goals'], summary: 'Update goal', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/GoalId')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('delete', '/api/v1/goals/{goalId}', { tags: ['Goals'], summary: 'Delete goal', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/GoalId')], responses: stdResponses() }),
    op('get', '/api/v1/goals/{goalId}/contributions', { tags: ['Goals'], summary: 'List goal contributions', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/GoalId'), ref('parameters/Page'), ref('parameters/Limit')], responses: stdResponses() }),
    op('post', '/api/v1/goals/{goalId}/contributions', { tags: ['Goals'], summary: 'Add goal contribution', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/GoalId')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses({ 201: successResponse('Contribution created') }) }),
    op('patch', '/api/v1/goals/{goalId}/contributions/{contributionId}', { tags: ['Goals'], summary: 'Update contribution', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/GoalId'), ref('parameters/ContributionId')], requestBody: jsonBody({ type: 'object', properties: { notes: { type: 'string' } } }, false), responses: stdResponses() }),
    op('delete', '/api/v1/goals/{goalId}/contributions/{contributionId}', { tags: ['Goals'], summary: 'Delete contribution', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/GoalId'), ref('parameters/ContributionId')], responses: stdResponses() }),

    // Calendar
    op('get', '/api/v1/calendar/schedules', { tags: ['Calendar'], summary: 'List recurring schedules', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('post', '/api/v1/calendar/schedules', { tags: ['Calendar'], summary: 'Create schedule', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody(ref('schemas/CreateScheduleRequest')), responses: stdResponses({ 201: successResponse('Schedule created') }) }),
    op('patch', '/api/v1/calendar/schedules/{scheduleId}', { tags: ['Calendar'], summary: 'Update schedule', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ScheduleId')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('delete', '/api/v1/calendar/schedules/{scheduleId}', { tags: ['Calendar'], summary: 'Delete schedule', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ScheduleId')], responses: stdResponses() }),
    op('patch', '/api/v1/calendar/schedules/{scheduleId}/pause', { tags: ['Calendar'], summary: 'Pause schedule', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ScheduleId')], responses: stdResponses() }),
    op('patch', '/api/v1/calendar/schedules/{scheduleId}/resume', { tags: ['Calendar'], summary: 'Resume schedule', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ScheduleId')], responses: stdResponses() }),
    op('post', '/api/v1/calendar/schedules/{scheduleId}/duplicate', { tags: ['Calendar'], summary: 'Duplicate schedule', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ScheduleId')], requestBody: jsonBody({ type: 'object', properties: { title: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' } } }, false), responses: stdResponses({ 201: successResponse('Schedule duplicated') }) }),
    op('get', '/api/v1/calendar/occurrences', { tags: ['Calendar'], summary: 'List schedule occurrences', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('get', '/api/v1/calendar/occurrences/{occurrenceId}', { tags: ['Calendar'], summary: 'Get occurrence', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/OccurrenceId')], responses: stdResponses() }),
    op('patch', '/api/v1/calendar/occurrences/{occurrenceId}/confirm', { tags: ['Calendar'], summary: 'Confirm occurrence', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/OccurrenceId')], requestBody: jsonBody({ type: 'object', properties: { transaction_id: { type: 'string', format: 'uuid' }, notes: { type: 'string' } } }, false), responses: stdResponses() }),
    op('patch', '/api/v1/calendar/occurrences/{occurrenceId}/skip', { tags: ['Calendar'], summary: 'Skip occurrence', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/OccurrenceId')], requestBody: jsonBody({ type: 'object', properties: { notes: { type: 'string' } } }, false), responses: stdResponses() }),
    op('patch', '/api/v1/calendar/occurrences/{occurrenceId}/cancel', { tags: ['Calendar'], summary: 'Cancel occurrence', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/OccurrenceId')], requestBody: jsonBody({ type: 'object', properties: { notes: { type: 'string' } } }, false), responses: stdResponses() }),
    op('get', '/api/v1/calendar/notifications', { tags: ['Calendar'], summary: 'List calendar notifications', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('patch', '/api/v1/calendar/notifications/{notificationId}/acknowledge', { tags: ['Calendar'], summary: 'Acknowledge calendar notification', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/CalendarNotificationId')], responses: stdResponses() }),

    // Notifications
    op('get', '/api/v1/notifications/summary', { tags: ['Notifications'], summary: 'Notification summary', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('get', '/api/v1/notifications', {
      tags: ['Notifications'],
      summary: 'List notifications',
      parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/Page'), ref('parameters/Limit'), { name: 'unread', in: 'query', schema: { type: 'string' } }, { name: 'priority', in: 'query', schema: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } }],
      responses: stdResponses()
    }),
    op('patch', '/api/v1/notifications/read-all', { tags: ['Notifications'], summary: 'Mark all notifications read', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('get', '/api/v1/notifications/{notificationId}', { tags: ['Notifications'], summary: 'Get notification', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/NotificationId')], responses: stdResponses() }),
    op('patch', '/api/v1/notifications/{notificationId}/read', { tags: ['Notifications'], summary: 'Mark notification read', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/NotificationId')], responses: stdResponses() }),
    op('patch', '/api/v1/notifications/{notificationId}/unread', { tags: ['Notifications'], summary: 'Mark notification unread', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/NotificationId')], responses: stdResponses() }),

    // Files
    op('get', '/api/v1/files/public/{filePath}', { tags: ['Files'], summary: 'Redirect to public file URL', security: [], parameters: [{ name: 'filePath', in: 'path', required: true, schema: { type: 'string' } }], responses: stdResponses() }),
    op('post', '/api/v1/files/presigned-upload', { tags: ['Files'], summary: 'Create presigned upload URL', requestBody: jsonBody(ref('schemas/PresignedUploadRequest')), responses: stdResponses() }),
    op('post', '/api/v1/files/download', { tags: ['Files'], summary: 'Create download URL', requestBody: jsonBody({ type: 'object', required: ['key'], properties: { key: { type: 'string', maxLength: 2000 } } }), responses: stdResponses() }),
    op('delete', '/api/v1/files', { tags: ['Files'], summary: 'Delete file from storage', requestBody: jsonBody({ type: 'object', properties: { key: { type: 'string' }, publicUrl: { type: 'string' } } }, false), responses: stdResponses() }),

    // Search
    op('get', '/api/v1/search', {
      tags: ['Search'],
      summary: 'Global cross-entity search',
      parameters: [ref('parameters/ProfileIdHeader'), { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'types', in: 'query', schema: { type: 'string' } }, { name: 'limitPerType', in: 'query', schema: { type: 'integer' } }],
      responses: stdResponses()
    }),

    // Net worth
    op('get', '/api/v1/net-worth/summary', { tags: ['Net Worth'], summary: 'Net worth summary', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),

    // Credit Score
    op('post', '/api/v1/credit/verify', {
      tags: ['Credit Score'],
      summary: 'Verify identity for credit monitoring',
      description: 'Starts KYC verification via the configured credit provider. Name, DOB, SSN last 4, and address are pass-through only and are never persisted. Requires profile owner role.',
      parameters: [ref('parameters/ProfileIdHeader')],
      requestBody: jsonBody(ref('schemas/CreditVerifyRequest')),
      responses: stdResponses({ 201: successResponse('Verification recorded') })
    }),
    op('get', '/api/v1/credit/status', {
      tags: ['Credit Score'],
      summary: 'Get credit verification status',
      description: 'Returns verification state, last score pull time, and refresh availability for the active profile.',
      parameters: [ref('parameters/ProfileIdHeader')],
      responses: stdResponses()
    }),
    op('get', '/api/v1/credit/score', {
      tags: ['Credit Score'],
      summary: 'Get latest credit score',
      description: 'Returns the latest score, band, bureau, factors, and pull timestamp. Requires verified identity.',
      parameters: [ref('parameters/ProfileIdHeader')],
      responses: stdResponses({
        403: ref('responses/Forbidden'),
        404: ref('responses/NotFound')
      })
    }),
    op('get', '/api/v1/credit/history', {
      tags: ['Credit Score'],
      summary: 'Get credit score history',
      description: 'Returns monthly score history points (latest pull per month). Requires verified identity.',
      parameters: [
        ref('parameters/ProfileIdHeader'),
        { name: 'months', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 24, default: 12 } }
      ],
      responses: stdResponses({ 403: ref('responses/Forbidden') })
    }),
    op('post', '/api/v1/credit/refresh', {
      tags: ['Credit Score'],
      summary: 'Refresh credit score',
      description: 'Pulls a new credit score for the active profile. Requires verified identity and profile owner role.',
      parameters: [ref('parameters/ProfileIdHeader')],
      responses: stdResponses({
        403: ref('responses/Forbidden'),
        429: ref('responses/TooManyRequests')
      })
    }),

    // View preferences
    op('get', '/api/v1/view-preferences/{viewName}', { tags: ['View Preferences'], summary: 'Get saved view preferences', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ViewName')], responses: stdResponses() }),
    op('put', '/api/v1/view-preferences/{viewName}', { tags: ['View Preferences'], summary: 'Save view preferences', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ViewName')], requestBody: jsonBody({ type: 'object', properties: { preferences: { type: 'object' } } }), responses: stdResponses() }),
    op('delete', '/api/v1/view-preferences', { tags: ['View Preferences'], summary: 'Delete all view preferences', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('delete', '/api/v1/view-preferences/{viewName}', { tags: ['View Preferences'], summary: 'Delete view preferences', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ViewName')], responses: stdResponses() }),

    // CSV mapping
    op('get', '/api/v1/csv-mapping-configs/match', { tags: ['CSV Mapping'], summary: 'Get CSV column mapping config', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('post', '/api/v1/csv-mapping-configs', { tags: ['CSV Mapping'], summary: 'Save CSV mapping config', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),

    // Protected configurations
    op('get', '/api/v1/protected-configurations', { tags: ['Protected Configurations'], summary: 'List protected configurations', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('get', '/api/v1/protected-configurations/by-name/{name}', { tags: ['Protected Configurations'], summary: 'Get configuration by name', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ConfigName')], responses: stdResponses() }),
    op('post', '/api/v1/protected-configurations/{configId}/changelog', { tags: ['Protected Configurations'], summary: 'Log configuration change', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ConfigId')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('post', '/api/v1/protected-configurations/{configId}/lock', { tags: ['Protected Configurations'], summary: 'Lock configuration', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ConfigId')], responses: stdResponses() }),
    op('post', '/api/v1/protected-configurations/{configId}/unlock', { tags: ['Protected Configurations'], summary: 'Unlock configuration', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ConfigId')], responses: stdResponses() }),
    op('post', '/api/v1/protected-configurations/{configId}/restore', { tags: ['Protected Configurations'], summary: 'Restore configuration version', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ConfigId')], requestBody: jsonBody({ type: 'object', required: ['version'], properties: { version: { type: 'string' } } }), responses: stdResponses() }),
    op('get', '/api/v1/protected-configurations/{configId}/history', { tags: ['Protected Configurations'], summary: 'Configuration version history', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/ConfigId')], responses: stdResponses() }),

    // Journal entries
    op('get', '/api/v1/journal-entries', { tags: ['Journal Entries'], summary: 'List journal entries', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('get', '/api/v1/journal-entries/lines', { tags: ['Journal Entries'], summary: 'List journal entry lines', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('get', '/api/v1/journal-entries/audit-history', { tags: ['Journal Entries'], summary: 'Journal entry audit history', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('get', '/api/v1/journal-entries/next-number', { tags: ['Journal Entries'], summary: 'Get next journal entry number', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('post', '/api/v1/journal-entries', { tags: ['Journal Entries'], summary: 'Create journal entry', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses({ 201: successResponse('Journal entry created') }) }),
    op('post', '/api/v1/journal-entries/opening-balance', { tags: ['Journal Entries'], summary: 'Create opening balance entry', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses({ 201: successResponse('Opening balance entry created') }) }),
    op('post', '/api/v1/journal-entries/{entryId}/attachments', { tags: ['Journal Entries'], summary: 'Attach file to journal entry', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/EntryId')], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } }, responses: stdResponses({ 201: successResponse('Attachment created') }) }),
    op('get', '/api/v1/journal-entries/{entryId}/attachments', { tags: ['Journal Entries'], summary: 'List journal entry attachments', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/EntryId')], responses: stdResponses() }),
    op('delete', '/api/v1/journal-entries/attachments/{attachmentId}', { tags: ['Journal Entries'], summary: 'Delete journal entry attachment', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/AttachmentId')], responses: stdResponses() }),
    op('get', '/api/v1/journal-entries/{entryId}', { tags: ['Journal Entries'], summary: 'Get journal entry', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/EntryId')], responses: stdResponses() }),
    op('patch', '/api/v1/journal-entries/{entryId}', { tags: ['Journal Entries'], summary: 'Update journal entry', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/EntryId')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('delete', '/api/v1/journal-entries/{entryId}', { tags: ['Journal Entries'], summary: 'Delete journal entry', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/EntryId')], responses: stdResponses() }),

    // Vault
    op('get', '/api/v1/vault/items', { tags: ['Vault'], summary: 'List vault items', parameters: [ref('parameters/ProfileIdHeader'), { name: 'includeShared', in: 'query', schema: { type: 'string' } }, { name: 'includeDeleted', in: 'query', schema: { type: 'string' } }], responses: stdResponses() }),
    op('post', '/api/v1/vault/items', { tags: ['Vault'], summary: 'Create vault item', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody(ref('schemas/VaultItemRequest')), responses: stdResponses({ 201: successResponse('Vault item created') }) }),
    op('get', '/api/v1/vault/shared-with-me', { tags: ['Vault'], summary: 'List items shared with current user', responses: stdResponses() }),
    op('post', '/api/v1/vault/trash/cleanup', { tags: ['Vault'], summary: 'Purge trash items', responses: stdResponses() }),
    op('get', '/api/v1/vault/items/{itemId}', { tags: ['Vault'], summary: 'Get vault item', parameters: [ref('parameters/VaultItemId')], responses: stdResponses() }),
    op('patch', '/api/v1/vault/items/{itemId}', { tags: ['Vault'], summary: 'Update vault item', parameters: [ref('parameters/VaultItemId')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('delete', '/api/v1/vault/items/{itemId}', { tags: ['Vault'], summary: 'Soft-delete vault item', parameters: [ref('parameters/VaultItemId')], responses: stdResponses() }),
    op('post', '/api/v1/vault/items/{itemId}/restore', { tags: ['Vault'], summary: 'Restore vault item from trash', parameters: [ref('parameters/VaultItemId')], responses: stdResponses() }),
    op('delete', '/api/v1/vault/items/{itemId}/permanent', { tags: ['Vault'], summary: 'Permanently delete vault item', parameters: [ref('parameters/VaultItemId')], responses: stdResponses() }),
    op('get', '/api/v1/vault/items/{itemId}/shares', { tags: ['Vault'], summary: 'List vault item shares', parameters: [ref('parameters/VaultItemId')], responses: stdResponses() }),
    op('post', '/api/v1/vault/items/{itemId}/shares', { tags: ['Vault'], summary: 'Share vault item', parameters: [ref('parameters/VaultItemId')], requestBody: jsonBody(ref('schemas/VaultShareRequest')), responses: stdResponses({ 201: successResponse('Share created') }) }),
    op('post', '/api/v1/vault/shares/{shareId}/revoke', { tags: ['Vault'], summary: 'Revoke vault share', parameters: [ref('parameters/ShareId')], responses: stdResponses() }),
    op('get', '/api/v1/vault/folders', { tags: ['Vault'], summary: 'List vault folders', parameters: [ref('parameters/ProfileIdHeader')], responses: stdResponses() }),
    op('post', '/api/v1/vault/folders', { tags: ['Vault'], summary: 'Create vault folder', parameters: [ref('parameters/ProfileIdHeader')], requestBody: jsonBody(ref('schemas/VaultFolderRequest')), responses: stdResponses({ 201: successResponse('Folder created') }) }),
    op('patch', '/api/v1/vault/folders/{folderId}', { tags: ['Vault'], summary: 'Update vault folder', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/FolderId')], requestBody: jsonBody({ type: 'object' }, false), responses: stdResponses() }),
    op('delete', '/api/v1/vault/folders/{folderId}', { tags: ['Vault'], summary: 'Delete vault folder', parameters: [ref('parameters/ProfileIdHeader'), ref('parameters/FolderId')], responses: stdResponses() })
  ];

  if (includeDev) {
    routes.push(
      op('get', '/api/v1/dev/seed-status', { tags: ['Development'], summary: 'Check seed status', security: [], responses: stdResponses() }),
      op('post', '/api/v1/dev/run-seed', { tags: ['Development'], summary: 'Run database seed', security: [], responses: stdResponses() }),
      op('post', '/api/v1/dev/provision-user', { tags: ['Development'], summary: 'Create test user', security: [], requestBody: jsonBody(ref('schemas/ProvisionUserRequest')), responses: stdResponses({ 201: successResponse('User provisioned') }) }),
      op('post', '/api/v1/dev/provision-user/{userId}', { tags: ['Development'], summary: 'Reprovision existing user', security: [], parameters: [ref('parameters/UserId')], responses: stdResponses() }),
      op('get', '/api/v1/dev/provision-user/{userId}/status', { tags: ['Development'], summary: 'Get provisioning status', security: [], parameters: [ref('parameters/UserId')], responses: stdResponses() })
    );
  }

  const paths = {};

  for (const route of routes) {
    const { method, path: routePath, security, ...operation } = route;

    if (!paths[routePath]) {
      paths[routePath] = {};
    }

    paths[routePath][method] = {
      ...operation,
      security: security === undefined ? [{ bearerAuth: [] }] : security
    };
  }

  return paths;
}

function buildOpenApiSpec(options = {}) {
  const includeDev = options.includeDev ?? !env.isProduction;

  return {
    openapi: '3.0.3',
    info: {
      title: 'FirstSavvy API',
      version: '1.0.0',
      description: [
        'FirstSavvy custom Node.js backend API.',
        '',
        '## Authentication',
        'Most endpoints require a Bearer access token in the `Authorization` header.',
        'Obtain tokens via `POST /api/v1/auth/login` or `POST /api/v1/auth/register`.',
        'Refresh tokens are stored in an HTTP-only cookie. Use `POST /api/v1/auth/refresh` to obtain a new access token.',
        'When an access token expires, the server may return refreshed tokens in response headers: `X-Access-Token`, `X-Token-Type`, `X-Token-Expires-In`.',
        '',
        '## Profile context',
        'Profile-scoped endpoints require a profile identifier via one of:',
        '- `X-Profile-Id` header (recommended)',
        '- `profileId` query parameter',
        '- `profileId` path parameter',
        '',
        '## Rate limiting',
        'Most API routes are rate limited per client IP via `express-rate-limit`.',
        'Configure with `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MS`, and `RATE_LIMIT_MAX`.',
        'Health checks and Swagger docs are excluded. When exceeded, the API returns `429 RATE_LIMITED`.',
        '',
        '## Response format',
        'All responses follow a consistent envelope:',
        '```json',
        '{ "success": true, "data": {}, "error": null }',
        '```',
        '',
        includeDev ? '**Note:** Development endpoints are included in this spec (non-production only).' : '**Note:** Development endpoints are excluded in production.'
      ].join('\n'),
      contact: {
        name: 'FirstSavvy Engineering'
      }
    },
    servers: [
      {
        url: `http://localhost:${env.port}`,
        description: 'Local development'
      }
    ],
    tags: [
      { name: 'General', description: 'Service metadata' },
      { name: 'Health', description: 'Health and readiness checks' },
      { name: 'Auth', description: 'Authentication and user session management' },
      { name: 'Dashboard', description: 'Dashboard aggregated data' },
      { name: 'Profiles', description: 'User and child profile management' },
      { name: 'Collaboration', description: 'Invitations and profile sharing' },
      { name: 'Contacts', description: 'Contact management and connections' },
      { name: 'Tasks', description: 'Child tasks and star rewards' },
      { name: 'Rewards', description: 'Reward catalog and redemptions' },
      { name: 'Accounts', description: 'Chart of accounts' },
      { name: 'Transactions', description: 'Financial transactions' },
      { name: 'Transfer Matching', description: 'Transfer pair matching' },
      { name: 'Transaction Rules', description: 'Auto-categorization rules' },
      { name: 'Banking', description: 'Banking utilities' },
      { name: 'Plaid', description: 'Plaid bank linking integration' },
      { name: 'Budgets', description: 'Budgets and analytics' },
      { name: 'Goals', description: 'Savings goals' },
      { name: 'Calendar', description: 'Recurring schedules and occurrences' },
      { name: 'Notifications', description: 'In-app notifications' },
      { name: 'Files', description: 'File storage (S3 presigned URLs)' },
      { name: 'Search', description: 'Global search' },
      { name: 'Net Worth', description: 'Net worth summary' },
      { name: 'Credit Score', description: 'Credit score monitoring and identity verification (mock provider in development)' },
      { name: 'View Preferences', description: 'Saved UI view preferences' },
      { name: 'CSV Mapping', description: 'CSV import column mapping' },
      { name: 'Protected Configurations', description: 'Versioned protected configs' },
      { name: 'Journal Entries', description: 'Double-entry journal entries' },
      { name: 'Vault', description: 'Secure credential vault' },
      ...(includeDev ? [{ name: 'Development', description: 'Development-only utilities (non-production)' }] : [])
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token from login/register/refresh'
        }
      },
      parameters: {
        ProfileIdHeader: {
          name: 'X-Profile-Id',
          in: 'header',
          description: 'Active profile UUID for profile-scoped operations',
          schema: { type: 'string', format: 'uuid' }
        },
        ProfileId: {
          name: 'profileId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        ChildId: {
          name: 'childId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        ContactId: {
          name: 'contactId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        AccountId: {
          name: 'accountId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        TransactionId: {
          name: 'transactionId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        TaskId: {
          name: 'taskId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        CompletionId: {
          name: 'completionId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        RewardId: {
          name: 'rewardId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        RedemptionId: {
          name: 'redemptionId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        RuleId: {
          name: 'ruleId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        BudgetId: {
          name: 'budgetId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        GoalId: {
          name: 'goalId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        ContributionId: {
          name: 'contributionId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        ScheduleId: {
          name: 'scheduleId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        OccurrenceId: {
          name: 'occurrenceId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        NotificationId: {
          name: 'notificationId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        CalendarNotificationId: {
          name: 'notificationId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        EntryId: {
          name: 'entryId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        AttachmentId: {
          name: 'attachmentId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        VaultItemId: {
          name: 'itemId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        FolderId: {
          name: 'folderId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        ConfigId: {
          name: 'configId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        ConfigName: {
          name: 'name',
          in: 'path',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 100 }
        },
        ViewName: {
          name: 'viewName',
          in: 'path',
          required: true,
          schema: { type: 'string', maxLength: 100 }
        },
        CategoryAccountId: {
          name: 'categoryAccountId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        InvitationToken: {
          name: 'token',
          in: 'path',
          required: true,
          schema: { type: 'string', maxLength: 255 }
        },
        InvitationId: {
          name: 'invitationId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        ShareId: {
          name: 'shareId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        UserId: {
          name: 'userId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        },
        Page: {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 1, default: 1 }
        },
        Limit: {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      },
      responses: {
        BadRequest: {
          description: 'Validation failed or bad request',
          content: {
            'application/json': {
              schema: ref('schemas/ApiErrorResponse'),
              example: {
                success: false,
                data: null,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Validation failed',
                  details: [{ location: 'body', field: 'email', message: 'Required field is missing' }]
                }
              }
            }
          }
        },
        Unauthorized: {
          description: 'Authentication required or token invalid/expired',
          content: {
            'application/json': {
              schema: ref('schemas/ApiErrorResponse'),
              example: {
                success: false,
                data: null,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required', details: null }
              }
            }
          }
        },
        Forbidden: {
          description: 'Insufficient permissions',
          content: {
            'application/json': {
              schema: ref('schemas/ApiErrorResponse'),
              example: {
                success: false,
                data: null,
                error: { code: 'PROFILE_ACCESS_DENIED', message: 'Profile access denied', details: null }
              }
            }
          }
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: ref('schemas/ApiErrorResponse')
            }
          }
        },
        Conflict: {
          description: 'Resource conflict',
          content: {
            'application/json': {
              schema: ref('schemas/ApiErrorResponse')
            }
          }
        },
        TooManyRequests: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: ref('schemas/ApiErrorResponse'),
              example: {
                success: false,
                data: null,
                error: {
                  code: 'RATE_LIMITED',
                  message: 'Too many requests. Please try again later.',
                  details: null
                }
              }
            }
          }
        },
        InternalError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: ref('schemas/ApiErrorResponse')
            }
          }
        }
      },
      schemas: {
        ApiSuccessResponse: {
          type: 'object',
          required: ['success', 'data', 'error'],
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object', additionalProperties: true },
            error: { type: 'null', example: null }
          }
        },
        ApiErrorResponse: {
          type: 'object',
          required: ['success', 'data', 'error'],
          properties: {
            success: { type: 'boolean', example: false },
            data: { type: 'null', example: null },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { nullable: true },
                requestId: { type: 'string' }
              }
            }
          }
        },
        ProfileType: {
          type: 'string',
          enum: ['personal', 'household', 'business', 'real_estate', 'passive', 'holding_company']
        },
        AccountClass: {
          type: 'string',
          enum: ['asset', 'liability', 'equity', 'income', 'expense']
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            fullName: { type: 'string', maxLength: 255 },
            password: { type: 'string', minLength: 8 },
            profileType: { $ref: '#/components/schemas/ProfileType' }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' }
          }
        },
        ChildLoginRequest: {
          type: 'object',
          required: ['usernameOrEmail', 'pin'],
          properties: {
            usernameOrEmail: { type: 'string', minLength: 3, maxLength: 320 },
            pin: { type: 'string', minLength: 4, maxLength: 6 }
          }
        },
        ChangePasswordRequest: {
          type: 'object',
          required: ['newPassword'],
          properties: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8 }
          }
        },
        ForgotPasswordRequest: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' }
          }
        },
        ResetPasswordRequest: {
          type: 'object',
          required: ['token', 'password'],
          properties: {
            token: { type: 'string', minLength: 20 },
            password: { type: 'string', minLength: 8 }
          }
        },
        CreateProfileRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            displayName: { type: 'string' },
            profileType: { $ref: '#/components/schemas/ProfileType' },
            familyRole: { type: 'string' },
            color: { type: 'string' }
          }
        },
        UpdateProfileRequest: {
          type: 'object',
          properties: {
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            display_name: { type: 'string' },
            familyRole: { type: 'string' },
            color: { type: 'string' },
            phone: { type: 'string' },
            bio: { type: 'string' }
          }
        },
        CreateChildProfileRequest: {
          type: 'object',
          required: ['first_name', 'last_name', 'username'],
          properties: {
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            username: { type: 'string' },
            pin: { type: 'string' },
            email: { type: 'string', format: 'email' }
          }
        },
        ChildProfileUpdate: {
          type: 'object',
          properties: {
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            username: { type: 'string' },
            pin: { type: 'string' },
            login_enabled: { type: 'boolean' }
          }
        },
        AcceptInvitationRequest: {
          type: 'object',
          required: ['password'],
          properties: {
            password: { type: 'string', minLength: 8 },
            fullName: { type: 'string' },
            full_name: { type: 'string' }
          }
        },
        CreateInvitationRequest: {
          type: 'object',
          properties: {
            invitedEmail: { type: 'string', format: 'email' },
            invited_email: { type: 'string', format: 'email' },
            inviterName: { type: 'string' },
            familyRole: { type: 'string' }
          }
        },
        ResendInvitationRequest: {
          type: 'object',
          properties: {
            inviterName: { type: 'string' },
            familyRole: { type: 'string' }
          }
        },
        CreateShareRequest: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            sharedWithProfileId: { type: 'string', format: 'uuid' },
            permissionLevel: { type: 'string', enum: ['view_only', 'editor', 'co_parent'] }
          }
        },
        ContactRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            group_name: { type: 'string' },
            notes: { type: 'string' },
            color: { type: 'string' }
          }
        },
        CreateTaskRequest: {
          type: 'object',
          required: ['assigned_to_child_id', 'title'],
          properties: {
            assigned_to_child_id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            points_value: { type: 'number' },
            star_reward: { type: 'number' },
            due_date: { type: 'string', format: 'date' },
            requires_approval: { type: 'boolean' }
          }
        },
        UpdateTaskRequest: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
            star_reward: { type: 'number' }
          }
        },
        CreateRewardRequest: {
          type: 'object',
          required: ['assigned_to_child_id', 'title', 'star_cost'],
          properties: {
            assigned_to_child_id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            star_cost: { type: 'number' },
            description: { type: 'string' }
          }
        },
        UpdateRewardRequest: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            star_cost: { type: 'number' },
            description: { type: 'string' },
            remove_image: { type: 'boolean' }
          }
        },
        AccountRequest: {
          type: 'object',
          required: ['class'],
          properties: {
            class: { $ref: '#/components/schemas/AccountClass' },
            name: { type: 'string' },
            display_name: { type: 'string' },
            account_type: { type: 'string' },
            current_balance: { type: 'number' },
            is_active: { type: 'boolean' }
          }
        },
        ActivateTemplateRequest: {
          type: 'object',
          properties: {
            templateAccountNumber: { type: 'number' },
            template_account_number: { type: 'number' },
            displayName: { type: 'string' },
            initialBalance: { type: 'number' },
            institutionName: { type: 'string' }
          }
        },
        TransactionRequest: {
          type: 'object',
          required: ['date', 'description', 'amount'],
          properties: {
            date: { type: 'string', format: 'date' },
            description: { type: 'string' },
            amount: { type: 'number' },
            bank_account_id: { type: 'string', format: 'uuid' },
            category_account_id: { type: 'string', format: 'uuid' },
            contact_id: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
            transaction_type: { type: 'string' }
          }
        },
        CreateGoalRequest: {
          type: 'object',
          required: ['name', 'target_amount', 'linked_account_id'],
          properties: {
            name: { type: 'string' },
            target_amount: { type: 'number' },
            linked_account_id: { type: 'string', format: 'uuid' },
            target_date: { type: 'string', format: 'date' },
            description: { type: 'string' }
          }
        },
        CreateScheduleRequest: {
          type: 'object',
          required: ['schedule_type', 'cadence', 'title', 'start_date'],
          properties: {
            schedule_type: { type: 'string' },
            cadence: { type: 'string' },
            title: { type: 'string' },
            start_date: { type: 'string', format: 'date' },
            amount: { type: 'number' },
            end_date: { type: 'string', format: 'date' }
          }
        },
        PresignedUploadRequest: {
          type: 'object',
          required: ['category', 'fileName'],
          properties: {
            category: { type: 'string' },
            profileId: { type: 'string', format: 'uuid' },
            fileName: { type: 'string' },
            contentType: { type: 'string' },
            fileSize: { type: 'integer' }
          }
        },
        VaultItemRequest: {
          type: 'object',
          required: ['category', 'name'],
          properties: {
            category: { type: 'string', enum: ['login', 'card', 'note', 'identity'] },
            name: { type: 'string' },
            folder_id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            password: { type: 'string' },
            notes: { type: 'string' }
          }
        },
        VaultShareRequest: {
          type: 'object',
          required: ['permission'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            permission: { type: 'string', enum: ['view', 'edit'] },
            expires_at: { type: 'string', format: 'date-time' }
          }
        },
        VaultFolderRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            icon: { type: 'string' },
            color: { type: 'string' },
            parent_folder_id: { type: 'string', format: 'uuid' }
          }
        },
        ProvisionUserRequest: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            fullName: { type: 'string' },
            password: { type: 'string', minLength: 8 },
            profileType: { type: 'string' }
          }
        },
        CreditVerificationAddress: {
          type: 'object',
          required: ['street', 'city', 'state', 'zip'],
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            zip: { type: 'string' }
          }
        },
        CreditVerifyRequest: {
          type: 'object',
          required: ['full_legal_name', 'date_of_birth', 'ssn_last4', 'address'],
          properties: {
            full_legal_name: { type: 'string', maxLength: 255, example: 'Jane Doe' },
            date_of_birth: { type: 'string', format: 'date', example: '1990-01-15' },
            ssn_last4: { type: 'string', pattern: '^\\d{4}$', example: '1234' },
            address: { $ref: '#/components/schemas/CreditVerificationAddress' }
          }
        },
        CreditVerificationResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['pending', 'verified', 'failed', 'expired'] }
          }
        },
        CreditStatusResponse: {
          type: 'object',
          properties: {
            verified: { type: 'boolean' },
            verification_status: { type: 'string', enum: ['pending', 'verified', 'failed', 'expired'], nullable: true },
            last_pulled_at: { type: 'string', format: 'date-time', nullable: true },
            next_refresh_available_at: { type: 'string', format: 'date-time', nullable: true },
            can_refresh: { type: 'boolean' }
          }
        },
        CreditScoreFactorStatus: {
          type: 'string',
          enum: ['excellent', 'good', 'fair', 'poor']
        },
        CreditScoreFactors: {
          type: 'object',
          properties: {
            payment_history: {
              type: 'object',
              properties: {
                value_pct: { type: 'integer' },
                status: { $ref: '#/components/schemas/CreditScoreFactorStatus' }
              }
            },
            credit_utilization: {
              type: 'object',
              properties: {
                value_pct: { type: 'integer' },
                status: { $ref: '#/components/schemas/CreditScoreFactorStatus' }
              }
            },
            credit_history_length: {
              type: 'object',
              properties: {
                value_years: { type: 'integer' },
                status: { $ref: '#/components/schemas/CreditScoreFactorStatus' }
              }
            },
            new_inquiries: {
              type: 'object',
              properties: {
                count: { type: 'integer' },
                status: { $ref: '#/components/schemas/CreditScoreFactorStatus' }
              }
            },
            credit_mix: {
              type: 'object',
              properties: {
                status: { $ref: '#/components/schemas/CreditScoreFactorStatus' }
              }
            }
          }
        },
        CreditScoreResponse: {
          type: 'object',
          properties: {
            score: { type: 'integer', minimum: 300, maximum: 850 },
            score_band: { type: 'string', enum: ['poor', 'fair', 'good', 'very_good', 'exceptional'] },
            bureau: { type: 'string', example: 'mock' },
            factors: { $ref: '#/components/schemas/CreditScoreFactors' },
            pulled_at: { type: 'string', format: 'date-time' }
          }
        },
        CreditHistoryPoint: {
          type: 'object',
          properties: {
            score: { type: 'integer', minimum: 300, maximum: 850 },
            pulled_at: { type: 'string', format: 'date-time' }
          }
        },
        CreditHistoryResponse: {
          type: 'object',
          properties: {
            history: {
              type: 'array',
              items: { $ref: '#/components/schemas/CreditHistoryPoint' }
            }
          }
        }
      }
    },
    paths: buildPaths(includeDev)
  };
}

module.exports = { buildOpenApiSpec };
