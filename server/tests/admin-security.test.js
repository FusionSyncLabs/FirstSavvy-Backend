process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/admin_security_test';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { after, before, test } = require('node:test');
const { prisma } = require('../config/database');
const { env } = require('../config/env');
const { errorHandler } = require('../middleware/errorHandler');
const { signJwt } = require('../utils/tokens');
const adminRoutes = require('../routes/v1/admin/admin.routes');

const superAdminId = '550e8400-e29b-41d4-a716-446655440000';
const subAdminId = '550e8400-e29b-41d4-a716-446655440001';
const referralOwnerId = '550e8400-e29b-41d4-a716-446655440002';
const referralId = '550e8400-e29b-41d4-a716-446655440003';
const originalFindUnique = prisma.admin.findUnique;
const originalCreate = prisma.admin.create;
const createdRecords = [];
const adminsById = new Map([
  [superAdminId, {
    id: superAdminId,
    email: 'super-admin@example.com',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    deleted_at: null,
    refresh_token_version: 1
  }],
  [subAdminId, {
    id: subAdminId,
    email: 'sub-admin@example.com',
    role: 'SUB_ADMIN',
    status: 'ACTIVE',
    deleted_at: null,
    refresh_token_version: 1
  }]
]);

prisma.admin.findUnique = async ({ where }) => adminsById.get(where.id) || null;
prisma.admin.create = async ({ data }) => {
  const record = {
    id: crypto.randomUUID(),
    ...data,
    created_at: new Date(),
    updated_at: new Date(),
    last_login_at: null
  };
  createdRecords.push(record);
  return record;
};

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRoutes);
app.use(errorHandler);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/admin`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  prisma.admin.findUnique = originalFindUnique;
  prisma.admin.create = originalCreate;
  assert.equal(createdRecords.length, 1, 'Only the valid sub-admin request should create a record');
});

function authorization(adminId) {
  const token = signJwt({
    sub: adminId,
    type: 'admin_access',
    tokenVersion: 1
  }, env.jwtAccessSecret, 60);
  return { authorization: `Bearer ${token}` };
}

async function postSubAdmin(adminId, body) {
  return fetch(`${baseUrl}/sub-admins`, {
    method: 'POST',
    headers: {
      ...authorization(adminId),
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

test('Sub Admin cannot create another admin', async () => {
  const response = await postSubAdmin(subAdminId, {
    email: 'blocked@example.com',
    name: 'Blocked',
    password: 'valid-password'
  });

  assert.equal(response.status, 403);
  assert.equal(createdRecords.length, 0);
});

test('privileged and unexpected body fields are rejected', async () => {
  for (const extra of [{ role: 'SUPER_ADMIN' }, { isActive: true }]) {
    const response = await postSubAdmin(superAdminId, {
      email: 'blocked@example.com',
      name: 'Blocked',
      password: 'valid-password',
      ...extra
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, 'VALIDATION_FAILED');
  }

  assert.equal(createdRecords.length, 0);
});

test('valid Sub Admin creation hardcodes its role and omits the password hash', async () => {
  const response = await postSubAdmin(superAdminId, {
    email: 'new-sub-admin@example.com',
    name: 'New Sub Admin',
    password: 'valid-password'
  });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(createdRecords.length, 1);
  assert.equal(createdRecords[0].role, 'SUB_ADMIN');
  assert.equal(createdRecords[0].email, 'new-sub-admin@example.com');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.data.admin, 'password_hash'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.data.admin, 'passwordHash'), false);
});

test('admin list routes reject excessive, malformed, and unrecognized query parameters', async () => {
  const listPaths = [
    '/users',
    `/users/${referralOwnerId}/referrals/${referralId}/users`
  ];

  for (const path of listPaths) {
    for (const query of ['limit=101', 'page=1.5', 'sort=created_at']) {
      const response = await fetch(`${baseUrl}${path}?${query}`, {
        headers: authorization(superAdminId)
      });

      assert.equal(response.status, 400, `${path}?${query} should be rejected`);
      const payload = await response.json();
      assert.equal(payload.success, false);
      assert.equal(payload.error.code, 'VALIDATION_FAILED');
    }
  }
});
