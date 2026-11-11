const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const {
  createNotificationsForProfile,
  createNotificationsForProfileMembers
} = require('./notification.service');

const PARENT_TASK_ROLES = ['owner', 'admin', 'editor'];

async function listTasksForChild(userId, childProfileId) {
  await findAccessibleChild(userId, childProfileId);

  const tasks = await prisma.task.findMany({
    where: {
      is_active: true,
      OR: [
        { assigned_to_child_id: childProfileId },
        { assignments: { some: { child_profile_id: childProfileId, is_active: true } } }
      ]
    },
    include: {
      assignments: true
    },
    orderBy: [
      { due_date: 'asc' },
      { created_at: 'desc' }
    ]
  });

  return tasks.map((task) => {
    const assignment = (task.assignments || []).find((item) => item.child_profile_id === childProfileId && item.is_active);
    const publicTask = pickPublicTask(task);
    if (!assignment) return publicTask;
    return {
      ...publicTask,
      assigned_to_child_id: childProfileId,
      status: assignment.status,
      completed_at: assignment.completed_at || publicTask.completed_at,
      assignments: task.assignments.map((item) => ({
        id: item.id,
        child_profile_id: item.child_profile_id,
        status: item.status
      }))
    };
  });
}

async function listTasksForProfile(userId, profileId) {
  await requireProfileTaskAccess(userId, profileId);
  const tasks = await prisma.task.findMany({
    where: { profile_id: profileId, is_active: true },
    include: { assignments: true },
    orderBy: [{ created_at: 'desc' }]
  });
  return tasks.map((task) => ({
    ...pickPublicTask(task),
    assignments: (task.assignments || []).filter((item) => item.is_active).map((item) => ({
      id: item.id,
      child_profile_id: item.child_profile_id,
      status: item.status,
      completed_at: item.completed_at
    }))
  }));
}

async function createTaskForProfile(userId, profileId, input = {}) {
  await requireProfileTaskAccess(userId, profileId);

  if (!input.title?.trim()) {
    throw ApiError.badRequest('Task title is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'title', message: 'Required field is missing' }]
    });
  }

  const requestedAssigneeIds = Array.isArray(input.assignee_ids)
    ? input.assignee_ids.filter(Boolean)
    : (input.assigned_to_child_id ? [input.assigned_to_child_id] : []);
  const uniqueAssigneeIds = [...new Set(requestedAssigneeIds.map((id) => String(id)))];
  const childProfiles = uniqueAssigneeIds.length === 0
    ? []
    : await prisma.childProfile.findMany({
      where: {
        id: { in: uniqueAssigneeIds },
        parent_profile_id: profileId,
        deleted_at: null,
        is_active: true
      }
    });

  if (childProfiles.length !== uniqueAssigneeIds.length) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'One or more child profiles were not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  const primaryChild = childProfiles[0] || null;

  const starReward = Number(input.star_reward || 1);
  if (!Number.isInteger(starReward) || starReward <= 0 || starReward > 1000000) {
    throw ApiError.badRequest('Star reward must be a positive integer up to 1,000,000', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'star_reward', message: 'Must be between 1 and 1,000,000' }]
    });
  }

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        profile_id: profileId,
        assigned_to_child_id: primaryChild?.id || null,
        title: input.title.trim(),
        description: normalizeNullableString(input.description),
        points_value: Number(input.points_value || 0),
        star_reward: starReward,
        status: 'in_progress',
        due_date: parseOptionalDate(input.due_date),
        requires_approval: input.requires_approval !== false,
        created_by_user_id: userId,
        icon: normalizeNullableString(input.icon),
        color: normalizeNullableString(input.color),
        metadata: normalizeMetadata(input.metadata)
      }
    });

    if (childProfiles.length > 0) {
      await tx.taskAssignment.createMany({
        data: childProfiles.map((child) => ({
          task_id: created.id,
          child_profile_id: child.id,
          status: 'in_progress'
        })),
        skipDuplicates: true
      });
    }

    for (const child of childProfiles) {
      await notifyChildForTask(tx, child, {
        sourceId: created.id,
        eventType: 'task.created',
        deliveryKey: `task:created:${created.id}:child:${child.auth_user_id || child.id}`,
        title: 'New task assigned',
        body: `${created.title} was assigned to you.`,
        actionUrl: '/Dashboard',
        priority: 'normal',
        metadata: {
          task_id: created.id,
          child_profile_id: child.id,
          star_reward: Number(created.star_reward || 0),
          due_date: created.due_date
        }
      });
    }

    return created;
  });

  return pickPublicTask(task);
}

async function updateTaskForUser(userId, taskId, input = {}) {
  const task = await findTaskForParentAccess(userId, taskId, {
    includeChild: true
  });

  const updates = {};

  if (input.title !== undefined) {
    if (!input.title.trim()) {
      throw ApiError.badRequest('Task title cannot be blank', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'title', message: 'Must not be blank' }]
      });
    }
    updates.title = input.title.trim();
  }

  if (input.description !== undefined) updates.description = normalizeNullableString(input.description);
  if (input.star_reward !== undefined) {
    const starReward = Number(input.star_reward);
    if (!Number.isInteger(starReward) || starReward <= 0 || starReward > 1000000) {
      throw ApiError.badRequest('Star reward must be a positive integer up to 1,000,000', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'star_reward', message: 'Must be between 1 and 1,000,000' }]
      });
    }
    updates.star_reward = starReward;
  }
  if (input.points_value !== undefined) updates.points_value = Number(input.points_value);
  if (input.icon !== undefined) updates.icon = normalizeNullableString(input.icon);
  if (input.color !== undefined) updates.color = normalizeNullableString(input.color);
  if (input.status !== undefined) updates.status = input.status;
  if (input.due_date !== undefined) updates.due_date = parseOptionalDate(input.due_date);
  if (input.requires_approval !== undefined) updates.requires_approval = Boolean(input.requires_approval);
  if (input.metadata !== undefined) updates.metadata = normalizeMetadata(input.metadata);

  let nextAssignees = null;
  if (input.assignee_ids !== undefined || input.assigned_to_child_id !== undefined) {
    const requestedIds = Array.isArray(input.assignee_ids)
      ? input.assignee_ids.filter(Boolean)
      : (input.assigned_to_child_id ? [input.assigned_to_child_id] : []);
    const uniqueIds = [...new Set(requestedIds.map((id) => String(id)))];
    const children = uniqueIds.length === 0
      ? []
      : await prisma.childProfile.findMany({
        where: {
          id: { in: uniqueIds },
          parent_profile_id: task.profile_id,
          deleted_at: null,
          is_active: true
        }
      });
    if (children.length !== uniqueIds.length) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'One or more child profiles were not found', {
        code: ERROR_CODES.NOT_FOUND
      });
    }
    nextAssignees = children;
    updates.assigned_to_child_id = children[0]?.id || null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedTask = Object.keys(updates).length > 0
      ? await tx.task.update({
        where: { id: task.id },
        data: updates
      })
      : task;

    if (nextAssignees) {
      const assigneeIds = nextAssignees.map((child) => child.id);
      await tx.taskAssignment.updateMany({
        where: {
          task_id: task.id,
          ...(assigneeIds.length > 0 ? { child_profile_id: { notIn: assigneeIds } } : {})
        },
        data: { is_active: false }
      });
      for (const child of nextAssignees) {
        await tx.taskAssignment.upsert({
          where: {
            task_id_child_profile_id: {
              task_id: task.id,
              child_profile_id: child.id
            }
          },
          update: { is_active: true },
          create: {
            task_id: task.id,
            child_profile_id: child.id,
            status: 'in_progress'
          }
        });
      }
    }

    const notifyTargets = nextAssignees || (task.assigned_child ? [task.assigned_child] : []);
    for (const child of notifyTargets) {
      await notifyChildForTask(tx, child, {
        sourceId: task.id,
        eventType: 'task.updated',
        deliveryKey: `task:updated:${task.id}:${Object.keys(updates).sort().join(',')}:child:${child.auth_user_id || child.id}`,
        title: 'Task updated',
        body: `${updatedTask.title} was updated.`,
        actionUrl: '/Dashboard',
        priority: 'normal',
        metadata: {
          task_id: task.id,
          child_profile_id: child.id,
          updated_fields: Object.keys(updates)
        }
      });
    }

    return updatedTask;
  });

  return pickPublicTask(updated);
}

async function deleteTaskForUser(userId, taskId) {
  const task = await findTaskForParentAccess(userId, taskId, {
    includeChild: true
  });

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: task.id },
      data: {
        is_active: false,
        status: 'archived'
      }
    });

    await notifyChildForTask(tx, task.assigned_child, {
      sourceId: task.id,
      eventType: 'task.deleted',
      deliveryKey: `task:deleted:${task.id}:child:${task.assigned_child?.auth_user_id}`,
      title: 'Task removed',
      body: `${task.title} was removed.`,
      actionUrl: '/Dashboard',
      priority: 'normal',
      metadata: {
        task_id: task.id,
        child_profile_id: task.assigned_to_child_id
      }
    });
  });

  return { deleted: true };
}

async function listCompletionsForChild(userId, childProfileId, filters = {}) {
  await findAccessibleChild(userId, childProfileId);

  const completions = await prisma.taskCompletion.findMany({
    where: {
      child_profile_id: childProfileId,
      ...(filters.status ? { status: filters.status } : {})
    },
    include: {
      task: true
    },
    orderBy: {
      submitted_at: 'desc'
    }
  });

  return completions.map(pickPublicCompletion);
}

async function submitCompletionForUser(userId, taskId, input = {}) {
  const task = await findTaskForChildOrParentAccess(userId, taskId);
  const childId = input.child_profile_id || input.childProfileId || task.assigned_to_child_id;
  if (!childId) {
    throw ApiError.badRequest('This task is not assigned to a child', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  const starsEarned = Number(task.star_reward || 0);

  const metadata = task.metadata && typeof task.metadata === 'object' ? task.metadata : {};
  const schedule = metadata.schedule || 'daily';

  // 1. Prevent duplicate submissions if task is already pending parental approval
  const existingPending = await prisma.taskCompletion.findFirst({
    where: {
      task_id: task.id,
      child_profile_id: childId,
      status: 'pending'
    }
  });

  if (existingPending) {
    throw ApiError.badRequest('This task has already been submitted and is awaiting parental approval.', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  // 2. Schedule-based validation
  if (schedule === 'one_time') {
    const existingApproved = await prisma.taskCompletion.findFirst({
      where: {
        task_id: task.id,
        child_profile_id: childId,
        status: 'approved'
      }
    });
    if (existingApproved) {
      throw ApiError.badRequest('This is a one-time task and has already been completed.', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }
  } else if (schedule === 'daily') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const existingToday = await prisma.taskCompletion.findFirst({
      where: {
        task_id: task.id,
        child_profile_id: childId,
        status: 'approved',
        submitted_at: { gte: startOfToday }
      }
    });
    if (existingToday) {
      throw ApiError.badRequest('This daily task has already been completed today. It will reset tomorrow.', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }
  } else if (schedule === 'weekly') {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const distanceToMonday = (dayOfWeek + 6) % 7;
    const startOfMonday = new Date(now);
    startOfMonday.setDate(now.getDate() - distanceToMonday);
    startOfMonday.setHours(0, 0, 0, 0);

    const existingThisWeek = await prisma.taskCompletion.findFirst({
      where: {
        task_id: task.id,
        child_profile_id: childId,
        status: 'approved',
        submitted_at: { gte: startOfMonday }
      }
    });
    if (existingThisWeek) {
      throw ApiError.badRequest('This weekly task has already been completed this week. It will reset next Monday.', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }
  }

  const completion = await prisma.$transaction(async (tx) => {
    const created = await tx.taskCompletion.create({
      data: {
        task_id: task.id,
        child_profile_id: childId,
        stars_earned: starsEarned,
        submission_notes: normalizeNullableString(input.submissionNotes),
        status: 'pending'
      }
    });

    await tx.childProfile.update({
      where: { id: childId },
      data: {
        stars_pending: { increment: starsEarned }
      }
    });

    await tx.taskAssignment.updateMany({
      where: { task_id: task.id, child_profile_id: childId },
      data: { status: 'completed', completed_at: new Date() }
    });

    const openAssignments = await tx.taskAssignment.count({
      where: {
        task_id: task.id,
        is_active: true,
        status: { notIn: ['completed', 'approved'] }
      }
    });

    await tx.task.update({
      where: { id: task.id },
      data: openAssignments > 0
        ? { status: 'in_progress', completed_at: null }
        : { status: 'completed', completed_at: new Date() }
    });

    await createNotificationsForProfileMembers(task.profile_id, {
      source: 'tasks',
      source_id: created.id,
      event_type: 'task.completion_submitted',
      delivery_key: `task:completion_submitted:${created.id}`,
      title: 'Task ready for review',
      body: `${task.assigned_child?.display_name || task.assigned_child?.name || 'A child'} submitted ${task.title}.`,
      action_url: `/Contacts/family/${childId}`,
      priority: 'normal',
      metadata: {
        task_id: task.id,
        completion_id: created.id,
        child_profile_id: childId,
        stars_pending: starsEarned
      }
    }, { db: tx });

    return tx.taskCompletion.findUnique({
      where: { id: created.id },
      include: { task: true }
    });
  });

  return pickPublicCompletion(completion);
}

async function approveCompletionForUser(userId, completionId, reviewNotes = null) {
  const completion = await findCompletionForParentAccess(userId, completionId);
  const task = completion.task;
  const starsEarned = Number(completion.stars_earned || 0);

  const result = await prisma.$transaction(async (tx) => {
    const child = await tx.childProfile.update({
      where: { id: completion.child_profile_id },
      data: {
        stars_balance: { increment: starsEarned },
        stars_pending: { decrement: starsEarned }
      }
    });

    await tx.taskCompletion.update({
      where: { id: completion.id },
      data: {
        status: 'approved',
        review_notes: normalizeNullableString(reviewNotes),
        reviewed_at: new Date(),
        reviewed_by: userId
      }
    });

    await tx.task.update({
      where: { id: task.id },
      data: {
        status: 'approved',
        approved_by_user_id: userId,
        approved_at: new Date(),
        completed_at: task.completed_at || completion.submitted_at || new Date()
      }
    });

    if (starsEarned > 0) {
      await tx.childTransaction.create({
        data: {
          child_profile_id: completion.child_profile_id,
          transaction_type: 'task_completion',
          amount: starsEarned,
          currency_type: 'stars',
          description: `Completed: ${task.title}`,
          status: 'completed',
          approved_by_user_id: userId,
          approved_at: new Date(),
          related_task_id: task.id,
          balance_after: child.stars_balance
        }
      });
    }

    await notifyChildForTask(tx, child, {
      sourceId: completion.id,
      eventType: 'task.completion_approved',
      deliveryKey: `task:completion_approved:${completion.id}`,
      title: 'Task approved',
      body: starsEarned > 0
        ? `${task.title} was approved and you earned ${starsEarned} star${starsEarned === 1 ? '' : 's'}.`
        : `${task.title} was approved.`,
      actionUrl: '/Dashboard',
      priority: 'normal',
      metadata: {
        task_id: task.id,
        completion_id: completion.id,
        stars_awarded: starsEarned
      }
    });

    return {
      stars_balance: child.stars_balance,
      stars_pending: child.stars_pending,
      stars_awarded: starsEarned
    };
  });

  return result;
}

async function rejectCompletionForUser(userId, completionId, reviewNotes = null) {
  const completion = await findCompletionForParentAccess(userId, completionId);

  await prisma.$transaction(async (tx) => {
    await tx.childProfile.update({
      where: { id: completion.child_profile_id },
      data: {
        stars_pending: { decrement: Number(completion.stars_earned || 0) }
      }
    });

    await tx.taskCompletion.update({
      where: { id: completion.id },
      data: {
        status: 'rejected',
        review_notes: normalizeNullableString(reviewNotes),
        reviewed_at: new Date(),
        reviewed_by: userId
      }
    });

    await tx.task.update({
      where: { id: completion.task_id },
      data: {
        status: 'in_progress',
        completed_at: null
      }
    });

    await notifyChildForTask(tx, completion.task?.assigned_child || await tx.childProfile.findUnique({ where: { id: completion.child_profile_id } }), {
      sourceId: completion.id,
      eventType: 'task.completion_rejected',
      deliveryKey: `task:completion_rejected:${completion.id}`,
      title: 'Task needs another try',
      body: reviewNotes ? `${completion.task?.title || 'Your task'} was rejected: ${reviewNotes}` : `${completion.task?.title || 'Your task'} was rejected.`,
      actionUrl: '/Dashboard',
      priority: 'normal',
      metadata: {
        task_id: completion.task_id,
        completion_id: completion.id,
        review_notes: normalizeNullableString(reviewNotes)
      }
    });
  });

  return { rejected: true };
}

async function getChildStarBalanceForUser(userId, childProfileId) {
  const child = await findAccessibleChild(userId, childProfileId);

  return {
    stars_balance: child.stars_balance,
    stars_pending: child.stars_pending
  };
}

async function awardStarsDirectlyForUser(userId, childProfileId, input = {}) {
  await findAccessibleChild(userId, childProfileId, {
    requiredParentRoles: PARENT_TASK_ROLES,
    childCanAccess: false
  });

  const stars = Number(input.stars || 0);
  if (!Number.isInteger(stars) || stars <= 0 || stars > 1000000) {
    throw ApiError.badRequest('Stars must be a positive integer up to 1,000,000', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'stars', message: 'Must be between 1 and 1,000,000' }]
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const child = await tx.childProfile.update({
      where: { id: childProfileId },
      data: {
        stars_balance: { increment: stars }
      }
    });

    if (input.taskId) {
      const task = await tx.task.findFirst({
        where: {
          id: input.taskId,
          assigned_to_child_id: childProfileId,
          is_active: true
        }
      });

      if (task) {
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: 'approved',
            approved_by_user_id: userId,
            approved_at: new Date(),
            completed_at: new Date()
          }
        });
      }
    }

    await tx.childTransaction.create({
      data: {
        child_profile_id: childProfileId,
        transaction_type: input.taskId ? 'task_reward' : 'star_award',
        amount: stars,
        currency_type: 'stars',
        description: normalizeNullableString(input.note) || 'Stars awarded',
        status: 'completed',
        approved_by_user_id: userId,
        approved_at: new Date(),
        related_task_id: input.taskId || null,
        balance_after: child.stars_balance
      }
    });

    await notifyChildForTask(tx, child, {
      sourceId: childProfileId,
      eventType: 'child.stars_awarded',
      deliveryKey: `child:stars_awarded:${childProfileId}:${Date.now()}`,
      title: 'Stars awarded',
      body: `${stars} star${stars === 1 ? '' : 's'} added to your balance.`,
      actionUrl: '/Dashboard',
      priority: 'normal',
      metadata: {
        child_profile_id: childProfileId,
        stars_awarded: stars,
        note: normalizeNullableString(input.note),
        task_id: input.taskId || null
      }
    });

    return child;
  });

  return {
    stars_balance: result.stars_balance,
    stars_awarded: stars
  };
}

async function findTaskForParentAccess(userId, taskId, options = {}) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      is_active: true
    },
    include: {
      assigned_child: options.includeChild,
      profile: {
        include: {
          memberships: true
        }
      }
    }
  });

  if (!task || !hasProfileRole(task.profile, userId, PARENT_TASK_ROLES)) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Task not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return task;
}

async function findTaskForChildOrParentAccess(userId, taskId) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      is_active: true
    },
    include: {
      assigned_child: true,
      profile: {
        include: {
          memberships: true
        }
      }
    }
  });

  if (!task) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Task not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  const canParentAccess = hasProfileRole(task.profile, userId, PARENT_TASK_ROLES);
  const canChildAccess = task.assigned_child?.auth_user_id === userId;

  if (!canParentAccess && !canChildAccess) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Task not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return task;
}

async function findCompletionForParentAccess(userId, completionId) {
  const completion = await prisma.taskCompletion.findFirst({
    where: {
      id: completionId
    },
    include: {
      task: {
        include: {
          profile: {
            include: {
              memberships: true
            }
          }
        }
      }
    }
  });

  if (!completion || !hasProfileRole(completion.task.profile, userId, PARENT_TASK_ROLES)) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Task completion not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return completion;
}

async function findAccessibleChild(userId, childProfileId, options = {}) {
  const child = await prisma.childProfile.findFirst({
    where: {
      id: childProfileId,
      deleted_at: null,
      is_active: true
    },
    include: {
      parent_profile: {
        include: {
          memberships: true
        }
      }
    }
  });

  if (!child) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Child profile not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  const requiredParentRoles = options.requiredParentRoles || ['owner', 'admin', 'editor', 'viewer'];
  const childCanAccess = options.childCanAccess !== false;
  const canParentAccess = hasProfileRole(child.parent_profile, userId, requiredParentRoles);
  const canChildAccess = childCanAccess && child.auth_user_id === userId;

  if (!canParentAccess && !canChildAccess) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Child profile not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return child;
}

async function requireProfileTaskAccess(userId, profileId) {
  const membership = await prisma.profileMembership.findFirst({
    where: {
      user_id: userId,
      profile_id: profileId,
      role: { in: PARENT_TASK_ROLES },
      profile: {
        deleted_at: null,
        is_active: true
      }
    }
  });

  if (!membership) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Profile not found', {
      code: ERROR_CODES.PROFILE_NOT_FOUND
    });
  }
}

function hasProfileRole(profile, userId, roles) {
  return Boolean(profile?.memberships?.some((membership) => (
    membership.user_id === userId && roles.includes(membership.role)
  )));
}

function pickPublicTask(task) {
  if (!task) return null;

  return {
    id: task.id,
    profile_id: task.profile_id,
    assigned_to_child_id: task.assigned_to_child_id,
    title: task.title,
    description: task.description,
    points_value: task.points_value,
    star_reward: task.star_reward,
    points_reward: task.star_reward,
    status: task.status,
    due_date: task.due_date,
    requires_approval: task.requires_approval,
    created_by_user_id: task.created_by_user_id,
    approved_by_user_id: task.approved_by_user_id,
    completed_at: task.completed_at,
    approved_at: task.approved_at,
    rejected_at: task.rejected_at,
    rejection_reason: task.rejection_reason,
    bonus_multiplier: Number(task.bonus_multiplier || 1),
    streak_count: task.streak_count,
    icon: task.icon,
    color: task.color,
    is_active: task.is_active,
    metadata: task.metadata,
    created_at: task.created_at,
    updated_at: task.updated_at
  };
}

function pickPublicCompletion(completion) {
  if (!completion) return null;

  return {
    id: completion.id,
    task_id: completion.task_id,
    child_profile_id: completion.child_profile_id,
    status: completion.status,
    stars_earned: completion.stars_earned,
    submission_notes: completion.submission_notes,
    review_notes: completion.review_notes,
    submitted_at: completion.submitted_at,
    reviewed_at: completion.reviewed_at,
    reviewed_by: completion.reviewed_by,
    created_at: completion.created_at,
    updated_at: completion.updated_at,
    tasks: completion.task ? pickPublicTask(completion.task) : undefined,
    task: completion.task ? pickPublicTask(completion.task) : undefined
  };
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isLockedTask(task) {
  return ['completed', 'approved'].includes(task?.status);
}

function parseOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function notifyChildForTask(db, child, {
  sourceId,
  eventType,
  deliveryKey,
  title,
  body,
  actionUrl,
  priority = 'normal',
  metadata = {}
}) {
  if (!child?.auth_user_id || !child.parent_profile_id) return;

  await createNotificationsForProfile([{
    profile_id: child.parent_profile_id,
    recipient_user_id: child.auth_user_id,
    source: 'tasks',
    source_id: sourceId,
    event_type: eventType,
    delivery_key: deliveryKey,
    title,
    body,
    action_url: actionUrl,
    priority,
    metadata
  }], { db });
}

module.exports = {
  listTasksForChild,
  listTasksForProfile,
  createTaskForProfile,
  updateTaskForUser,
  deleteTaskForUser,
  listCompletionsForChild,
  submitCompletionForUser,
  approveCompletionForUser,
  rejectCompletionForUser,
  getChildStarBalanceForUser,
  awardStarsDirectlyForUser
};
