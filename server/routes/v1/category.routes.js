const express = require("express");
const { validateRequest } = require("../../middleware/validateRequest");
const { authenticate } = require("../../middleware/authenticate");
const {
  listAllCategories,
  createNewCategory,
} = require("../../controllers/category.controller");

const router = express.Router();

const categoryCreateSchema = {
  name: { type: "string", minLength: 1, maxLength: 50 },
  description: { type: "string", maxLength: 500 },
};

router.use(authenticate);

router.get("/", listAllCategories);
router.post(
  "/",
  validateRequest({ body: categoryCreateSchema }),
  createNewCategory,
);

module.exports = router;
