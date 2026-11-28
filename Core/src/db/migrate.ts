import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool.js";

async function migrate() {
  const migrationDir = path.resolve("migrations");
  const files = (await fs.readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationDir, file), "utf8");
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }
  await pool.end();
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
