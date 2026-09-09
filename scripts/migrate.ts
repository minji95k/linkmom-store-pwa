/**
 * supabase/migrations/*.sql을 순서대로 DEV Supabase Postgres에 적용한다.
 * Supabase CLI 로그인 없이(=계정 접근 없이) 순수 DB 연결 문자열만으로 동작한다.
 *
 * `_migrations` 테이블에 적용 이력을 남겨 이미 적용된 파일은 건너뛴다(재실행 안전).
 *
 * 실행: npm run db:migrate
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.error("SUPABASE_DB_URL이 .env.local에 필요합니다 (Project Settings > Database > Connection string > URI).");
  process.exit(1);
}

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "supabase", "migrations");

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Supabase Postgres.");

  await client.query(`
    create table if not exists public._migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: appliedRows } = await client.query<{ filename: string }>(
    "select filename from public._migrations",
  );
  const applied = new Set(appliedRows.map((r) => r.filename));

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (이미 적용됨, 건너뜀)`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`> ${file} 적용 중...`);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into public._migrations (filename) values ($1)", [file]);
      await client.query("commit");
      console.log(`+ ${file} 적용 완료`);
      appliedCount += 1;
    } catch (error) {
      await client.query("rollback");
      console.error(`x ${file} 적용 실패`);
      throw error;
    }
  }

  console.log(`\n총 ${files.length}개 중 ${appliedCount}개 신규 적용.`);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
