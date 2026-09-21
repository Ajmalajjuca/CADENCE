import pg from "pg";
import { readServerConfig } from "../config";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const config = readServerConfig("database");
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
  }
  return pool;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
