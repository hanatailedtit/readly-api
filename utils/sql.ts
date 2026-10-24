import { QueryResultRow } from '@vercel/postgres';

export const isExistRows = (rows: QueryResultRow[]) => {
  return Boolean(rows.find((item) => item.exists));
};
