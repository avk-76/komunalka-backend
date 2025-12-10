import express from 'express';
import cors from 'cors';
import pkg from 'pg';

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// Підключення до бази Neon через DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Проста перевірка, що сервер живий
app.get('/', (req, res) => {
  res.send('komunalka-backend is running');
});

// Health-check ендпоінт
app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as now');
    res.json({ status: 'ok', now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// Отримати всі періоди
app.get('/api/period_data/list', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, apt_id, period, rows, created_at, updated_at FROM period_data ORDER BY apt_id, period'
    );
    res.json(r.rows);
  } catch (e) {
    console.error('Error in /api/period_data/list:', e);
    res.status(500).json({ error: e.message });
  }
});

// Зберегти / оновити періоди (масив рядків)
app.post('/api/period_data/upsert', async (req, res) => {
  const rows = req.body;

  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Body must be an array of rows' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const { apt_id, period, rows: rowData } = row;

      if (apt_id == null || !period || rowData == null) {
        throw new Error('Each row must have apt_id, period, rows');
      }

      await client.query(
        `INSERT INTO period_data (apt_id, period, rows)
         VALUES ($1, $2, $3)
         ON CONFLICT (apt_id, period)
         DO UPDATE SET rows = EXCLUDED.rows, updated_at = NOW()`,
        [apt_id, period, rowData]
      );
    }

    await client.query('COMMIT');
    res.json({ updated: rows.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error in /api/period_data/upsert:', e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Запуск сервера
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`komunalka-backend listening on port ${PORT}`);
});
