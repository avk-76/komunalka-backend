import express from "express";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;

const PORT = process.env.PORT ? Number(process.env.PORT) : 10000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set");
  process.exit(1);
}

const app = express();

// --- Middleware ---
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

// --- DB ---
const db = new Pool({
  connectionString: DATABASE_URL,
  // Neon часто вимагає SSL
  ssl: { rejectUnauthorized: false },
});

// Ensure table exists (idempotent)
async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS period_data (
      apt_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      rows JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (apt_id, period)
    );
  `);
}
ensureSchema()
  .then(() => console.log("Schema OK"))
  .catch((e) => console.error("Schema ensure failed:", e));

// --- Routes ---
app.get("/", (_req, res) => {
  res.type("text/plain").send("komunalka-backend is running");
});

app.get("/api/health", async (_req, res) => {
  try {
    const r = await db.query("select now() as now");
    res.json({ status: "ok", now: r.rows?.[0]?.now ?? null });
  } catch (e) {
    console.error("Health error:", e);
    res.status(500).json({ status: "error", error: String(e.message || e) });
  }
});

app.get("/api/period_data/list", async (_req, res) => {
  try {
    const r = await db.query(
      `select apt_id, period, rows, created_at, updated_at
       from period_data
       order by period asc, apt_id asc`
    );
    res.json(r.rows || []);
  } catch (e) {
    console.error("List error:", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Body: [{ apt_id: 1, period: "2025-08", rows: [...] }, ...]
app.post("/api/period_data/upsert", async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];
    if (!items.length) return res.json({ updated: 0 });

    let updated = 0;

    for (const it of items) {
      const apt_id = Number(it?.apt_id);
      const period = String(it?.period || "").trim();

      // IMPORTANT: Always stringify, then cast to jsonb in SQL.
      const rowsJson = JSON.stringify(it?.rows ?? null);

      if (!Number.isFinite(apt_id) || apt_id <= 0) continue;
      if (!period) continue;

      await db.query(
        `
        INSERT INTO period_data (apt_id, period, rows)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (apt_id, period)
        DO UPDATE SET rows = EXCLUDED.rows, updated_at = now()
        `,
        [apt_id, period, rowsJson]
      );

      updated++;
    }

    res.json({ updated });
  } catch (e) {
    console.error("Error in /api/period_data/upsert:", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  try {
    await db.end();
  } finally {
    process.exit(0);
  }
});

app.listen(PORT, () => {
  console.log(`komunalka-backend listening on port ${PORT}`);
});
