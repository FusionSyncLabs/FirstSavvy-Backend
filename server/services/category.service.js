const { prisma } = require("../config/database");

async function createCategory(input = {}) {
  const category = await prisma.category.create({
    data: {
      name: input.name,
      description: input.description || null,
    },
  });

  return pickPublicCategory(category);
}

async function listCategories() {
  const where = { deleted_at: null };
  const categories = await prisma.category.findMany({
    where,
    orderBy: [{ created_at: "desc" }],
  });

  return categories.map(pickPublicCategory);
}

function pickPublicCategory(category) {
  if (!category) return null;

  return {
    id: category.id,
    name: category.name,
    description: category.description,
    created_at: category.created_at,
  };
}

module.exports = {
  listCategories,
  createCategory,
};
