import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const singleUserId = "user_demo_001";

export function openDatabase() {
  const database = new DatabaseSync(path.join(process.cwd(), "dev.db"));
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}
