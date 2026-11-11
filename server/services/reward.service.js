const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const {
  createNotificationsForProfile,
  createNotificationsForProfileMembers
} = require('./notification.service');
const {
  deleteObject,
  extractKeyFromPublicUrl,
  uploadPublicObject
} = require('./fileStorage.service');

const PARENT_REWARD_ROLES = ['owner', 'admin', 'editor'];
const MAX_REWARD_IMAGE_BYTES = 5 * 1024 * 1024;

async function listRewardsForChild(userId, childProfileId) {
  const child = await findAccessibleChild(userId, childProfileId);

  const rewards = await prisma.reward.findMany({
    where: {
      profile_id: child.parent_profile_id,
      OR: [
        { assigned_to_child_id: childProfileId },
        { assigned_to_child_id: null }
      ],
      is_active: true
    },
    orderBy: [
      { star_cost: 'asc' },
      { created_at: 'desc' }
    ]
  });

  return rewards
    .filter(r => r.category !== 'Cash In' && r.description !== 'Instant Cash In')
    .map(pickPublicReward);
}

async function createRewardForProfile(userId, profileId, input = {}, options = {}) {
  await requireProfileRewardAccess(userId, profileId);

  if (!input.title?.trim()) {
    throw ApiError.badRequest('Reward title is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'title', message: 'Required field is missing' }]
    });
  }

  const childProfile = await prisma.childProfile.findFirst({
    where: {
      id: input.assigned_to_child_id,
      parent_profile_id: profileId,
      deleted_at: null,
      is_active: true
    }
  });

  if (!childProfile) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Child profile not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  const starCost = Number(input.star_cost || 0);
  if (!Number.isInteger(starCost) || starCost <= 0 || starCost > 1000000) {
    throw ApiError.badRequest('Star cost must be a positive integer up to 1,000,000', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'star_cost', message: 'Must be between 1 and 1,000,000' }]
    });
  }

  const uploadedImage = options.imageFile
    ? await uploadRewardImage(options.imageFile, {
      userId,
      profileId,
      publicFilesBaseUrl: options.publicFilesBaseUrl
    })
    : null;
  const imageUrl = uploadedImage?.publicUrl || normalizeNullableString(input.image_url);

  let reward;
  try {
    reward = await prisma.$transaction(async (tx) => {
      const created = await tx.reward.create({
        data: {
          profile_id: profileId,
          assigned_to_child_id: childProfile.id,
          title: input.title.trim(),
          description: normalizeNullableString(input.description),
          star_cost: starCost,
          points_cost: Number(input.points_cost || 0),
          cash_cost: Number(input.cash_cost || 0),
          category: normalizeNullableString(input.category),
          icon: normalizeNullableString(input.icon),
          color: normalizeNullableString(input.color),
          image_url: imageUrl,
          requires_approval_threshold: Number(input.requires_approval_threshold || 100),
          stock_quantity: normalizeNullableInteger(input.stock_quantity),
          expires_at: parseOptionalDate(input.expires_at),
          age_restriction: normalizeNullableInteger(input.age_restriction),
          created_by_user_id: userId,
          status: normalizeRewardStatus(input.status) || 'available',
          metadata: normalizeMetadata(input.metadata)
        }
      });

      if (created.status === 'available') {
        await notifyChildForReward(tx, childProfile, {
          sourceId: created.id,
          eventType: 'reward.created',
          deliveryKey: `reward:created:${created.id}:child:${childProfile.auth_user_id}`,
          title: 'New reward available',
          body: `${created.title} is now available to redeem.`,
          actionUrl: '/Goals',
          metadata: {
            reward_id: created.id,
            child_profile_id: childProfile.id,
            star_cost: starCost
          }
        });
      }

      return created;
    });
  } catch (error) {
    if (uploadedImage?.publicUrl) {
      await deletePublicFile(uploadedImage.publicUrl);
    }
    throw error;
  }

  return pickPublicReward(reward);
}

async function updateRewardForUser(userId, rewardId, input = {}, options = {}) {
  const reward = await findRewardForParentAccess(userId, rewardId);
  if (reward.status === 'redeemed') {
    throw ApiError.badRequest('Redeemed rewards cannot be edited', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const updates = {};

  if (input.title !== undefined) {
    if (!input.title.trim()) {
      throw ApiError.badRequest('Reward title cannot be blank', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'title', message: 'Must not be blank' }]
      });
    }
    updates.title = input.title.trim();
  }

  if (input.description !== undefined) updates.description = normalizeNullableString(input.description);
  if (input.star_cost !== undefined) updates.star_cost = normalizePositiveInteger(input.star_cost, 'star_cost');
  if (input.points_cost !== undefined) updates.points_cost = Number(input.points_cost || 0);
  if (input.cash_cost !== undefined) updates.cash_cost = Number(input.cash_cost || 0);
  if (input.category !== undefined) updates.category = normalizeNullableString(input.category);
  if (input.icon !== undefined) updates.icon = normalizeNullableString(input.icon);
  if (input.color !== undefined) updates.color = normalizeNullableString(input.color);
  if (input.requires_approval_threshold !== undefined) updates.requires_approval_threshold = Number(input.requires_approval_threshold || 100);
  if (input.stock_quantity !== undefined) updates.stock_quantity = normalizeNullableInteger(input.stock_quantity);
  if (input.expires_at !== undefined) updates.expires_at = parseOptionalDate(input.expires_at);
  if (input.age_restriction !== undefined) updates.age_restriction = normalizeNullableInteger(input.age_restriction);
  if (input.status !== undefined) updates.status = normalizeRewardStatus(input.status);
  if (input.metadata !== undefined) updates.metadata = normalizeMetadata(input.metadata);

  const uploadedImage = options.imageFile
    ? await uploadRewardImage(options.imageFile, {
      userId,
      profileId: reward.profile_id,
      publicFilesBaseUrl: options.publicFilesBaseUrl
    })
    : null;
  const shouldRemoveImage = input.remove_image === true;
  const hasImageUpdate = Boolean(uploadedImage) || shouldRemoveImage || input.image_url !== undefined;

  if (uploadedImage) {
    updates.image_url = uploadedImage.publicUrl;
  } else if (shouldRemoveImage) {
    updates.image_url = null;
  } else if (input.image_url !== undefined) {
    updates.image_url = normalizeNullableString(input.image_url);
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const updatedReward = await tx.reward.update({
        where: { id: reward.id },
        data: updates
      });

      await notifyChildForReward(tx, reward.assigned_child, {
        sourceId: reward.id,
        eventType: 'reward.updated',
        deliveryKey: `reward:updated:${reward.id}:${Date.now()}:child:${reward.assigned_child?.auth_user_id}`,
        title: 'Reward updated',
        body: `${updatedReward.title} was updated.`,
        actionUrl: '/Goals',
        priority: 'normal',
        metadata: {
          reward_id: reward.id,
          child_profile_id: reward.assigned_to_child_id,
          updated_fields: Object.keys(updates)
        }
      });

      return updatedReward;
    });
  } catch (error) {
    if (uploadedImage?.publicUrl) {
      await deletePublicFile(uploadedImage.publicUrl);
    }
    throw error;
  }

  if (hasImageUpdate && reward.image_url && reward.image_url !== updated.image_url) {
    await deletePublicFile(reward.image_url);
  }

  return pickPublicReward(updated);
}

async function deleteRewardForUser(userId, rewardId) {
  const reward = await findRewardForParentAccess(userId, rewardId);
  if (reward.status === 'redeemed') {
    throw ApiError.badRequest('Redeemed rewards cannot be deleted', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.reward.update({
      where: { id: reward.id },
      data: {
        is_active: false,
        status: 'cancelled'
      }
    });

    await notifyChildForReward(tx, reward.assigned_child, {
      sourceId: reward.id,
      eventType: 'reward.deleted',
      deliveryKey: `reward:deleted:${reward.id}:child:${reward.assigned_child?.auth_user_id}`,
      title: 'Reward removed',
      body: `${reward.title} was removed.`,
      actionUrl: '/Goals',
      priority: 'normal',
      metadata: {
        reward_id: reward.id,
        child_profile_id: reward.assigned_to_child_id
      }
    });
  });

  await deletePublicFile(reward.image_url);

  return { deleted: true };
}

async function redeemRewardForChild(userId, childProfileId, rewardId, body = {}) {
  const child = await findAccessibleChild(userId, childProfileId);
  const isParent = hasProfileRole(child.parent_profile, userId, ['owner', 'admin', 'editor']);
  if (child.auth_user_id !== userId && !isParent) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only the child or authorized parent can redeem rewards', {
      code: ERROR_CODES.FORBIDDEN
    });
  }

  const reward = await prisma.reward.findFirst({
    where: {
      id: rewardId,
      is_active: true,
      OR: [
        { assigned_to_child_id: childProfileId },
        { assigned_to_child_id: null, profile_id: child.parent_profile_id }
      ]
    }
  });

  if (!reward) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reward not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  if (reward.status !== 'available') {
    throw ApiError.badRequest('Reward is not available', { code: ERROR_CODES.VALIDATION_FAILED });
  }

  if (reward.stock_quantity !== null && reward.stock_quantity <= 0) {
    throw ApiError.badRequest('This reward is out of stock', { code: ERROR_CODES.VALIDATION_FAILED });
  }

  if (reward.expires_at && reward.expires_at < new Date()) {
    throw ApiError.badRequest('This reward has expired', { code: ERROR_CODES.VALIDATION_FAILED });
  }

  const starsToSpend = Number(reward.star_cost || 0);
  if (Number(child.stars_balance || 0) < starsToSpend) {
    throw ApiError.badRequest('Insufficient stars balance', { code: ERROR_CODES.VALIDATION_FAILED });
  }

  const isRequest = Boolean(body?.asRequest || (!isParent && child.auth_user_id === userId));

  if (isRequest) {
    const redemption = await prisma.rewardRedemption.create({
      data: {
        child_profile_id: childProfileId,
        reward_id: reward.id,
        points_spent: Number(reward.points_cost || 0),
        stars_spent: starsToSpend,
        cash_spent: Number(reward.cash_cost || 0),
        status: 'pending',
        requested_at: new Date()
      },
      include: { reward: true }
    });

    await createNotificationsForProfileMembers(child.parent_profile_id, {
      source: 'rewards',
      source_id: redemption.id,
      event_type: 'reward.requested',
      delivery_key: `reward:requested:${redemption.id}`,
      title: 'Star redemption request',
      body: `${child.display_name || child.child_name || 'Your child'} requested ${reward.title} (${starsToSpend} stars).`,
      action_url: `/Contacts/family/${child.id}?tab=activity`,
      priority: 'normal',
      metadata: {
        reward_id: reward.id,
        redemption_id: redemption.id,
        child_profile_id: childProfileId,
        stars_spent: starsToSpend
      }
    });

    return {
      redemption: pickPublicRedemption(redemption),
      stars_balance: child.stars_balance
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedChild = await tx.childProfile.update({
      where: { id: childProfileId },
      data: {
        stars_balance: { decrement: starsToSpend }
      }
    });

    const redemption = await tx.rewardRedemption.create({
      data: {
        child_profile_id: childProfileId,
        reward_id: reward.id,
        points_spent: Number(reward.points_cost || 0),
        stars_spent: starsToSpend,
        cash_spent: Number(reward.cash_cost || 0),
        status: 'approved',
        approved_by_user_id: userId,
        approved_at: new Date()
      },
      include: { reward: true }
    });

    await tx.childTransaction.create({
      data: {
        child_profile_id: childProfileId,
        transaction_type: 'reward_redemption',
        amount: -starsToSpend,
        currency_type: 'stars',
        description: `Redeemed: ${reward.title}`,
        status: 'completed',
        approved_by_user_id: userId,
        approved_at: new Date(),
        related_reward_id: reward.id,
        balance_after: updatedChild.stars_balance
      }
    });

    await tx.reward.update({
      where: { id: reward.id },
      data: {
        status: 'redeemed',
        redeemed_at: new Date(),
        redeemed_by_child_id: childProfileId,
        times_redeemed: { increment: 1 },
        ...(reward.stock_quantity !== null ? { stock_quantity: { decrement: 1 } } : {})
      }
    });

    await createNotificationsForProfileMembers(child.parent_profile_id, {
      source: 'rewards',
      source_id: redemption.id,
      event_type: 'reward.redeemed',
      delivery_key: `reward:redeemed:${redemption.id}`,
      title: 'Reward redeemed',
      body: `${child.display_name || child.name || 'A child'} redeemed ${reward.title}.`,
      action_url: `/Contacts/family/${child.id}?tab=rewards`,
      priority: 'normal',
      metadata: {
        reward_id: reward.id,
        redemption_id: redemption.id,
        child_profile_id: childProfileId,
        stars_spent: starsToSpend
      }
    }, { db: tx });

    return { redemption, child: updatedChild };
  });

  return {
    redemption: pickPublicRedemption(result.redemption),
    stars_balance: result.child.stars_balance
  };
}

async function listRedemptionsForChild(userId, childProfileId, filters = {}) {
  await findAccessibleChild(userId, childProfileId);

  const redemptions = await prisma.rewardRedemption.findMany({
    where: {
      child_profile_id: childProfileId,
      ...(filters.status ? { status: filters.status } : {})
    },
    include: { reward: true },
    orderBy: { requested_at: 'desc' }
  });

  return redemptions.map(pickPublicRedemption);
}

async function approveRedemptionForUser(userId, redemptionId) {
  const redemption = await findRedemptionForParentAccess(userId, redemptionId);

  const updated = redemption.status === 'pending'
    ? await prisma.$transaction(async (tx) => {
      const child = await tx.childProfile.findUnique({
        where: { id: redemption.child_profile_id }
      });
      const starsToSpend = Number(redemption.stars_spent || redemption.reward.star_cost || 0);

      if (Number(child?.stars_balance || 0) < starsToSpend) {
        throw ApiError.badRequest('Insufficient stars balance', { code: ERROR_CODES.VALIDATION_FAILED });
      }

      if (redemption.reward.stock_quantity !== null && redemption.reward.stock_quantity <= 0) {
        throw ApiError.badRequest('This reward is out of stock', { code: ERROR_CODES.VALIDATION_FAILED });
      }

      const updatedChild = await tx.childProfile.update({
        where: { id: redemption.child_profile_id },
        data: {
          stars_balance: { decrement: starsToSpend }
        }
      });

      await tx.childTransaction.create({
        data: {
          child_profile_id: redemption.child_profile_id,
          transaction_type: 'reward_redemption',
          amount: -starsToSpend,
          currency_type: 'stars',
          description: `Redeemed: ${redemption.reward.title}`,
          status: 'completed',
          approved_by_user_id: userId,
          approved_at: new Date(),
          related_reward_id: redemption.reward_id,
          balance_after: updatedChild.stars_balance
        }
      });

      await tx.reward.update({
        where: { id: redemption.reward_id },
        data: {
          times_redeemed: { increment: 1 },
          ...(redemption.reward.stock_quantity !== null ? { stock_quantity: { decrement: 1 } } : {})
        }
      });

      const updatedRedemption = await tx.rewardRedemption.update({
        where: { id: redemption.id },
        data: {
          stars_spent: starsToSpend,
          status: 'approved',
          approved_by_user_id: userId,
          approved_at: new Date()
        },
        include: { reward: true }
      });

      await notifyChildForReward(tx, child, {
        sourceId: redemption.id,
        eventType: 'reward.redemption_approved',
        deliveryKey: `reward:redemption_approved:${redemption.id}`,
        title: 'Reward approved',
        body: `${redemption.reward.title} was approved.`,
        actionUrl: '/Goals',
        metadata: {
          reward_id: redemption.reward_id,
          redemption_id: redemption.id,
          stars_spent: starsToSpend
        }
      });

      return updatedRedemption;
    })
    : await prisma.rewardRedemption.update({
      where: { id: redemption.id },
      data: {
        status: 'approved',
        approved_by_user_id: userId,
        approved_at: new Date()
      },
      include: { reward: true }
    });

  if (redemption.status !== 'pending') {
    await notifyChildForReward(prisma, redemption.child_profile, {
      sourceId: redemption.id,
      eventType: 'reward.redemption_approved',
      deliveryKey: `reward:redemption_approved:${redemption.id}`,
      title: 'Reward approved',
      body: `${redemption.reward.title} was approved.`,
      actionUrl: '/Goals',
      metadata: {
        reward_id: redemption.reward_id,
        redemption_id: redemption.id,
        stars_spent: Number(redemption.stars_spent || redemption.reward.star_cost || 0)
      }
    });
  }

  return pickPublicRedemption(updated);
}

async function rejectRedemptionForUser(userId, redemptionId, reason = null) {
  const redemption = await findRedemptionForParentAccess(userId, redemptionId);

  const updated = await prisma.$transaction(async (tx) => {
    const rejected = await tx.rewardRedemption.update({
      where: { id: redemption.id },
      data: {
        status: 'rejected',
        approved_by_user_id: userId,
        approved_at: new Date(),
        rejection_reason: normalizeNullableString(reason)
      },
      include: { reward: true }
    });

    await notifyChildForReward(tx, redemption.child_profile, {
      sourceId: redemption.id,
      eventType: 'reward.redemption_rejected',
      deliveryKey: `reward:redemption_rejected:${redemption.id}`,
      title: 'Reward rejected',
      body: reason ? `${redemption.reward.title} was rejected: ${reason}` : `${redemption.reward.title} was rejected.`,
      actionUrl: '/Goals',
      metadata: {
        reward_id: redemption.reward_id,
        redemption_id: redemption.id,
        rejection_reason: normalizeNullableString(reason)
      }
    });

    return rejected;
  });

  return pickPublicRedemption(updated);
}

async function fulfillRedemptionForUser(userId, redemptionId, notes = null) {
  const redemption = await findRedemptionForParentAccess(userId, redemptionId);

  const updated = await prisma.$transaction(async (tx) => {
    const fulfilled = await tx.rewardRedemption.update({
      where: { id: redemption.id },
      data: {
        status: 'fulfilled',
        fulfilled_by_user_id: userId,
        fulfilled_at: new Date(),
        notes: normalizeNullableString(notes)
      },
      include: { reward: true }
    });

    await notifyChildForReward(tx, redemption.child_profile, {
      sourceId: redemption.id,
      eventType: 'reward.redemption_fulfilled',
      deliveryKey: `reward:redemption_fulfilled:${redemption.id}`,
      title: 'Reward fulfilled',
      body: `${redemption.reward.title} was fulfilled.`,
      actionUrl: '/Goals',
      metadata: {
        reward_id: redemption.reward_id,
        redemption_id: redemption.id,
        notes: normalizeNullableString(notes)
      }
    });

    return fulfilled;
  });

  return pickPublicRedemption(updated);
}

async function updateRedemptionNotesForUser(userId, redemptionId, notes = null) {
  const redemption = await findRedemptionForParentAccess(userId, redemptionId);
  const updated = await prisma.rewardRedemption.update({
    where: { id: redemption.id },
    data: { notes: normalizeNullableString(notes) },
    include: { reward: true }
  });
  return pickPublicRedemption(updated);
}

async function listActivityForChild(userId, childProfileId) {
  const child = await findAccessibleChild(userId, childProfileId);

  const [completions, redemptions, directTransactions] = await Promise.all([
    prisma.taskCompletion.findMany({
      where: { child_profile_id: childProfileId },
      include: { task: true },
      orderBy: { submitted_at: 'desc' },
      take: 50
    }),
    prisma.rewardRedemption.findMany({
      where: { child_profile_id: childProfileId },
      include: { reward: true },
      orderBy: { requested_at: 'desc' },
      take: 50
    }),
    prisma.childTransaction.findMany({
      where: {
        child_profile_id: childProfileId,
        currency_type: 'stars',
        transaction_type: { in: ['star_award', 'task_reward', 'reward_redemption'] }
      },
      include: {
        related_task: true,
        related_reward: true
      },
      orderBy: { created_at: 'desc' },
      take: 50
    })
  ]);

  const completionEvents = completions.map((completion) => {
    let type = 'task_pending';
    let starsDelta = Number(completion.task?.star_reward || completion.task?.points_reward || completion.task?.points_value || 0);
    let time = completion.submitted_at;

    if (completion.status === 'approved') {
      type = 'task_approved';
      starsDelta = Number(completion.stars_earned || 0);
      time = completion.reviewed_at || completion.submitted_at;
    } else if (completion.status === 'rejected') {
      type = 'task_rejected';
      starsDelta = 0;
      time = completion.reviewed_at || completion.submitted_at;
    }

    return {
      id: `tc-${completion.id}`,
      completionId: completion.id,
      taskId: completion.task_id,
      type,
      description: completion.task?.title || 'Task',
      starsDelta,
      time
    };
  });

  const redemptionEvents = redemptions.map((redemption) => {
    const isCashIn = redemption.reward?.category === 'Cash In' || redemption.reward?.description === 'Instant Cash In';
    const isPending = redemption.status === 'pending';
    return {
      id: `rr-${redemption.id}`,
      redemptionId: redemption.id,
      type: isPending ? 'redemption_pending' : (isCashIn ? 'cash_in' : 'reward_redeemed'),
      status: redemption.status,
      description: redemption.reward?.title || 'Reward',
      starsDelta: -Number(redemption.stars_spent || redemption.reward?.star_cost || 0),
      time: redemption.requested_at || redemption.fulfilled_at || redemption.approved_at || redemption.created_at,
      notes: redemption.notes || null
    };
  });

  const transactionEvents = directTransactions
    .filter((transaction) => !shouldSkipTransactionEvent(transaction))
    .map((transaction) => ({
      id: `ct-${transaction.id}`,
      type: transaction.transaction_type === 'reward_redemption' ? 'reward_redeemed' : 'stars_awarded',
      description: transaction.related_task?.title || transaction.related_reward?.title || transaction.description,
      starsDelta: Number(transaction.amount || 0),
      time: transaction.created_at
    }));

  const events = [...completionEvents, ...redemptionEvents, ...transactionEvents]
    .filter((event) => event.time)
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 100);

  let runningBalance = Number(child.stars_balance || 0);
  const withBalances = events.map((event) => {
    const balanceAfter = runningBalance;
    runningBalance -= Number(event.starsDelta || 0);
    return { ...event, balanceAfter };
  });

  return {
    stars_balance: child.stars_balance,
    events: withBalances
  };
}

function shouldSkipTransactionEvent(transaction) {
  if (transaction.transaction_type === 'task_reward') return false;
  if (transaction.transaction_type === 'star_award') return false;
  return transaction.transaction_type === 'reward_redemption';
}

async function findRewardForParentAccess(userId, rewardId) {
  const reward = await prisma.reward.findFirst({
    where: {
      id: rewardId,
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

  if (!reward || !hasProfileRole(reward.profile, userId, PARENT_REWARD_ROLES)) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reward not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return reward;
}

async function findRedemptionForParentAccess(userId, redemptionId) {
  const redemption = await prisma.rewardRedemption.findFirst({
    where: { id: redemptionId },
    include: {
      reward: {
        include: {
          profile: {
            include: { memberships: true }
          }
        }
      }
    }
  });

  if (!redemption || !hasProfileRole(redemption.reward.profile, userId, PARENT_REWARD_ROLES)) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Reward redemption not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return redemption;
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

async function requireProfileRewardAccess(userId, profileId) {
  const membership = await prisma.profileMembership.findFirst({
    where: {
      user_id: userId,
      profile_id: profileId,
      role: { in: PARENT_REWARD_ROLES },
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

function pickPublicReward(reward) {
  if (!reward) return null;

  return {
    id: reward.id,
    profile_id: reward.profile_id,
    assigned_to_child_id: reward.assigned_to_child_id,
    title: reward.title,
    description: reward.description,
    points_cost: reward.points_cost,
    star_cost: reward.star_cost,
    cash_cost: Number(reward.cash_cost || 0),
    category: reward.category,
    icon: reward.icon,
    color: reward.color,
    image_url: reward.image_url,
    is_active: reward.is_active,
    requires_approval_threshold: reward.requires_approval_threshold,
    stock_quantity: reward.stock_quantity,
    times_redeemed: reward.times_redeemed,
    status: reward.status,
    expires_at: reward.expires_at,
    redeemed_at: reward.redeemed_at,
    redeemed_by_child_id: reward.redeemed_by_child_id,
    age_restriction: reward.age_restriction,
    created_by_user_id: reward.created_by_user_id,
    metadata: reward.metadata,
    created_at: reward.created_at,
    updated_at: reward.updated_at
  };
}

function pickPublicRedemption(redemption) {
  if (!redemption) return null;

  return {
    id: redemption.id,
    child_profile_id: redemption.child_profile_id,
    reward_id: redemption.reward_id,
    points_spent: redemption.points_spent,
    stars_spent: redemption.stars_spent,
    cash_spent: Number(redemption.cash_spent || 0),
    status: redemption.status,
    requested_at: redemption.requested_at,
    approved_at: redemption.approved_at,
    approved_by_user_id: redemption.approved_by_user_id,
    fulfilled_at: redemption.fulfilled_at,
    fulfilled_by_user_id: redemption.fulfilled_by_user_id,
    rejection_reason: redemption.rejection_reason,
    notes: redemption.notes,
    metadata: redemption.metadata,
    rewards: redemption.reward ? pickPublicReward(redemption.reward) : undefined,
    reward: redemption.reward ? pickPublicReward(redemption.reward) : undefined
  };
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.parseInt(value, 10);
}

function normalizePositiveInteger(value, field, max = 1000000) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > max) {
    throw ApiError.badRequest(`Expected a positive integer up to ${max.toLocaleString()}`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field, message: `Must be between 1 and ${max.toLocaleString()}` }]
    });
  }
  return number;
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRewardStatus(value) {
  const allowed = ['available', 'pending', 'approved', 'rejected', 'fulfilled', 'cancelled', 'redeemed'];
  return allowed.includes(value) ? value : null;
}

async function uploadRewardImage(file, context) {
  if (!file?.buffer?.length) return null;

  const contentType = file.contentType || file.mimetype || 'application/octet-stream';
  const fileName = file.originalName || file.originalname || 'reward-image';

  if (!String(contentType).toLowerCase().startsWith('image/')) {
    throw ApiError.badRequest('Reward image must be an image file', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'image', message: 'Must be an image file' }]
    });
  }

  if (file.size > MAX_REWARD_IMAGE_BYTES) {
    throw ApiError.badRequest('Reward image is too large', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'image', message: 'Must be 5MB or smaller' }]
    });
  }

  return uploadPublicObject({
    category: 'rewards',
    profileId: context.profileId,
    fileName,
    contentType,
    fileSize: file.size,
    body: file.buffer
  }, {
    userId: context.userId,
    publicFilesBaseUrl: context.publicFilesBaseUrl
  });
}

async function deletePublicFile(publicUrl) {
  const key = extractKeyFromPublicUrl(publicUrl);
  if (!key) return;

  try {
    await deleteObject(key);
  } catch (error) {
    console.error('Failed to delete reward image:', error);
  }
}

function parseOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function notifyChildForReward(db, child, {
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
    source: 'rewards',
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
  listRewardsForChild,
  createRewardForProfile,
  updateRewardForUser,
  deleteRewardForUser,
  redeemRewardForChild,
  listRedemptionsForChild,
  approveRedemptionForUser,
  rejectRedemptionForUser,
  fulfillRedemptionForUser,
  updateRedemptionNotesForUser,
  listActivityForChild
};
