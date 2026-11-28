import pg from "pg";

const { Pool } = pg;

export const isDatabaseConfigured = (): boolean => {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/datz",
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
  connectionTimeoutMillis: 3000,
});

pool.on("error", (err) => {
  // Prevent unhandled pool errors from crashing the Node process if DB is temporarily disconnected
  console.warn("Postgres pool error:", err.message);
});
