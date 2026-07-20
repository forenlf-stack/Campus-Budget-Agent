import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("dev.db");
const userId = "user_demo_001";
const now = new Date().toISOString();

const candidates = [
  ["meal_001", "鸡腿饭套餐", "第一食堂一楼", 1500, "东校区", "LUNCH", ["米饭套餐", "高蛋白"], ["大米", "鸡肉", "青菜"], 0, 5],
  ["meal_002", "番茄鸡蛋面", "第一食堂面档", 1200, "东校区", "ALL_DAY", ["面食", "清淡"], ["小麦", "鸡蛋", "番茄"], 0, 4],
  ["meal_003", "青椒肉丝盖饭", "第二食堂盖饭档", 1600, "东校区", "LUNCH", ["米饭套餐", "家常菜"], ["大米", "猪肉", "青椒"], 1, 4],
  ["meal_004", "牛肉米线", "校园餐厅米线档", 1800, "东校区", "ALL_DAY", ["米线", "汤粉"], ["大米", "牛肉"], 1, 5],
  ["meal_005", "素三鲜水饺", "第一食堂饺子档", 1400, "东校区", "DINNER", ["面食", "素食"], ["小麦", "鸡蛋", "韭菜"], 0, 4],
  ["meal_006", "小米粥鸡蛋套餐", "校园餐厅早餐档", 650, "东校区", "BREAKFAST", ["早餐", "清淡"], ["小米", "鸡蛋"], 0, 4],
  ["meal_007", "豆浆油条套餐", "第一食堂早餐档", 550, "东校区", "BREAKFAST", ["早餐", "豆制品"], ["大豆", "小麦"], 0, 3],
  ["meal_008", "照烧鸡排饭", "第三食堂一楼", 1700, "西校区", "LUNCH", ["米饭套餐", "甜咸"], ["大米", "鸡肉", "芝麻"], 0, 5],
  ["meal_009", "清汤牛肉面", "西区兰州面馆", 1600, "西校区", "ALL_DAY", ["面食", "清汤"], ["小麦", "牛肉"], 0, 4],
  ["meal_010", "石锅拌饭", "西区风味餐厅", 1900, "西校区", "DINNER", ["米饭套餐", "蔬菜丰富"], ["大米", "鸡蛋", "芝麻"], 1, 4],
  ["meal_011", "香菇滑鸡饭", "图书馆餐厅", 1550, "中心校区", "LUNCH", ["米饭套餐", "清淡"], ["大米", "鸡肉", "香菇"], 0, 5],
  ["meal_012", "菌菇汤面", "图书馆餐厅", 1250, "中心校区", "DINNER", ["面食", "素食"], ["小麦", "菌菇", "青菜"], 0, 4],
];

database.exec("PRAGMA foreign_keys = ON");
database.exec("BEGIN IMMEDIATE");
try {
  const user = database.prepare(`SELECT "id" FROM "UserProfile" WHERE "id" = ?`).get(userId);
  if (!user) throw new Error("未找到演示用户，请先执行 npm run db:seed");
  const insert = database.prepare(`
    INSERT OR IGNORE INTO "MealCandidate" (
      "id", "userId", "name", "merchant", "typicalPriceCents", "location", "mealPeriod",
      "tags", "ingredients", "isSpicy", "userRating", "lastPurchasedAt", "priceUpdatedAt",
      "dataSource", "enabled", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'SEED', 1, ?, ?)
  `);
  let inserted = 0;
  for (const candidate of candidates) {
    inserted += Number(insert.run(
      candidate[0], userId, candidate[1], candidate[2], candidate[3], candidate[4], candidate[5],
      JSON.stringify(candidate[6]), JSON.stringify(candidate[7]), candidate[8], candidate[9], now, now, now,
    ).changes);
  }
  database.exec("COMMIT");
  const total = database.prepare(`SELECT COUNT(*) AS count FROM "MealCandidate" WHERE "userId" = ?`).get(userId).count;
  console.log(JSON.stringify({ inserted, total }));
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}
