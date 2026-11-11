const express = require("express");
const { authenticate } = require("../../middleware/authenticate");
const {
  listRecipes,
  createRecipe,
  updateRecipe,
  deleteRecipe,
} = require("../../controllers/recipe.controller");

const router = express.Router();

router.use(authenticate);

router.get("/", listRecipes);
router.post("/", createRecipe);
router.patch("/:recipeId", updateRecipe);
router.put("/:recipeId", updateRecipe);
router.delete("/:recipeId", deleteRecipe);

module.exports = router;
