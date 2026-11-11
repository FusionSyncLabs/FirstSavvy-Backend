const { ok, created } = require("../utils/apiResponse");
const { asyncHandler } = require("../utils/asyncHandler");
const {
  listCategories,
  createCategory,
} = require("../services/category.service");

const listAllCategories = asyncHandler(async (_, res) => {
  return ok(res, {
    categories: await listCategories(),
  });
});

const createNewCategory = asyncHandler(async (req, res) => {
  const category = await createCategory(req.auth.sub, req.body);
  return created(res, { category });
});

module.exports = {
  listAllCategories,
  createNewCategory,
};
