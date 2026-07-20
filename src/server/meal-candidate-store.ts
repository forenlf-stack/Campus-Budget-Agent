import { randomUUID } from "node:crypto";

import { mealCandidateInputSchema, type MealCandidateDataSource, type MealCandidateInput, type MealCandidateQuery, type MealPeriod } from "@/lib/meal-candidates";
import { openDatabase } from "@/server/database";

interface MealCandidateRow {
  id: string;
  name: string;
  merchant: string;
  typicalPriceCents: number;
  location: string;
  mealPeriod: MealPeriod;
  tags: string;
  ingredients: string;
  isSpicy: number;
  userRating: number | null;
  lastPurchasedAt: string | null;
  priceUpdatedAt: string;
  dataSource: MealCandidateDataSource;
  enabled: number;
  createdAt: string;
  updatedAt: string;
}

export interface MealCandidateRecord extends Omit<MealCandidateRow, "tags" | "ingredients" | "isSpicy" | "enabled"> {
  tags: string[];
  ingredients: string[];
  isSpicy: boolean;
  enabled: boolean;
}

function toRecord(row: MealCandidateRow): MealCandidateRecord {
  return { ...row, tags: JSON.parse(row.tags), ingredients: JSON.parse(row.ingredients), isSpicy: Boolean(row.isSpicy), enabled: Boolean(row.enabled) };
}

export function listMealCandidates(userId: string, query: MealCandidateQuery) {
  const parsed = query;
  const database = openDatabase();
  try {
    const filters = [`"userId" = ?`];
    const parameters: Array<string | number> = [userId];
    if (parsed.location) { filters.push(`"location" = ?`); parameters.push(parsed.location); }
    if (parsed.mealPeriod) { filters.push(`"mealPeriod" = ?`); parameters.push(parsed.mealPeriod); }
    if (parsed.enabled !== undefined) { filters.push(`"enabled" = ?`); parameters.push(parsed.enabled ? 1 : 0); }
    const rows = database.prepare(`SELECT * FROM "MealCandidate" WHERE ${filters.join(" AND ")} ORDER BY "enabled" DESC, "updatedAt" DESC, "name" ASC`).all(...parameters) as unknown as MealCandidateRow[];
    const locations = database.prepare(`SELECT DISTINCT "location" FROM "MealCandidate" WHERE "userId" = ? ORDER BY "location"`).all(userId) as Array<{ location: string }>;
    return { candidates: rows.map(toRecord), locations: locations.map((row) => row.location) };
  } finally { database.close(); }
}

export function createMealCandidate(userId: string, input: MealCandidateInput) {
  const data = mealCandidateInputSchema.parse(input);
  const database = openDatabase();
  try {
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO "MealCandidate" ("id", "userId", "name", "merchant", "typicalPriceCents", "location", "mealPeriod", "tags", "ingredients", "isSpicy", "userRating", "lastPurchasedAt", "priceUpdatedAt", "dataSource", "enabled", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'MANUAL', ?, ?, ?)
    `).run(id, userId, data.name, data.merchant, data.typicalPriceCents, data.location, data.mealPeriod, JSON.stringify(data.tags), JSON.stringify(data.ingredients), data.isSpicy ? 1 : 0, data.userRating, data.priceUpdatedAt, data.enabled ? 1 : 0, now, now);
    return id;
  } finally { database.close(); }
}

export function updateMealCandidate(userId: string, id: string, input: MealCandidateInput) {
  const data = mealCandidateInputSchema.parse(input);
  const database = openDatabase();
  try {
    const result = database.prepare(`
      UPDATE "MealCandidate" SET "name" = ?, "merchant" = ?, "typicalPriceCents" = ?, "location" = ?, "mealPeriod" = ?, "tags" = ?, "ingredients" = ?, "isSpicy" = ?, "userRating" = ?, "priceUpdatedAt" = ?, "enabled" = ?, "updatedAt" = ?
      WHERE "id" = ? AND "userId" = ?
    `).run(data.name, data.merchant, data.typicalPriceCents, data.location, data.mealPeriod, JSON.stringify(data.tags), JSON.stringify(data.ingredients), data.isSpicy ? 1 : 0, data.userRating, data.priceUpdatedAt, data.enabled ? 1 : 0, new Date().toISOString(), id, userId);
    if (result.changes !== 1) throw new Error("餐食候选不存在");
  } finally { database.close(); }
}

export function disableMealCandidate(userId: string, id: string) {
  const database = openDatabase();
  try {
    const result = database.prepare(`UPDATE "MealCandidate" SET "enabled" = 0, "updatedAt" = ? WHERE "id" = ? AND "userId" = ?`).run(new Date().toISOString(), id, userId);
    if (result.changes !== 1) throw new Error("餐食候选不存在");
  } finally { database.close(); }
}
