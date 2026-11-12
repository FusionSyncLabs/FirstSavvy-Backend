# Admin API (Postman)

The admin API is isolated from customer authentication and documentation.

- Swagger UI: `GET /api-docs/admin`
- Base URL (local): `http://localhost:5000`
- Admin endpoints: `/api/v1/admin/...`
- All request bodies use `Content-Type: application/json`.
- Admin protected routes require `Authorization: Bearer <admin-access-token>`. Customer-user access tokens are not accepted.
- Setup, login, and refresh set the HttpOnly `firstsavvy_admin_refresh` cookie, scoped to `/api/v1/admin`. Postman should retain the cookie between requests. The refresh token is never returned in JSON.
- Configure `ADMIN_BOOTSTRAP_SECRET` as a random secret of at least 32 characters in the deployment secret manager. Use HTTPS and do not put a real secret in source control or shared Postman collections.
- Responses use the common envelope:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

Error responses use:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please enter your name.",
    "details": [
      {
        "location": "body",
        "field": "name",
        "message": "Name is required."
      }
    ],
    "requestId": "request-id"
  }
}
```

`requestId` may be `null`; values shown below are examples.

## 1. One-time Super Admin bootstrap

**Method & URL:** `POST {{baseUrl}}/api/v1/admin/setup-super-admin`

**Headers**

```http
Content-Type: application/json
```

No Authorization token is used. This route requires the server-side bootstrap secret in the request body and is rate-limited.

**Request body**

```json
{
  "secret_key": "{{adminBootstrapSecret}}",
  "name": "MAK",
  "email": "super-admin@example.com",
  "password": "{{superAdminPassword}}"
}
```

The server always creates `role: "SUPER_ADMIN"`, `status: "ACTIVE"`, `permissions: []`, and `created_by_id: null`. Do not send those fields. Passwords must be at least 8 characters and no more than 72 UTF-8 bytes.

**Success: `201 Created`** (also sets the HttpOnly admin refresh cookie)

```json
{
  "success": true,
  "data": {
    "admin": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "MAK",
      "email": "super-admin@example.com",
      "role": "SUPER_ADMIN",
      "status": "ACTIVE",
      "permissions": [],
      "created_by_id": null,
      "last_login_at": null,
      "created_at": "2026-11-10T20:00:00.000Z",
      "updated_at": "2026-11-10T20:00:00.000Z"
    },
    "session": {
      "accessToken": "<admin-access-token>",
      "tokenType": "Bearer",
      "expiresIn": 900
    }
  },
  "error": null
}
```

**Errors**

- `400 Bad Request`: invalid or missing request fields; uses the common error envelope with `code: "VALIDATION_FAILED"`.
- `401 Unauthorized`: wrong bootstrap secret; `{"success":false,"data":null,"error":{"code":"UNAUTHORIZED","message":"Invalid admin bootstrap secret.","details":null,"requestId":"request-id"}}`
- `409 Conflict`: setup was already completed; same envelope with `code: "CONFLICT"` and message `"Super Admin has already been created."`
- `429 Too Many Requests`: rate limit exceeded.
- `503 Service Unavailable`: `ADMIN_BOOTSTRAP_SECRET` is absent or shorter than 32 characters.

## 2. Admin login

**Method & URL:** `POST {{baseUrl}}/api/v1/admin/login`

**Headers**

```http
Content-Type: application/json
```

**Request body**

```json
{
  "email": "super-admin@example.com",
  "password": "{{superAdminPassword}}"
}
```

**Success: `200 OK`** (also sets the HttpOnly admin refresh cookie)

```json
{
  "success": true,
  "data": {
    "admin": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "MAK",
      "email": "super-admin@example.com",
      "role": "SUPER_ADMIN",
      "status": "ACTIVE",
      "permissions": [],
      "created_by_id": null,
      "last_login_at": "2026-11-10T20:00:00.000Z",
      "created_at": "2026-11-10T20:00:00.000Z",
      "updated_at": "2026-11-10T20:00:00.000Z"
    },
    "session": {
      "accessToken": "<admin-access-token>",
      "tokenType": "Bearer",
      "expiresIn": 900
    }
  },
  "error": null
}
```

**Errors**

- `400 Bad Request`: invalid or missing request fields.
- `401 Unauthorized`: wrong credentials or inactive/deleted admin; response message is `"Invalid admin email or password."`
- `429 Too Many Requests`: rate limit exceeded.

## 3. Create a Sub Admin

**Method & URL:** `POST {{baseUrl}}/api/v1/admin/sub-admins`

**Headers**

```http
Content-Type: application/json
Authorization: Bearer {{adminAccessToken}}
```

Only an active Super Admin can call this route.

**Request body**

```json
{
  "name": "Support Admin",
  "email": "support-admin@example.com",
  "password": "{{subAdminPassword}}"
}
```

The server always sets `role: "SUB_ADMIN"`, `status: "ACTIVE"`, `permissions: []`, and `created_by_id` to the authenticated Super Admin. Client-supplied role, status, permissions, or creator are never used.

**Success: `201 Created`**

```json
{
  "success": true,
  "data": {
    "admin": {
      "id": "650e8400-e29b-41d4-a716-446655440000",
      "name": "Support Admin",
      "email": "support-admin@example.com",
      "role": "SUB_ADMIN",
      "status": "ACTIVE",
      "permissions": [],
      "created_by_id": "550e8400-e29b-41d4-a716-446655440000",
      "last_login_at": null,
      "created_at": "2026-11-10T20:00:00.000Z",
      "updated_at": "2026-11-10T20:00:00.000Z"
    }
  },
  "error": null
}
```

**Errors**

- `400 Bad Request`: missing or invalid name/email/password.
- `401 Unauthorized`: bearer token is missing, invalid, expired, a customer-user token, or belongs to an inactive admin.
- `403 Forbidden`: valid Sub Admin token; only a Super Admin may create Sub Admins.
- `409 Conflict`: an admin with that email already exists.

Example `400 Bad Request`:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please enter your email address.",
    "details": [
      {
        "location": "body",
        "field": "email",
        "message": "Please enter your email address."
      }
    ],
    "requestId": "request-id"
  }
}
```

Example `401 Unauthorized`:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Admin authentication required.",
    "details": null,
    "requestId": "request-id"
  }
}
```

Example `403 Forbidden`:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action.",
    "details": null,
    "requestId": "request-id"
  }
}
```

## 4. Get all users by Admin

**Method & URL:** `GET {{baseUrl}}/api/v1/admin/users`

Only an active Super Admin can call this endpoint. Users with at least one non-deleted referral are ordered first. Deleted users and deleted referral records are omitted; their database rows are retained.

**Headers**

```http
Authorization: Bearer {{adminAccessToken}}
Accept: application/json
```

**Query parameters**

| Name | Type | Required | Default | Limits |
|---|---|---:|---:|---|
| `page` | integer | No | `1` | Must be at least `1` |
| `limit` | integer | No | `20` | `1` to `100` |

Example: `GET {{baseUrl}}/api/v1/admin/users?page=1&limit=20`

No request body is sent.

**Success: `200 OK`**

Each user contains safe account/profile fields and a `referrals` array. Each referral's `current_uses` is the stored count; `used_by_count` is the number of IDs recorded in `used_by`. Referred-user records are fetched from the separate paginated endpoint below.

```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "email": "user@example.com",
        "full_name": "Sample User",
        "user_name": "sample-user",
        "unique_id": "USR-1001",
        "avatar_url": null,
        "phone_number": null,
        "phone_verified_at": null,
        "verified_at": "2026-11-10T20:00:00.000Z",
        "referral_code": null,
        "created_at": "2026-11-10T20:00:00.000Z",
        "updated_at": "2026-11-10T20:00:00.000Z",
        "has_password": true,
        "auth_provider": "password",
        "has_referral": true,
        "referrals": [
          {
            "id": "650e8400-e29b-41d4-a716-446655440000",
            "code": "ReferralCode123",
            "short_id": "Ab12Cd34",
            "status": "active",
            "current_uses": 3,
            "used_by_count": 3,
            "max_uses": null,
            "expires_at": null,
            "description": null,
            "created_at": "2026-11-10T20:00:00.000Z",
            "updated_at": "2026-11-10T20:00:00.000Z"
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  },
  "error": null
}
```

**Errors**

- `400 Bad Request`: invalid page or limit. Example for `limit=101`:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Limit must be a positive integer within allowed bounds",
    "details": [
      {
        "location": "query",
        "field": "limit",
        "message": "Limit must be between 1 and 100"
      }
    ],
    "requestId": "request-id"
  }
}
```

- `401 Unauthorized`: missing, invalid, expired, revoked, or customer-user token. Example:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Admin authentication required.",
    "details": null,
    "requestId": "request-id"
  }
}
```

- `403 Forbidden`: valid Sub Admin token; only Super Admin is allowed. Uses the common error envelope with `code: "FORBIDDEN"`.

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action.",
    "details": null,
    "requestId": "request-id"
  }
}
```

There is no `201 Created` response because this is a read-only `GET` endpoint.

## 5. Get referred users by Admin

**Method & URL:** `GET {{baseUrl}}/api/v1/admin/users/{{userId}}/referrals/{{referralId}}/users`

`userId` is the referral owner ID; `referralId` is that owner's referral ID. The endpoint verifies that the referral belongs to the supplied owner. Deleted users/referrals and deleted referred-user records are omitted; rows remain in the database.

**Headers**

```http
Authorization: Bearer {{adminAccessToken}}
Accept: application/json
```

**Query parameters**

| Name | Type | Required | Default | Limits |
|---|---|---:|---:|---|
| `page` | integer | No | `1` | Must be at least `1` |
| `limit` | integer | No | `20` | `1` to `100` |

Example: `GET {{baseUrl}}/api/v1/admin/users/550e8400-e29b-41d4-a716-446655440000/referrals/650e8400-e29b-41d4-a716-446655440000/users?page=1&limit=20`

No request body is sent.

**Success: `200 OK`**

```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "750e8400-e29b-41d4-a716-446655440000",
        "email": "referred@example.com",
        "full_name": "Referred User",
        "user_name": "referred-user",
        "unique_id": "USR-1002",
        "avatar_url": null,
        "phone_number": null,
        "phone_verified_at": null,
        "verified_at": null,
        "referral_code": "ReferralCode123",
        "created_at": "2026-11-11T20:00:00.000Z",
        "updated_at": "2026-11-11T20:00:00.000Z",
        "has_password": true,
        "auth_provider": "password"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  },
  "error": null
}
```

The response includes the full admin-visible profile fields, but never password hashes, password-reset/refresh tokens, Google IDs, or two-factor secrets.

**Errors**

- `400 Bad Request`: malformed owner/referral UUID or invalid page/limit. Example for an invalid `userId`:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please provide a valid ID.",
    "details": [
      {
        "location": "params",
        "field": "userId",
        "message": "Please provide a valid ID."
      }
    ],
    "requestId": "request-id"
  }
}
```

- `401 Unauthorized`: missing, invalid, expired, revoked, or customer-user token. Example:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Admin authentication required.",
    "details": null,
    "requestId": "request-id"
  }
}
```

- `403 Forbidden`: valid Sub Admin token; only Super Admin is allowed. Example:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action.",
    "details": null,
    "requestId": "request-id"
  }
}
```

- `404 Not Found`: owner/referral is deleted or missing, or the referral does not belong to the supplied owner. Example:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "Referral was not found for this user.",
    "details": null,
    "requestId": "request-id"
  }
}
```

There is no `201 Created` response because this is a read-only `GET` endpoint.

## Other admin session routes

| Method & URL | Headers / body | Success |
|---|---|---|
| `GET {{baseUrl}}/api/v1/admin/me` | `Authorization: Bearer {{adminAccessToken}}` | `200`, `data.admin` contains the current sanitized admin |
| `POST {{baseUrl}}/api/v1/admin/refresh` | Postman sends the `firstsavvy_admin_refresh` cookie; no JSON body | `200`, returns a new access token and resets the HttpOnly refresh cookie |
| `POST {{baseUrl}}/api/v1/admin/logout` | `Authorization: Bearer {{adminAccessToken}}` | `200`, invalidates all existing sessions for that admin and clears the refresh cookie |

These routes return `401` for missing, expired, invalid, revoked, or wrong-type tokens. Refresh is rate-limited. Logout invalidates the current access token immediately because each protected request checks the admin's current token version in the database.
