import { ensureDefaultCategories } from "../src/lib/cost-service";
import { db } from "../src/lib/db";

async function main() {
  console.log("Seeding default Cost Management categories into company_os_dev...");
  await ensureDefaultCategories();
  const count = await db.expenseCategory.count();
  const parents = await db.expenseCategory.count({ where: { parentId: null } });
  console.log(`Successfully seeded categories! Total categories: ${count} (${parents} top-level parents).`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error("Error seeding categories:", err);
  process.exit(1);
});

