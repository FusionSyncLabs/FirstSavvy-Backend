require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../config/database');

const baseUrl = process.env.API_BASE_URL || 'http://localhost:5000';
const password = 'Password123!';
const stamp = Date.now();
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(pathname, { method = 'GET', token, profileId, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(profileId ? { 'X-Profile-Id': profileId } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function provision(email, fullName) {
  const response = await api('/api/v1/dev/provision-user', {
    method: 'POST',
    body: { email, fullName, password }
  });
  assert.equal(response.payload?.success, true, JSON.stringify(response.payload));
  await prisma.user.update({
    where: { id: response.payload.data.user.id },
    data: { verified_at: new Date() }
  });
  return response.payload.data;
}

async function login(email) {
  const response = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password }
  });
  const token = response.payload?.data?.session?.accessToken;
  assert.ok(token, `login failed: ${JSON.stringify(response.payload)}`);
  return token;
}

function loadSpendingCalculator() {
  const source = fs.readFileSync(path.join(__dirname, '../services/dashboard.service.js'), 'utf8');
  const start = source.indexOf('function calculateCurrentMonthSpending');
  const end = source.indexOf('function buildTopUtilizedBudgets');
  const fn = new Function(`${source.slice(start, end)}\nreturn calculateCurrentMonthSpending;`);
  return fn();
}

async function main() {
  const ownerEmail = `qa.owner.${stamp}@firstsavvy.test`;
  const coEmail = `qa.co.${stamp}@firstsavvy.test`;
  const deleteEmail = `qa.delete.${stamp}@firstsavvy.test`;

  const owner = await provision(ownerEmail, 'QA Owner');
  const coOwner = await provision(coEmail, 'QA CoOwner');
  const deleteUser = await provision(deleteEmail, 'QA Delete');
  const token = await login(ownerEmail);
  const profileId = owner.profile.id;

  try {
    const blankName = await api(`/api/v1/profiles/${profileId}`, {
      method: 'PATCH',
      token,
      profileId,
      body: { household_name: '   ' }
    });
    record(
      'blank household name is rejected',
      blankName.status === 400,
      `status ${blankName.status}`
    );

    const householdName = `QA Household ${stamp}`;
    const savedName = await api(`/api/v1/profiles/${profileId}`, {
      method: 'PATCH',
      token,
      profileId,
      body: { household_name: householdName, display_name: 'QA Owner' }
    });
    record(
      'household name is stored on the profile',
      savedName.payload?.data?.profile?.metadata?.household_name === householdName,
      savedName.payload?.data?.profile?.metadata?.household_name || JSON.stringify(savedName.payload)
    );

    const phone = `+1555${String(stamp).slice(-7)}`;
    const phoneUpdate = await api(`/api/v1/profiles/${profileId}`, {
      method: 'PATCH',
      token,
      profileId,
      body: { phone, display_name: 'QA Owner' }
    });
    const me = await api('/api/v1/auth/me', { token });
    const phoneOnUser = me.payload?.data?.user?.phone_number === phone;
    const phoneNotOnProfile = phoneUpdate.payload?.data?.profile?.metadata?.phone == null;
    record('phone is saved on the user, not profile metadata', phoneOnUser && phoneNotOnProfile, `user=${me.payload?.data?.user?.phone_number}`);

    const isabella = await api(`/api/v1/profiles/${profileId}/children`, {
      method: 'POST',
      token,
      profileId,
      body: { first_name: 'Isabella', last_name: 'QA', family_role: 'child', email: `isabella.${stamp}@firstsavvy.test` }
    });
    const tucker = await api(`/api/v1/profiles/${profileId}/children`, {
      method: 'POST',
      token,
      profileId,
      body: { first_name: 'Tucker', last_name: 'QA', family_role: 'child', email: `tucker.${stamp}@firstsavvy.test` }
    });
    const isabellaId = isabella.payload?.data?.child?.id || isabella.payload?.data?.childProfile?.id || isabella.payload?.data?.id;
    const tuckerId = tucker.payload?.data?.child?.id || tucker.payload?.data?.childProfile?.id || tucker.payload?.data?.id;
    record('two children can be created', Boolean(isabellaId && tuckerId), `status ${isabella.status}/${tucker.status}`);

    const duplicate = await api(`/api/v1/profiles/${profileId}/children`, {
      method: 'POST',
      token,
      profileId,
      body: { first_name: 'Isabella', last_name: 'Again', family_role: 'child', email: `isabella.${stamp}@firstsavvy.test` }
    });
    record('duplicate household email is rejected', duplicate.status === 409, `status ${duplicate.status}`);

    const unassigned = await api(`/api/v1/tasks/profiles/${profileId}/tasks`, {
      method: 'POST',
      token,
      profileId,
      body: { title: 'Unassigned sample', assignee_ids: [], star_reward: 1 }
    });
    const unassignedTask = unassigned.payload?.data?.task;
    record(
      'task can be created with nobody assigned',
      unassigned.status === 201 && unassignedTask && !unassignedTask.assigned_to_child_id,
      `status ${unassigned.status}`
    );

    const sharedTask = await api(`/api/v1/tasks/profiles/${profileId}/tasks`, {
      method: 'POST',
      token,
      profileId,
      body: { title: 'Make bed', assignee_ids: [isabellaId, tuckerId], star_reward: 2 }
    });
    const createdTask = sharedTask.payload?.data?.task;
    const listed = await api(`/api/v1/tasks/profiles/${profileId}/tasks`, { token, profileId });
    const listedTask = (listed.payload?.data?.tasks || []).find((task) => task.id === createdTask?.id);
    record(
      'one task can be assigned to two children',
      sharedTask.status === 201 && listedTask?.assignments?.length === 2,
      `assignments ${listedTask?.assignments?.length}`
    );

    const edited = await api(`/api/v1/tasks/${createdTask.id}`, {
      method: 'PATCH',
      token,
      profileId,
      body: { assignee_ids: [isabellaId], title: 'Make bed' }
    });
    const listedAfterEdit = await api(`/api/v1/tasks/profiles/${profileId}/tasks`, { token, profileId });
    const editedTask = (listedAfterEdit.payload?.data?.tasks || []).find((task) => task.id === createdTask.id);
    const activeAssignments = (editedTask?.assignments || []).filter((item) => item.child_profile_id === isabellaId);
    record(
      'editing a task keeps one task and changes assignees',
      edited.status === 200 && activeAssignments.length === 1 && editedTask.assignments.filter((item) => item.status !== undefined).length === 1,
      `status ${edited.status}, assignments ${editedTask?.assignments?.length}`
    );

    const switched = await api(`/api/v1/profiles/${profileId}/switch`, {
      method: 'POST',
      token,
      profileId,
      body: { childProfileId: isabellaId }
    });
    const active = await api('/api/v1/profiles/active', { token });
    record(
      'selecting a child stores that child and the parent ledger',
      switched.status === 200 && active.payload?.data?.activeProfile?.active_child_profile_id === isabellaId,
      active.payload?.data?.activeProfile?.active_child_profile_id || `status ${switched.status}`
    );

    const defaultDelete = await api(`/api/v1/profiles/${profileId}`, { method: 'DELETE', token, profileId });
    record('default profile cannot be deleted', defaultDelete.status === 400, `status ${defaultDelete.status}`);

    const extra = await api('/api/v1/profiles', {
      method: 'POST',
      token,
      body: { name: 'QA Extra', display_name: 'QA Extra', profileType: 'household' }
    });
    const extraId = extra.payload?.data?.profile?.id;
    const coMember = await api(`/api/v1/profiles/${extraId}/children`, {
      method: 'POST',
      token,
      profileId: extraId,
      body: {
        first_name: 'QA',
        last_name: 'CoOwner',
        family_role: 'spouse_partner',
        email: coEmail
      }
    });
    const membership = await prisma.profileMembership.findFirst({
      where: { profile_id: extraId, user_id: coOwner.user.id }
    });
    const coSettings = await prisma.userSetting.findUnique({ where: { user_id: coOwner.user.id } });
    record(
      'new co-owner is an admin on the shared profile',
      coMember.status < 400 && membership?.role === 'admin',
      `status ${coMember.status}, role ${membership?.role}`
    );
    record(
      'co-owner with an empty ledger is pointed at the shared profile',
      coSettings?.settings?.activeProfileId === extraId,
      coSettings?.settings?.activeProfileId
    );

    const sharedDelete = await api(`/api/v1/profiles/${extraId}`, { method: 'DELETE', token, profileId: extraId });
    record(
      'shared profile delete is refused while another member remains',
      sharedDelete.status === 409,
      `status ${sharedDelete.status} ${sharedDelete.payload?.error?.message || ''}`
    );

    await api('/api/v1/user-settings', {
      method: 'PATCH',
      token,
      body: { notifications: { taskActivity: false, taskUpdates: false, rewardActivity: false, householdChatter: false } }
    });
    const { createNotificationsForProfile } = require('../services/notification.service');
    const optionalKey = `qa:task-created:${stamp}`;
    const requiredKey = `qa:task-completion:${stamp}`;
    await createNotificationsForProfile([
      {
        profile_id: profileId,
        recipient_user_id: owner.user.id,
        source: 'tasks',
        source_id: createdTask.id,
        event_type: 'task.created',
        delivery_key: optionalKey,
        title: 'QA optional',
        body: 'should be filtered'
      },
      {
        profile_id: profileId,
        recipient_user_id: owner.user.id,
        source: 'tasks',
        source_id: createdTask.id,
        event_type: 'task.completion_submitted',
        delivery_key: requiredKey,
        title: 'QA required',
        body: 'should be kept'
      }
    ]);
    const stored = await prisma.notification.findMany({
      where: { delivery_key: { in: [optionalKey, requiredKey] } }
    });
    record(
      'optional task notices follow preferences and completion reviews still send',
      stored.length === 1 && stored[0].delivery_key === requiredKey,
      `stored ${stored.map((row) => row.event_type).join(', ') || 'none'}`
    );

    const calculateCurrentMonthSpending = loadSpendingCalculator();
    const accountId = '11111111-1111-4111-8111-111111111111';
    const today = new Date().toISOString();
    const spending = calculateCurrentMonthSpending([
      { date: today, bank_account_id: accountId, type: 'transfer', amount: -80, category_account_id: 'transfer' },
      { date: today, bank_account_id: accountId, type: 'expense', amount: 25, category_account_id: 'groceries' },
      { date: today, bank_account_id: accountId, type: 'payment', amount: -15, category_account_id: 'dining' },
      { date: today, bank_account_id: accountId, type: 'income', amount: 100, category_account_id: 'pay' }
    ], new Set([accountId]));
    record(
      'spending skips transfers and counts expenses plus negative non-income amounts',
      spending.groceries === 25 && spending.dining === 15 && spending.transfer == null && spending.pay == null,
      JSON.stringify(spending)
    );

    const mailSource = fs.readFileSync(path.join(__dirname, '../utils/mail.js'), 'utf8');
    record(
      'mail delivery failure is thrown instead of reported as sent',
      mailSource.includes('EMAIL_NOT_CONFIGURED') && mailSource.includes('EMAIL_DELIVERY_FAILED') && !mailSource.includes('catch (error) {\n    console.error'),
      'source check'
    );

    const deleteToken = await login(deleteEmail);
    const removed = await api('/api/v1/auth/account', {
      method: 'DELETE',
      token: deleteToken,
      body: { password }
    });
    const retired = await prisma.user.findUnique({ where: { id: deleteUser.user.id } });
    const loginAfterDelete = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: deleteEmail, password }
    });
    record(
      'deleting an account retires the email and blocks login',
      removed.status === 200 && retired?.email === `deleted.${deleteUser.user.id}@users.invalid` && loginAfterDelete.status >= 400,
      `status ${removed.status}, email ${retired?.email}, login ${loginAfterDelete.status}`
    );
  } finally {
    await prisma.notification.deleteMany({
      where: { delivery_key: { in: [`qa:task-created:${stamp}`, `qa:task-completion:${stamp}`] } }
    });
    await prisma.$disconnect();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} recent-change checks passed.`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
