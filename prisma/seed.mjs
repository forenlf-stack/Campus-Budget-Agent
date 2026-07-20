import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync } from "node:crypto";

const database = new DatabaseSync("dev.db");
const userId = "user_demo_001";
const periodStart = "2026-07-01T00:00:00.000Z";
const now = "2026-07-14T00:00:00.000Z";

function demoPasswordHash() {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync("Demo1234", salt, 64).toString("hex")}`;
}

const budgets = [
  ["MEAL", 55000],
  ["SNACK_DRINK", 10000],
  ["DAILY_NECESSITY", 10000],
  ["STUDY", 10000],
  ["TRANSPORT", 5000],
  ["GAME_ENTERTAINMENT", 5000],
  ["RECHARGE_SUBSCRIPTION", 5000],
  ["MEDICAL", 5000],
  ["OTHER", 5000],
];

const transactions = [
  ["tx_001", "INCOME", null, "MANUAL", 180000, "2026-07-01T01:00:00.000Z", "七月生活费", "家庭转账", null, null],
  ["tx_002", "EXPENSE", "MEAL", "MANUAL", 1250, "2026-07-01T04:10:00.000Z", "食堂午餐", "第一食堂", null, null],
  ["tx_003", "EXPENSE", "TRANSPORT", "MANUAL", 200, "2026-07-01T10:20:00.000Z", "公交出行", "城市公交", null, null],
  ["tx_004", "EXPENSE", "MEAL", "MANUAL", 980, "2026-07-02T00:15:00.000Z", "早餐", "校园餐厅", null, null],
  ["tx_005", "EXPENSE", "SNACK_DRINK", "MANUAL", 650, "2026-07-02T07:30:00.000Z", "无糖茶", "校园超市", null, null],
  ["tx_006", "EXPENSE", "STUDY", "MANUAL", 3290, "2026-07-03T06:00:00.000Z", "专业教材", "大学书店", null, null],
  ["tx_007", "EXPENSE", "MEAL", "MANUAL", 1680, "2026-07-03T10:40:00.000Z", "晚餐", "第二食堂", null, null],
  ["tx_008", "EXPENSE", "DAILY_NECESSITY", "MANUAL", 1890, "2026-07-04T03:20:00.000Z", "洗衣液", "校园超市", null, null],
  ["tx_009", "EXPENSE", "RECHARGE_SUBSCRIPTION", "MANUAL", 3000, "2026-07-04T09:00:00.000Z", "手机话费", "通信运营商", null, null],
  ["tx_010", "EXPENSE", "GAME_ENTERTAINMENT", "MANUAL", 2500, "2026-07-05T11:10:00.000Z", "电影票", "校园影院", null, null],
  ["tx_011", "EXPENSE", "MEAL", "MANUAL", 2280, "2026-07-06T04:25:00.000Z", "周末聚餐", "校外餐馆", null, null],
  ["tx_012", "EXPENSE", "MEDICAL", "MANUAL", 1580, "2026-07-06T08:35:00.000Z", "常用药", "校医院", null, null],
  ["tx_013", "INCOME", null, "MANUAL", 5000, "2026-07-07T02:00:00.000Z", "勤工助学", "图书馆", null, null],
  ["tx_014", "EXPENSE", "SNACK_DRINK", "MANUAL", 1280, "2026-07-07T07:45:00.000Z", "水果和酸奶", "水果店", null, null],
  ["tx_015", "EXPENSE", "TRANSPORT", "MANUAL", 460, "2026-07-08T01:20:00.000Z", "地铁出行", "城市地铁", null, null],
  ["tx_016", "EXPENSE", "STUDY", "MANUAL", 890, "2026-07-08T06:50:00.000Z", "笔记本和签字笔", "文具店", null, null],
  ["tx_017", "EXPENSE", "MEAL", "MANUAL", 1350, "2026-07-09T04:00:00.000Z", "食堂午餐", "第一食堂", null, null],
  ["tx_018", "EXPENSE", "OTHER", "MANUAL", 1200, "2026-07-10T05:30:00.000Z", "打印照片", "校园打印店", null, null],
  ["tx_019", "EXPENSE", "DAILY_NECESSITY", "MANUAL", 2590, "2026-07-11T03:10:00.000Z", "雨伞", "校园超市", null, null],
  ["tx_020", "EXPENSE", "GAME_ENTERTAINMENT", "MANUAL", 1800, "2026-07-12T12:00:00.000Z", "桌游活动", "桌游店", null, null],
  ["tx_021", "EXPENSE", "MEAL", "MANUAL", 1450, "2026-07-13T04:15:00.000Z", "午餐", "第二食堂", null, null],
  ["tx_022", "REFUND", "DAILY_NECESSITY", "MANUAL", 2590, "2026-07-13T08:30:00.000Z", "雨伞退款", "校园超市", "商品质量问题退款", "tx_019"],
  ["tx_023", "EXPENSE", "SNACK_DRINK", "CSV", 750, "2026-07-14T06:20:00.000Z", "咖啡", "咖啡店", null, null],
  ["tx_024", "EXPENSE", "MEAL", "AGENT", 1180, "2026-07-14T10:10:00.000Z", "晚餐", "校园餐厅", "模拟后续 Agent 来源", null],
];

const mealCandidates = [
  ["meal_001", "鸡腿饭套餐", "第一食堂一楼", 1500, "东校区", "LUNCH", ["米饭套餐", "高蛋白"], ["大米", "鸡肉", "青菜"], 0, 5],
  ["meal_002", "番茄鸡蛋面", "第一食堂面档", 1200, "东校区", "ALL_DAY", ["面食", "清淡"], ["小麦", "鸡蛋", "番茄"], 0, 4],
  ["meal_003", "麻辣香锅", "第二食堂二楼", 2200, "东校区", "LUNCH", ["米饭套餐", "重口味"], ["蔬菜", "肉类", "花生"], 1, 4],
  ["meal_004", "青椒肉丝盖饭", "第二食堂盖饭档", 1600, "东校区", "LUNCH", ["米饭套餐", "家常菜"], ["大米", "猪肉", "青椒"], 1, null],
  ["meal_005", "牛肉米线", "校园餐厅米线档", 1800, "东校区", "ALL_DAY", ["米线", "汤粉"], ["大米", "牛肉", "香菜"], 1, 5],
  ["meal_006", "素三鲜水饺", "第一食堂饺子档", 1400, "东校区", "DINNER", ["面食", "素食"], ["小麦", "鸡蛋", "韭菜"], 0, 4],
  ["meal_007", "小米粥鸡蛋套餐", "校园餐厅早餐档", 650, "东校区", "BREAKFAST", ["早餐", "清淡"], ["小米", "鸡蛋"], 0, null],
  ["meal_008", "豆浆油条套餐", "第一食堂早餐档", 550, "东校区", "BREAKFAST", ["早餐", "豆制品"], ["大豆", "小麦"], 0, 3],
  ["meal_009", "照烧鸡排饭", "第三食堂一楼", 1700, "西校区", "LUNCH", ["米饭套餐", "甜咸"], ["大米", "鸡肉", "芝麻"], 0, 5],
  ["meal_010", "酸辣粉", "第三食堂粉面档", 1300, "西校区", "ALL_DAY", ["粉面", "酸辣"], ["红薯粉", "花生", "辣椒"], 1, 4],
  ["meal_011", "清汤牛肉面", "西区兰州面馆", 1600, "西校区", "ALL_DAY", ["面食", "清汤"], ["小麦", "牛肉", "香菜"], 0, 4],
  ["meal_012", "石锅拌饭", "西区风味餐厅", 1900, "西校区", "DINNER", ["米饭套餐", "蔬菜丰富"], ["大米", "鸡蛋", "芝麻"], 1, null],
  ["meal_013", "香菇滑鸡饭", "图书馆餐厅", 1550, "中心校区", "LUNCH", ["米饭套餐", "清淡"], ["大米", "鸡肉", "香菇"], 0, 5],
  ["meal_014", "菌菇汤面", "图书馆餐厅", 1250, "中心校区", "DINNER", ["面食", "素食"], ["小麦", "菌菇", "青菜"], 0, 4],
  ["meal_015", "咖喱鸡肉饭", "中心美食广场", 1850, "中心校区", "LUNCH", ["米饭套餐", "咖喱"], ["大米", "鸡肉", "咖喱"], 0, null],
];

database.exec("PRAGMA foreign_keys = ON");
database.exec("BEGIN IMMEDIATE");

try {
  database.prepare("DELETE FROM \"UserSession\"").run();
  database.prepare("DELETE FROM \"DecisionRecord\"").run();
  database.prepare("DELETE FROM \"MealCandidate\"").run();
  database.prepare("DELETE FROM \"Transaction\" WHERE \"type\" = 'REFUND'").run();
  database.prepare("DELETE FROM \"Transaction\"").run();
  database.prepare("DELETE FROM \"CategoryBudget\"").run();
  database.prepare("DELETE FROM \"UserPreference\"").run();
  database.prepare("DELETE FROM \"UserProfile\"").run();

  database.prepare(`
    INSERT INTO "UserProfile" (
      "id", "displayName", "email", "passwordHash", "openingBalanceCents", "balanceAsOf",
      "expectedMonthlyIncomeCents", "monthlySpendingBudgetCents", "fixedMonthlyExpenseCents",
      "emergencyReserveCents", "savingsTargetCents", "savingsTargetDate",
      "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, "小林", "demo@budget.local", demoPasswordHash(), 350000, periodStart, 220000, 110000, 60000, 10000, 40000, "2026-12-31T00:00:00.000Z", now, now);

  database.prepare(`
    INSERT INTO "UserPreference" (
      "id", "userId", "maxSingleMealCents", "maxSingleSnackDrinkCents",
      "monthlyEntertainmentLimitCents", "recommendedLunchPriceCents",
      "weeklySnackDrinkLimit", "weeklySnackDrinkBudgetCents",
      "shoppingReminderThresholdCents", "coolingOffHours",
      "priceSensitivity", "prioritizeNeeds",
      "foodLikes", "foodDislikes", "foodAllergens", "preferredDailyNecessities",
      "avoidedBrands", "protectedCategories", "notes", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "preference_demo_001", userId, 2500, 1200, 15000, 1500, 2, 2000, 5000, 24, "HIGH", 1,
    JSON.stringify(["米饭套餐", "面食", "水果", "无糖饮料"]),
    JSON.stringify(["过辣食品", "香菜"]),
    JSON.stringify(["花生"]),
    JSON.stringify(["耐用", "性价比高", "小包装"]),
    JSON.stringify([]),
    JSON.stringify(["MEAL", "DAILY_NECESSITY", "STUDY", "TRANSPORT", "MEDICAL"]),
    "优先满足学习和基本生活需要，娱乐消费保持克制。", now, now,
  );

  const insertBudget = database.prepare(`
    INSERT INTO "CategoryBudget" (
      "id", "userId", "category", "periodStart", "amountCents", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [category, amountCents] of budgets) {
    insertBudget.run(`budget_2026_07_${category.toLowerCase()}`, userId, category, periodStart, amountCents, now, now);
  }

  const insertTransaction = database.prepare(`
    INSERT INTO "Transaction" (
      "id", "userId", "type", "category", "source", "amountCents",
      "occurredAt", "itemName", "merchant", "note", "originalTransactionId",
      "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const transaction of transactions) {
    insertTransaction.run(transaction[0], userId, ...transaction.slice(1), now, now);
  }

  const insertMealCandidate = database.prepare(`
    INSERT INTO "MealCandidate" (
      "id", "userId", "name", "merchant", "typicalPriceCents", "location",
      "mealPeriod", "tags", "ingredients", "isSpicy", "userRating",
      "lastPurchasedAt", "priceUpdatedAt", "dataSource", "enabled", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'SEED', 1, ?, ?)
  `);

  for (const candidate of mealCandidates) {
    insertMealCandidate.run(
      candidate[0], userId, candidate[1], candidate[2], candidate[3], candidate[4],
      candidate[5], JSON.stringify(candidate[6]), JSON.stringify(candidate[7]),
      candidate[8], candidate[9], now, now, now,
    );
  }

  const counts = {
    users: database.prepare("SELECT COUNT(*) AS count FROM \"UserProfile\"").get().count,
    preferences: database.prepare("SELECT COUNT(*) AS count FROM \"UserPreference\"").get().count,
    budgets: database.prepare("SELECT COUNT(*) AS count FROM \"CategoryBudget\"").get().count,
    transactions: database.prepare("SELECT COUNT(*) AS count FROM \"Transaction\"").get().count,
    mealCandidates: database.prepare("SELECT COUNT(*) AS count FROM \"MealCandidate\"").get().count,
  };

  const invalidRefunds = database.prepare(`
    SELECT COUNT(*) AS count
    FROM "Transaction" refund
    LEFT JOIN "Transaction" original ON original."id" = refund."originalTransactionId"
    WHERE refund."type" = 'REFUND'
      AND (original."id" IS NULL OR original."type" != 'EXPENSE')
  `).get().count;

  if (counts.users !== 1 || counts.preferences !== 1 || counts.budgets !== budgets.length || counts.transactions !== transactions.length || counts.mealCandidates !== mealCandidates.length || invalidRefunds !== 0) {
    throw new Error(`种子数据验证失败：${JSON.stringify({ ...counts, invalidRefunds })}`);
  }

  database.exec("COMMIT");
  console.log(JSON.stringify(counts));
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}
