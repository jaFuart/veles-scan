import { Pool, PoolClient, QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;

declare global {
  var __velesPool: Pool | undefined;
}

function createPool() {
  if (connectionString) {
    return new Pool({ connectionString });
  }

  return new Pool({
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "velesscan",
    user: process.env.POSTGRES_USER ?? "velesscan",
    password: process.env.POSTGRES_PASSWORD ?? "velesscan",
  });
}

export const db = global.__velesPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global.__velesPool = db;
}

export async function query<T extends QueryResultRow>(text: string, values?: unknown[]) {
  return db.query<T>(text, values);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
