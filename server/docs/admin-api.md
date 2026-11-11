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

## Other admin session routes

| Method & URL | Headers / body | Success |
|---|---|---|
| `GET {{baseUrl}}/api/v1/admin/me` | `Authorization: Bearer {{adminAccessToken}}` | `200`, `data.admin` contains the current sanitized admin |
| `POST {{baseUrl}}/api/v1/admin/refresh` | Postman sends the `firstsavvy_admin_refresh` cookie; no JSON body | `200`, returns a new access token and resets the HttpOnly refresh cookie |
| `POST {{baseUrl}}/api/v1/admin/logout` | `Authorization: Bearer {{adminAccessToken}}` | `200`, invalidates all existing sessions for that admin and clears the refresh cookie |

These routes return `401` for missing, expired, invalid, revoked, or wrong-type tokens. Refresh is rate-limited. Logout invalidates the current access token immediately because each protected request checks the admin's current token version in the database.
