import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { pool, ensureSchema } from "./db.js";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// простий ліміт на IP
const limiter = new RateLimiterMemory({ points: 200, duration: 60 });
app.use(async (req, res, next) => {
  try {
    await limiter.consume(req.ip);
    next();
  } catch {
    res.status(429).json({ error: "Too Many Requests" });
  }
});

// healthcheck
app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("select now() as now");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Upsert записи (масивом)
app.post("/api/period_data/upsert", async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  if (!rows.length) return res.json({ updated: 0 });

  const client = await pool.connect();
  try {
    await client.query("begin");

    const text = `
      insert into komunalka.period_data
        (apartment_id, period, item, prev_value, curr_value, tariff, amount, meta, updated_at)
      values
        ($1,$2,$3,$4,$5,$6,$7,$8, now())
      on conflict (apartment_id, period, item)
      do update set
        prev_value = excluded.prev_value,
        curr_value = excluded.curr_value,
        tariff     = excluded.tariff,
        amount     = excluded.amount,
        meta       = excluded.meta,
        updated_at = now()
    `;

    for (const r of rows) {
      await client.query(text, [
        r.apartment_id,
        r.period,
        r.item,
        r.prev_value ?? null,
        r.curr_value ?? null,
        r.tariff ?? null,
        r.amount ?? null,
        r.meta ? JSON.stringify(r.meta) : null
      ]);
    }

    await client.query("commit");
    res.json({ updated: rows.length });
  } catch (e) {
    await client.query("rollback");
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Отримати всі записи за період і квартиру
app.get("/api/period_data", async (req, res) => {
  const { period, apartment_id } = req.query;
  if (!period || !apartment_id) {
    return res.status(400).json({ error: "period and apartment_id are required" });
  }
  try {
    const q = `
      select apartment_id, period, item, prev_value, curr_value, tariff, amount, meta, updated_at
      from komunalka.period_data
      where period = $1 and apartment_id = $2
      order by item;
    `;
    const r = await pool.query(q, [period, Number(apartment_id)]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Отримати останній доступний період по квартирі (для автопідтягування "попередніх")
app.get("/api/period_data/last", async (req, res) => {
  const { apartment_id } = req.query;
  if (!apartment_id) return res.status(400).json({ error: "apartment_id is required" });
  try {
    const q = `
      select period
      from komunalka.period_data
      where apartment_id = $1
      order by period desc
      limit 1;
    `;
    const r = await pool.query(q, [Number(apartment_id)]);
    res.json({ period: r.rows[0]?.period || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// старт
ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API running on :${PORT}`);
    });
  })
  .catch((e) => {
    console.error("Failed to ensure schema:", e);
    process.exit(1);
  });
