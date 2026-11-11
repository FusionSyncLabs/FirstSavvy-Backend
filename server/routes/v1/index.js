const express = require("express");
const { env } = require("../../config/env");

const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");
const otpRoutes = require("./otp.routes");
const phoneVerificationRoutes = require("./phoneVerification.routes");
const secretKeyRoutes = require("./secretKey.routes");
const twoFactorRoutes = require("./twoFactor.routes");
const profileRoutes = require("./profile.routes");
const contactRoutes = require("./contact.routes");
const accountRoutes = require("./account.routes");
const transactionRoutes = require("./transaction.routes");
const transferMatchingRoutes = require("./transferMatching.routes");
const transactionRuleRoutes = require("./transactionRule.routes");
const bankingRoutes = require("./banking.routes");
const dashboardRoutes = require("./dashboard.routes");
const budgetRoutes = require("./budget.routes");
const netWorthRoutes = require("./netWorth.routes");
const viewPreferenceRoutes = require("./viewPreference.routes");
const csvMappingConfigRoutes = require("./csvMappingConfig.routes");
const protectedConfigurationRoutes = require("./protectedConfiguration.routes");
const journalEntryRoutes = require("./journalEntry.routes");
const taskRoutes = require("./task.routes");
const rewardRoutes = require("./reward.routes");
const vaultRoutes = require("./vault.routes");
const goalRoutes = require("./goal.routes");
const globalSearchRoutes = require("./globalSearch.routes");
const calendarRoutes = require("./calendar.routes");
const notificationRoutes = require("./notification.routes");
const collaborationRoutes = require("./collaboration.routes");
const fileRoutes = require("./file.routes");
const plaidRoutes = require("./plaid.routes");
const creditRoutes = require("./credit.routes");

const eventRoutes = require("./event.routes");
const referralRoutes = require("./referral.routes");
const recipeRoutes = require("./recipe.routes");
const mealRoutes = require("./meal.routes");
const categoryRoutes = require("./category.routes");
const userSettingsRoutes = require("./userSettings.routes");

const { blockChildAccounts } = require("../../middleware/blockChildAccounts");

const router = express.Router();

// Child-account logins must never reach adult-only financial or vault APIs.
const ADULT_ONLY_PATHS = ["/accounts", "/transactions", "/transfer-matches", "/transaction-rules", "/banking", "/plaid", "/credit", "/budgets", "/net-worth", "/csv-mapping-configs", "/protected-configurations", "/journal-entries", "/vault"];
router.use(ADULT_ONLY_PATHS, blockChildAccounts);

// Health + General
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/otp", otpRoutes);
router.use("/phone-verification", phoneVerificationRoutes);
router.use("/secret-keys", secretKeyRoutes);
router.use("/two-factor", twoFactorRoutes);
router.use("/referrals", referralRoutes);
router.use("/dashboard", dashboardRoutes);

// Profile and contacts
router.use("/profiles", profileRoutes);
router.use("/user-settings", userSettingsRoutes);
router.use("/collaboration", collaborationRoutes);
router.use("/contacts", contactRoutes);
router.use("/tasks", taskRoutes);
router.use("/rewards", rewardRoutes);

// Finance
router.use("/accounts", accountRoutes);
router.use("/transactions", transactionRoutes);
router.use("/transfer-matches", transferMatchingRoutes);
router.use("/transaction-rules", transactionRuleRoutes);
router.use("/banking", bankingRoutes);
router.use("/plaid", plaidRoutes);
router.use("/credit", creditRoutes);
router.use("/budgets", budgetRoutes);
router.use("/goals", goalRoutes);
router.use("/calendar", calendarRoutes);
router.use("/notifications", notificationRoutes);
router.use("/files", fileRoutes);
router.use("/search", globalSearchRoutes);
router.use("/net-worth", netWorthRoutes);
router.use("/view-preferences", viewPreferenceRoutes);
router.use("/csv-mapping-configs", csvMappingConfigRoutes);
router.use("/protected-configurations", protectedConfigurationRoutes);
router.use("/journal-entries", journalEntryRoutes);

router.use("/vault", vaultRoutes);

router.use("/events", eventRoutes);
router.use("/recipes", recipeRoutes);
router.use("/meals", mealRoutes);
router.use("/categories", categoryRoutes);

// Development routes (only in non-production environments)
if (!env.isProduction) {
  const devRoutes = require("./dev.routes");
  router.use("/dev", devRoutes);
}

module.exports = router;
