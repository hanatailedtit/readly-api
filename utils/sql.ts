import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __readlyPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __readlyPgPoolUrl: string | undefined;
}

export const createPoolConfig = (rawUrl: string): PoolConfig => {
  const parsed = new URL(rawUrl);
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('sslcert');
  parsed.searchParams.delete('sslkey');
  parsed.searchParams.delete('sslrootcert');

  const isLocal =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  return {
    connectionString: parsed.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  };
};

const getPool = (): Pool => {
  const rawUrl =
    process.env.SUPABASE_POSTGRES_URL ||
    process.env.SUPABASE_POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL;

  if (!rawUrl) {
    throw new Error(
      'Database connection string (SUPABASE_POSTGRES_URL or POSTGRES_URL) is missing.',
    );
  }

  if (!globalThis.__readlyPgPool || globalThis.__readlyPgPoolUrl !== rawUrl) {
    globalThis.__readlyPgPool = new Pool(createPoolConfig(rawUrl));
    globalThis.__readlyPgPoolUrl = rawUrl;
  }

  return globalThis.__readlyPgPool;
};

type SqlTag = {
  <O extends QueryResultRow = QueryResultRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<QueryResult<O>>;
  query: <O extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<O>>;
};

export const sql: SqlTag = Object.assign(
  async <O extends QueryResultRow = QueryResultRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<QueryResult<O>> => {
    let text = strings[0] ?? '';
    for (let i = 0; i < values.length; i += 1) {
      text += `$${i + 1}${strings[i + 1] ?? ''}`;
    }
    return getPool().query<O>(text, values);
  },
  {
    query: <O extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<O>> => getPool().query<O>(text, values),
  },
);

export const isExistRows = (rows: QueryResultRow[]) => {
  return Boolean(rows.find((item) => item.exists));
};
