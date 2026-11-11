const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listTransactionsForProfile,
  getTransactionForProfile,
  listTransactionSplitsForProfile,
  replaceTransactionSplitsForProfile,
  deleteTransactionSplitsForProfile,
  createTransactionForProfile,
  createTransactionsForProfile,
  updateTransactionForProfile,
  deleteTransactionForProfile,
  findDuplicateTransactionsForProfile,
  resolveDuplicateTransactionsForProfile,
  undoPostedTransactionForProfile,
  postTransactionForProfile
} = require('../services/transaction.service');

const findDuplicateTransactions = asyncHandler(async (req, res) => {
  return ok(res, await findDuplicateTransactionsForProfile(req.profileAccess.profileId, req.query));
});

const resolveDuplicateTransactions = asyncHandler(async (req, res) => {
  return ok(res, await resolveDuplicateTransactionsForProfile(req.profileAccess.profileId, req.auth.sub, req.body));
});

const listTransactions = asyncHandler(async (req, res) => {
  return ok(res, await listTransactionsForProfile(req.profileAccess.profileId, req.query));
});

const getTransaction = asyncHandler(async (req, res) => {
  return ok(res, {
    transaction: await getTransactionForProfile(req.profileAccess.profileId, req.params.transactionId)
  });
});

const listTransactionSplits = asyncHandler(async (req, res) => {
  return ok(res, {
    splits: await listTransactionSplitsForProfile(req.profileAccess.profileId, req.params.transactionId)
  });
});

const replaceTransactionSplits = asyncHandler(async (req, res) => {
  const transaction = await replaceTransactionSplitsForProfile(
    req.profileAccess.profileId,
    req.params.transactionId,
    req.body.splits,
    req.auth.sub
  );

  return ok(res, { transaction, splits: transaction.splits || [] });
});

const deleteTransactionSplits = asyncHandler(async (req, res) => {
  const transaction = await deleteTransactionSplitsForProfile(
    req.profileAccess.profileId,
    req.params.transactionId,
    req.auth.sub
  );

  return ok(res, { transaction, splits: [] });
});

const createTransaction = asyncHandler(async (req, res) => {
  return created(res, {
    transaction: await createTransactionForProfile(req.profileAccess.profileId, req.body, req.auth.sub)
  });
});

const createTransactions = asyncHandler(async (req, res) => {
  return created(res, {
    transactions: await createTransactionsForProfile(
      req.profileAccess.profileId,
      req.body.transactions,
      req.auth.sub,
      req.body.importMetadata
    )
  });
});

const updateTransaction = asyncHandler(async (req, res) => {
  return ok(res, {
    transaction: await updateTransactionForProfile(req.profileAccess.profileId, req.params.transactionId, req.body, req.auth.sub)
  });
});

const deleteTransaction = asyncHandler(async (req, res) => {
  return ok(res, await deleteTransactionForProfile(req.profileAccess.profileId, req.params.transactionId, req.auth.sub));
});

const undoPostedTransaction = asyncHandler(async (req, res) => {
  return ok(res, {
    transaction: await undoPostedTransactionForProfile(req.profileAccess.profileId, req.params.transactionId, req.auth.sub)
  });
});

const postTransaction = asyncHandler(async (req, res) => {
  return ok(res, {
    transaction: await postTransactionForProfile(req.profileAccess.profileId, req.params.transactionId, req.auth.sub)
  });
});

module.exports = {
  listTransactions,
  getTransaction,
  listTransactionSplits,
  replaceTransactionSplits,
  deleteTransactionSplits,
  createTransaction,
  createTransactions,
  updateTransaction,
  deleteTransaction,
  undoPostedTransaction,
  postTransaction,
  findDuplicateTransactions,
  resolveDuplicateTransactions
};
