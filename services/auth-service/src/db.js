const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || process.env.SPRING_DATASOURCE_URL || 'postgresql://dev:dev@postgres:5432/appdb';

function normalizeJdbc(url) {
  if (!url) return url;
  if (url.startsWith('jdbc:')) return url.replace(/^jdbc:/, '');
  return url;
}

const pool = new Pool({ connectionString: normalizeJdbc(DATABASE_URL) });

async function initDB() {
  console.log("🔌 Connecting to DB with URL:", normalizeJdbc(DATABASE_URL));

  const client = await pool.connect();
  console.log("✅ Connected to PostgreSQL!");
  await client.query('SET search_path TO public;');

  try {
    console.log("🔧 Ensuring pgcrypto extension exists...");
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    console.log("   → pgcrypto OK");

    console.log("📦 Ensuring users table base exists and expected columns...");
    // create base table if not exists (email + password only)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text,
        password text,
        created_at timestamptz DEFAULT now()
      );
    `);
    console.log("   → users table ensured (base)");

    // Ensure columns exist
    const alterStmts = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS password text;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();`
    ];
    for (const s of alterStmts) {
      try { await client.query(s); } catch (e) { /* ignore */ }
    }

    // If legacy 'password_hash' exists but 'password' does not, rename it back to 'password'
    const pwHashCol = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'password_hash';
    `);
    const pwCol = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'password';
    `);

    if (pwHashCol.rowCount > 0 && pwCol.rowCount === 0) {
      console.log("🔁 Renaming column 'password_hash' -> 'password' for compatibility...");
      await client.query(`ALTER TABLE users RENAME COLUMN password_hash TO password;`);
      console.log("   → rename done");
    }

    // Drop legacy username column if exists (we no longer use it)
    try {
      await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS username;`);
      console.log("   → dropped legacy column 'username' if it existed");
    } catch (e) {
      console.log("   → failed to drop username column (ignored):", e.message);
    }

    // Add UNIQUE constraint for email if safe (no duplicate non-null emails)
    const dupEmails = await client.query(`
      SELECT email, count(*) as cnt FROM users WHERE email IS NOT NULL GROUP BY email HAVING count(*) > 1;
    `);
    if (dupEmails.rowCount === 0) {
      try {
        await client.query(`ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (lower(email));`);
        console.log("   → added UNIQUE constraint on lower(email)");
      } catch (e) {
        // ignore if constraint exists or cannot be added
      }
    } else {
      console.log("⚠️ Duplicate non-null emails found; skipping adding UNIQUE constraint on email.");
    }

    // Report current columns
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'users';
    `);
    console.log("Users table columns:", cols.rows.map(r => r.column_name).join(', '));
    console.log("   → users schema migration/verification complete");
  } catch (err) {
    console.error("❌ Error in initDB:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };