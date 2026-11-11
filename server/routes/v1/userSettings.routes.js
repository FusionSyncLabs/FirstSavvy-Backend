const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { prisma } = require('../../config/database');
const { ok } = require('../../utils/apiResponse');
const { asyncHandler } = require('../../utils/asyncHandler');

const router = express.Router();

const DEFAULT_SETTINGS = {
  theme: 'light',
  compactView: false,
  notifications: {
    emailNotifications: true,
    transactionAlerts: true,
    budgetAlerts: true
  }
};

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const existing = await prisma.userSetting.findUnique({
      where: { user_id: req.auth.sub }
    });
    const rawSettings =
      existing?.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
        ? existing.settings
        : {};

    return ok(res, {
      settings: {
        ...DEFAULT_SETTINGS,
        ...rawSettings,
        notifications: {
          ...DEFAULT_SETTINGS.notifications,
          ...(rawSettings.notifications && typeof rawSettings.notifications === 'object'
            ? rawSettings.notifications
            : {})
        }
      }
    });
  })
);

router.patch(
  '/',
  asyncHandler(async (req, res) => {
    const existing = await prisma.userSetting.findUnique({
      where: { user_id: req.auth.sub }
    });
    const currentSettings =
      existing?.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
        ? existing.settings
        : {};

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      ...currentSettings
    };

    if (typeof body.theme === 'string' && ['light', 'dark', 'system'].includes(body.theme)) {
      nextSettings.theme = body.theme;
    }

    if (typeof body.compactView === 'boolean') {
      nextSettings.compactView = body.compactView;
    }

    if (body.notifications && typeof body.notifications === 'object') {
      nextSettings.notifications = {
        ...DEFAULT_SETTINGS.notifications,
        ...(currentSettings.notifications && typeof currentSettings.notifications === 'object'
          ? currentSettings.notifications
          : {}),
        ...(typeof body.notifications.emailNotifications === 'boolean'
          ? { emailNotifications: body.notifications.emailNotifications }
          : {}),
        ...(typeof body.notifications.transactionAlerts === 'boolean'
          ? { transactionAlerts: body.notifications.transactionAlerts }
          : {}),
        ...(typeof body.notifications.budgetAlerts === 'boolean'
          ? { budgetAlerts: body.notifications.budgetAlerts }
          : {}),
        ...(typeof body.notifications.taskActivity === 'boolean'
          ? { taskActivity: body.notifications.taskActivity }
          : {}),
        ...(typeof body.notifications.taskUpdates === 'boolean'
          ? { taskUpdates: body.notifications.taskUpdates }
          : {}),
        ...(typeof body.notifications.rewardActivity === 'boolean'
          ? { rewardActivity: body.notifications.rewardActivity }
          : {}),
        ...(typeof body.notifications.householdChatter === 'boolean'
          ? { householdChatter: body.notifications.householdChatter }
          : {})
      };
    }

    await prisma.userSetting.upsert({
      where: { user_id: req.auth.sub },
      create: {
        user_id: req.auth.sub,
        settings: nextSettings
      },
      update: {
        settings: nextSettings
      }
    });

    return ok(res, {
      settings: nextSettings
    });
  })
);

module.exports = router;

