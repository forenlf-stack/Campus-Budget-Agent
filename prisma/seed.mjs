import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("dev.db");
const userId = "user_demo_001";
const periodStart = "2026-07-01T00:00:00.000Z";
const now = "2026-07-14T00:00:00.000Z";

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

database.exec("PRAGMA foreign_keys = ON");
database.exec("BEGIN IMMEDIATE");

try {
  database.prepare("DELETE FROM \"Transaction\" WHERE \"type\" = 'REFUND'").run();
  database.prepare("DELETE FROM \"Transaction\"").run();
  database.prepare("DELETE FROM \"CategoryBudget\"").run();
  database.prepare("DELETE FROM \"UserPreference\"").run();
  database.prepare("DELETE FROM \"UserProfile\"").run();

  database.prepare(`
    INSERT INTO "UserProfile" (
      "id", "displayName", "openingBalanceCents", "balanceAsOf",
      "expectedMonthlyIncomeCents", "fixedMonthlyExpenseCents",
      "emergencyReserveCents", "savingsTargetCents", "savingsTargetDate",
      "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, "小林", 350000, periodStart, 220000, 60000, 10000, 40000, "2026-12-31T00:00:00.000Z", now, now);

  database.prepare(`
    INSERT INTO "UserPreference" (
      "id", "userId", "maxSingleMealCents", "maxSingleSnackDrinkCents",
      "monthlyEntertainmentLimitCents", "priceSensitivity", "prioritizeNeeds",
      "foodLikes", "foodDislikes", "foodAllergens", "preferredDailyNecessities",
      "avoidedBrands", "notes", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "preference_demo_001", userId, 2500, 1200, 15000, "HIGH", 1,
    JSON.stringify(["米饭套餐", "面食", "水果", "无糖饮料"]),
    JSON.stringify(["过辣食品", "香菜"]),
    JSON.stringify(["花生"]),
    JSON.stringify(["耐用", "性价比高", "小包装"]),
    JSON.stringify([]),
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

  const counts = {
    users: database.prepare("SELECT COUNT(*) AS count FROM \"UserProfile\"").get().count,
    preferences: database.prepare("SELECT COUNT(*) AS count FROM \"UserPreference\"").get().count,
    budgets: database.prepare("SELECT COUNT(*) AS count FROM \"CategoryBudget\"").get().count,
    transactions: database.prepare("SELECT COUNT(*) AS count FROM \"Transaction\"").get().count,
  };

  const invalidRefunds = database.prepare(`
    SELECT COUNT(*) AS count
    FROM "Transaction" refund
    LEFT JOIN "Transaction" original ON original."id" = refund."originalTransactionId"
    WHERE refund."type" = 'REFUND'
      AND (original."id" IS NULL OR original."type" != 'EXPENSE')
  `).get().count;

  if (counts.users !== 1 || counts.preferences !== 1 || counts.budgets !== budgets.length || counts.transactions !== transactions.length || invalidRefunds !== 0) {
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
