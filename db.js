import pg from "pg";
import fs from "fs";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function ensureSchema() {
  const sql = fs.readFileSync("./schema.sql", "utf8");
  await pool.query(sql);
}
