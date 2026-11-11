const { env } = require('../../config/env');

const adminExample = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'MAK',
  email: 'admin@example.com',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  permissions: [],
  created_by_id: null,
  last_login_at: '2026-11-10T20:00:00.000Z',
  created_at: '2026-11-10T20:00:00.000Z',
  updated_at: '2026-11-10T20:00:00.000Z'
};

const sessionExample = {
  accessToken: 'your.admin-access-token',
  tokenType: 'Bearer',
  expiresIn: 900
};

function successExample(data) {
  return {
    success: true,
    data,
    error: null
  };
}

function errorExample(code, message, details = null) {
  return {
    success: false,
    data: null,
    error: { code, message, details, requestId: 'request-id' }
  };
}

function jsonResponse(description, example) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiResponse' },
        example
      }
    }
  };
}

function errorResponses(overrides = {}) {
  const responses = {
    400: jsonResponse('Invalid request body.', errorExample('VALIDATION_FAILED', 'Please enter your name.', [
      { location: 'body', field: 'name', message: 'Name is required.' }
    ])),
    401: jsonResponse('Missing or invalid credentials/token.', errorExample('UNAUTHORIZED', 'Authentication required.')),
    403: jsonResponse('Authenticated admin does not have the required role.', errorExample('FORBIDDEN', 'You do not have permission to perform this action.')),
    409: jsonResponse('An admin with this email already exists, or setup has already completed.', errorExample('CONFLICT', 'Super Admin has already been created.')),
    429: jsonResponse('Too many requests.', errorExample('RATE_LIMITED', 'Too many attempts. Please try again in 15 minutes.')),
    500: jsonResponse('Unexpected server error.', errorExample('INTERNAL_ERROR', 'Internal server error')),
    ...overrides
  };

  return Object.fromEntries(
    Object.entries(responses).filter(([, response]) => response !== undefined)
  );
}

function body(schema) {
  return {
    required: true,
    content: { 'application/json': { schema } }
  };
}

function buildAdminOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'FirstSavvy Admin API',
      version: '1.0.0',
      description: [
        'Isolated documentation for admin-only APIs. These endpoints use admin-scoped tokens and never accept customer-user access tokens.',
        'Set ADMIN_BOOTSTRAP_SECRET to a unique random value of at least 32 characters before using the one-time setup endpoint. Do not send secrets over plain HTTP.'
      ].join('\n\n')
    },
    servers: [{ url: `http://localhost:${env.port}`, description: 'Local development' }],
    tags: [{ name: 'Admin Auth' }, { name: 'Admin Management' }],
    paths: {
      '/api/v1/admin/setup-super-admin': {
        post: {
          tags: ['Admin Auth'],
          summary: 'Create the first and only Super Admin',
          description: 'One-time bootstrap. The server fixes role, status, permissions, and creator. A successful response sets an HttpOnly admin refresh cookie.',
          security: [],
          requestBody: body({ $ref: '#/components/schemas/SetupSuperAdminRequest' }),
          responses: {
            201: jsonResponse('Super Admin created.', successExample({ admin: adminExample, session: sessionExample })),
            ...errorResponses({
              401: jsonResponse('Bootstrap secret is missing or incorrect.', errorExample('UNAUTHORIZED', 'Invalid admin bootstrap secret.')),
              403: undefined,
              503: jsonResponse('Bootstrap secret is not configured on the server.', errorExample('SERVICE_UNAVAILABLE', 'Admin bootstrap is not configured.'))
            })
          }
        }
      },
      '/api/v1/admin/login': {
        post: {
          tags: ['Admin Auth'],
          summary: 'Sign in an active admin',
          description: 'Returns a short-lived admin access token and sets the HttpOnly admin refresh cookie.',
          security: [],
          requestBody: body({ $ref: '#/components/schemas/AdminLoginRequest' }),
          responses: {
            200: jsonResponse('Admin signed in.', successExample({ admin: adminExample, session: sessionExample })),
            ...errorResponses({
              401: jsonResponse('Credentials are invalid or the account is inactive.', errorExample('INVALID_CREDENTIALS', 'Invalid admin email or password.')),
              403: undefined,
              409: undefined
            })
          }
        }
      },
      '/api/v1/admin/refresh': {
        post: {
          tags: ['Admin Auth'],
          summary: 'Refresh admin access token',
          description: 'Reads the HttpOnly firstsavvy_admin_refresh cookie and rotates the session version, invalidating the old access and refresh tokens. Customer-user refresh cookies/tokens are not accepted.',
          security: [{ adminRefreshCookie: [] }],
          responses: {
            200: jsonResponse('Admin session refreshed.', successExample({ admin: adminExample, session: sessionExample })),
            ...errorResponses({
              400: undefined,
              403: undefined,
              409: undefined
            })
          }
        }
      },
      '/api/v1/admin/logout': {
        post: {
          tags: ['Admin Auth'],
          summary: 'Invalidate all sessions for the current admin',
          security: [{ adminBearerAuth: [] }],
          responses: {
            200: jsonResponse('Admin logged out and sessions invalidated.', successExample({ message: 'Admin logged out successfully.' })),
            ...errorResponses({ 400: undefined, 403: undefined, 409: undefined })
          }
        }
      },
      '/api/v1/admin/me': {
        get: {
          tags: ['Admin Auth'],
          summary: 'Get the current admin identity',
          security: [{ adminBearerAuth: [] }],
          responses: {
            200: jsonResponse('Current admin.', successExample({ admin: adminExample })),
            ...errorResponses({ 400: undefined, 403: undefined, 409: undefined })
          }
        }
      },
      '/api/v1/admin/sub-admins': {
        post: {
          tags: ['Admin Management'],
          summary: 'Create a Sub Admin',
          description: 'Requires an active Super Admin. Role, status, permissions, and creator are assigned by the server; permissions default to an empty array.',
          security: [{ adminBearerAuth: [] }],
          requestBody: body({ $ref: '#/components/schemas/CreateSubAdminRequest' }),
          responses: {
            201: jsonResponse('Sub Admin created.', successExample({
              admin: { ...adminExample, id: '650e8400-e29b-41d4-a716-446655440000', role: 'SUB_ADMIN', created_by_id: adminExample.id }
            })),
            ...errorResponses({
              401: jsonResponse('Missing, invalid, expired, or inactive admin session.', errorExample('UNAUTHORIZED', 'Admin authentication required.')),
              403: jsonResponse('A Sub Admin cannot create admins.', errorExample('FORBIDDEN', 'You do not have permission to perform this action.')),
              409: jsonResponse('Admin email is already in use.', errorExample('CONFLICT', 'A record with the same unique value already exists'))
            })
          }
        }
      }
    },
    components: {
      securitySchemes: {
        adminBearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        adminRefreshCookie: { type: 'apiKey', in: 'cookie', name: 'firstsavvy_admin_refresh' }
      },
      schemas: {
        ApiResponse: {
          type: 'object',
          required: ['success', 'data', 'error'],
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', nullable: true },
            error: { type: 'object', nullable: true }
          }
        },
        SetupSuperAdminRequest: {
          type: 'object',
          required: ['secret_key', 'name', 'email', 'password'],
          properties: {
            secret_key: { type: 'string', minLength: 32, description: 'Must match ADMIN_BOOTSTRAP_SECRET configured on the server.' },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            email: { type: 'string', format: 'email', maxLength: 320 },
            password: { type: 'string', minLength: 8, maxLength: 72, description: 'Maximum 72 UTF-8 bytes (bcrypt limit).' }
          },
          additionalProperties: false
        },
        AdminLoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 72 }
          },
          additionalProperties: false
        },
        CreateSubAdminRequest: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            email: { type: 'string', format: 'email', maxLength: 320 },
            password: { type: 'string', minLength: 8, maxLength: 72, description: 'Maximum 72 UTF-8 bytes (bcrypt limit).' }
          },
          additionalProperties: false
        },
        Admin: {
          type: 'object',
          required: ['id', 'name', 'email', 'role', 'status', 'permissions'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['SUPER_ADMIN', 'SUB_ADMIN'] },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
            permissions: { type: 'array', items: { type: 'string' }, example: [] },
            created_by_id: { type: 'string', format: 'uuid', nullable: true },
            last_login_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        AdminSession: {
          type: 'object',
          required: ['accessToken', 'tokenType', 'expiresIn'],
          properties: {
            accessToken: { type: 'string', description: 'Admin-scoped bearer access token.' },
            tokenType: { type: 'string', example: 'Bearer' },
            expiresIn: { type: 'integer', example: env.accessTokenTtlSeconds }
          }
        }
      }
    }
  };
}

module.exports = { buildAdminOpenApiSpec };
