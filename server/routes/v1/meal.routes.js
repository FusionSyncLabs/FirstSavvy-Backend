const express = require("express");
const { authenticate } = require("../../middleware/authenticate");
const {
  listMealPlans,
  setMealPlan,
  removeMealPlan,
} = require("../../controllers/meal.controller");

const router = express.Router();

router.use(authenticate);

router.get("/", listMealPlans);
router.post("/", setMealPlan);
router.delete("/:mealId", removeMealPlan);
router.delete("/", removeMealPlan);

module.exports = router;
