import { sql } from '@vercel/postgres';
import express, { Request, Response } from 'express';
import { decodeJwtToken } from '../utils/auth';
import { searchBookList } from '../utils/book';
import { isExistRows } from '../utils/sql';

const bookRouter = express.Router();

bookRouter.post('/search', async (req: Request, res: Response) => {
  const query = req.body?.query || '';
  const display = req.body?.display || 10;
  const start = req.body?.start || 1;
  const sort = req.body?.sort || 'sim';
  const searchResult = await searchBookList({ query, display, start, sort });

  res.json(searchResult);
});

bookRouter.get('/recent', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  if (!userToken) {
    res.status(401).send('You entered via the wrong route.');
    return;
  }

  const decodedInfo = decodeJwtToken(userToken);

  if (!decodedInfo.id) {
    res.status(400).send('Decoding failed.');
    return;
  }

  const { rows } = await sql`
  SELECT * 
  FROM (
    SELECT DISTINCT ON (isbn) book_title, book_author, book_publisher, book_pubdate, book_image, book_link, isbn, created_at
    FROM summaries
    WHERE user_id = ${decodedInfo.id}
    ) t
  ORDER BY created_at DESC
  LIMIT 3;
  `;

  res.json(rows);
});

bookRouter.get('/created-rank', async (req: Request, res: Response) => {
  const { rows } = await sql`
  SELECT 
    MAX(book_title) AS book_title, 
    MAX(book_author) AS book_author, 
    MAX(book_publisher) AS book_publisher, 
    MAX(book_pubdate) AS book_pubdate, 
    MAX(book_image) AS book_image, 
    MAX(book_link) AS book_link, 
    isbn,
    COUNT(*) AS created_count
  FROM 
    summaries
  GROUP BY 
    isbn
  ORDER BY 
    created_count DESC
  LIMIT 3;
  `;

  res.json(rows);
});

bookRouter.post('/summary/create', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  if (!userToken) {
    res.status(401).send('You entered via the wrong route.');
    return;
  }

  const decodedInfo = decodeJwtToken(userToken);

  if (!decodedInfo.id) {
    res.status(400).send('Decoding failed.');
    return;
  }

  const content = req.body?.content;
  const categoryId = req.body?.category_id;
  const bookInfo = req.body?.bookInfo;
  const startPage = req.body?.startPage;
  const endPage = req.body?.endPage;

  if (!content || !bookInfo) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

  const { rows } = await sql`
  SELECT nickname, profile_image 
  FROM users 
  WHERE id = ${decodedInfo.id};`;

  const row = rows[0];

  if (!row) {
    res.status(401).send('There is no user information.');
    return;
  }

  await sql`
  INSERT INTO summaries (contents, book_title, book_author, book_publisher, book_pubdate, book_image, book_link, isbn, user_id, user_name, user_image, start_page, end_page, category_id)
  VALUES (
    ${content},
    ${bookInfo.title},
    ${bookInfo.author},
    ${bookInfo.publisher},
    ${bookInfo.pubdate},
    ${bookInfo.image},
    ${bookInfo.link},
    ${bookInfo.isbn},
    ${decodedInfo.id},
    ${row.nickname},
    ${row.profile_image},
    ${startPage},
    ${endPage},
    ${categoryId}
    );`;

  res.send('success created');
});

bookRouter.get('/summary', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  const decodedInfo = decodeJwtToken(String(userToken));

  const id = req.query?.id;

  if (!id) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

  await sql`
  UPDATE summaries
  SET view_count = view_count + 1
  WHERE id = ${String(id)};`;

  const { rows } = await sql`
  SELECT 
    summaries.*, 
    book_category.name AS category_name,
    users.nickname AS user_name,
    users.profile_image AS user_image
  FROM 
    summaries
  LEFT JOIN 
    users
  ON 
    summaries.user_id = users.id
  LEFT JOIN 
    book_category
  ON 
    summaries.category_id = book_category.id
  WHERE
    summaries.id = ${String(id)};`;

  const row = rows[0];

  if (!row) {
    res.status(401).send('Summary does not exist.');
    return;
  }

  res.json({ ...row, is_my: row.user_id === decodedInfo.id });
});

bookRouter.put('/summary/edit', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  if (!userToken) {
    res.status(401).send('You entered via the wrong route.');
    return;
  }

  const decodedInfo = decodeJwtToken(userToken);

  if (!decodedInfo.id) {
    res.status(401).send('Decoding failed.');
    return;
  }

  const id = req.body?.id;

  if (!id) {
    res.status(401).send('A required parameter is missing.');
  }

  const content = req.body?.content;
  const bookInfo = req.body?.bookInfo;
  const startPage = req.body?.startPage;
  const endPage = req.body?.endPage;
  const categoryId = req.body?.category_id;

  if (!content || !bookInfo) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

  await sql`
  UPDATE summaries
  SET
    contents = ${content}, 
    book_title = ${bookInfo.title}, 
    book_author = ${bookInfo.author}, 
    book_publisher = ${bookInfo.publisher}, 
    book_pubdate = ${bookInfo.pubdate}, 
    book_image = ${bookInfo.image}, 
    book_link = ${bookInfo.link}, 
    isbn = ${bookInfo.isbn}, 
    start_page = ${startPage}, 
    end_page = ${endPage}, 
    category_id = ${categoryId}
  WHERE id = ${id} AND user_id = ${decodedInfo.id};`;

  res.send('success edited');
});

bookRouter.delete('/summary/delete', async (req: Request, res: Response) => {
  const id = req.query?.id;

  if (!id) {
    res.status(401).send('A required parameter is missing.');
  }

  const { rowCount } = await sql`
  DELETE 
  FROM summaries 
  WHERE id = ${String(id)};`;

  if (!rowCount || rowCount <= 0) {
    res.status(401).send('Summary does not exist.');
    return;
  }

  res.send('Success deleted.');
});

bookRouter.get('/summary/list', async (req: Request, res: Response) => {
  const {
    category_id = null,
    user_id = null,
    order = null,
    limit = 16,
    offset = 0,
  } = req.query;

  const limitNum = Math.max(1, Number(limit) || 16);
  const offsetNum = Math.max(0, Number(offset) || 0);

  const validOrders = ['desc', 'asc', 'view', 'like'] as const;
  type OrderKey = (typeof validOrders)[number];
  const orderStr = order ? String(order) : 'desc';
  const orderKey: OrderKey = (validOrders as readonly string[]).includes(
    orderStr,
  )
    ? (orderStr as OrderKey)
    : 'desc';

  const whereConditions: string[] = [];
  const params: (number | string)[] = [];

  if (
    category_id !== null &&
    category_id !== undefined &&
    category_id !== '' &&
    category_id !== 'null' &&
    !Number.isNaN(Number(category_id))
  ) {
    params.push(Number(category_id));
    whereConditions.push(`s.category_id = $${params.length}::INTEGER`);
  }

  if (
    user_id !== null &&
    user_id !== undefined &&
    user_id !== '' &&
    user_id !== 'null'
  ) {
    params.push(String(user_id));
    whereConditions.push(`s.user_id = $${params.length}::TEXT`);
  }

  const whereClause =
    whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  params.push(limitNum);
  const limitParamIdx = params.length;
  params.push(offsetNum);
  const offsetParamIdx = params.length;

  let query = '';

  if (orderKey === 'like') {
    query = `
    WITH total_info AS (
      SELECT COUNT(*)::int AS total_count
      FROM summaries s
      ${whereClause}
    ),
    like_counts AS (
      SELECT
        summary_id,
        COUNT(*)::int AS like_count
      FROM summary_like_count
      GROUP BY summary_id
    ),
    top_ids AS (
      SELECT
        s.id,
        COALESCE(lc.like_count, 0) AS like_count
      FROM summaries s
      LEFT JOIN like_counts lc ON s.id = lc.summary_id
      ${whereClause}
      ORDER BY COALESCE(lc.like_count, 0) DESC, s.created_at DESC
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    ),
    page_summaries AS (
      SELECT
        s.id,
        s.contents,
        s.book_title,
        s.book_author,
        s.view_count,
        s.user_id,
        s.created_at,
        s.start_page,
        s.end_page,
        s.category_id,
        t.like_count
      FROM top_ids t
      JOIN summaries s ON s.id = t.id
    )
    SELECT
      ti.total_count,
      ps.*,
      bc.name AS category_name,
      u.nickname AS user_name,
      u.profile_image AS user_image,
      (SELECT COUNT(*)::int FROM summary_comment sc WHERE sc.summary_id = ps.id) AS comment_count
    FROM total_info ti
    LEFT JOIN page_summaries ps ON TRUE
    LEFT JOIN users u ON ps.user_id = u.id
    LEFT JOIN book_category bc ON ps.category_id = bc.id
    ORDER BY ps.like_count DESC NULLS LAST, ps.created_at DESC NULLS LAST;`;
  } else {
    const orderClauseMap = {
      desc: {
        inner: 'ORDER BY s.created_at DESC',
        outer: 'ORDER BY ps.created_at DESC NULLS LAST',
      },
      asc: {
        inner: 'ORDER BY s.created_at ASC',
        outer: 'ORDER BY ps.created_at ASC NULLS LAST',
      },
      view: {
        inner: 'ORDER BY s.view_count DESC, s.created_at DESC',
        outer:
          'ORDER BY ps.view_count DESC NULLS LAST, ps.created_at DESC NULLS LAST',
      },
    } as const;

    const { inner: innerOrderBy, outer: outerOrderBy } =
      orderClauseMap[orderKey];

    query = `
    WITH total_info AS (
      SELECT COUNT(*)::int AS total_count
      FROM summaries s
      ${whereClause}
    ),
    page_summaries AS (
      SELECT
        s.id,
        s.contents,
        s.book_title,
        s.book_author,
        s.view_count,
        s.user_id,
        s.created_at,
        s.start_page,
        s.end_page,
        s.category_id
      FROM summaries s
      ${whereClause}
      ${innerOrderBy}
      LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
    )
    SELECT
      ti.total_count,
      ps.*,
      bc.name AS category_name,
      u.nickname AS user_name,
      u.profile_image AS user_image,
      (SELECT COUNT(*)::int FROM summary_comment sc WHERE sc.summary_id = ps.id) AS comment_count,
      (SELECT COUNT(*)::int FROM summary_like_count sl WHERE sl.summary_id = ps.id) AS like_count
    FROM total_info ti
    LEFT JOIN page_summaries ps ON TRUE
    LEFT JOIN users u ON ps.user_id = u.id
    LEFT JOIN book_category bc ON ps.category_id = bc.id
    ${outerOrderBy};`;
  }

  const { rows } = await sql.query(query, params);

  const totalCount = Number(rows[0]?.total_count ?? 0);
  const list =
    rows.length > 0 && rows[0].id !== null && rows[0].id !== undefined
      ? rows.map(({ total_count: _totalCount, ...item }) => item)
      : [];

  if (list.length === 0) {
    res.json({
      total: totalCount,
      list: [],
      nextOffset: null,
    });
    return;
  }

  const currentPage = Math.floor(offsetNum / limitNum);
  const isOverOffset = offsetNum + limitNum >= totalCount;

  res.json({
    total: totalCount,
    list,
    nextOffset: isOverOffset ? null : currentPage + 1,
  });
});

bookRouter.get('/summary/search', async (req: Request, res: Response) => {
  const { type = 'title', keyword = '', limit = 16, offset = 0 } = req.query;

  const whereByTypeObject = {
    title: `WHERE book_title ILIKE '%' || $1 || '%'`,
    author: `WHERE book_author ILIKE '%' || $1 || '%'`,
    category: `WHERE book_category.name = ANY(SELECT jsonb_array_elements_text($1::jsonb))`,
  };

  let sqlQuery = `
  WITH
  comment_counts AS (
    SELECT
      summary_id,
      COUNT(*) AS comment_count
    FROM
      summary_comment
    GROUP BY
      summary_id
  ),
  like_counts AS (
    SELECT
      summary_id,
      COUNT(*) AS like_count
    FROM
      summary_like_count
    GROUP BY
      summary_id
  )
  SELECT
    summaries.*,
    book_category.name AS category_name,
    users.nickname AS user_name,
    users.profile_image AS user_image,
    COALESCE(comment_counts.comment_count, 0) AS comment_count,
    COALESCE(like_counts.like_count, 0) AS like_count
  FROM
    summaries
  LEFT JOIN
    users
  ON
    summaries.user_id = users.id
  LEFT JOIN
    book_category
  ON
    summaries.category_id = book_category.id
  LEFT JOIN
    comment_counts
  ON
    summaries.id = comment_counts.summary_id
  LEFT JOIN
    like_counts
  ON
    summaries.id = like_counts.summary_id
  `;

  sqlQuery += whereByTypeObject[String(type)];

  sqlQuery += `
  GROUP BY 
    summaries.id, 
    book_category.name, 
    users.nickname, 
    users.profile_image,
    comment_counts.comment_count,
    like_counts.like_count
  ORDER BY 
    created_at DESC
  LIMIT $2 OFFSET $3;
  `;

  const { rows } = await sql.query(sqlQuery, [keyword, limit, offset]);

  let countSqlQuery = `
  SELECT 
    COUNT(*),
    book_category.name AS category_name
  FROM summaries
  LEFT JOIN
    book_category
  ON
    summaries.category_id = book_category.id
  `;

  countSqlQuery += whereByTypeObject[String(type)];
  countSqlQuery += `
  GROUP BY
    book_category.name;
  `;

  const { rows: total } = await sql.query(countSqlQuery, [keyword]);

  if (total.length <= 0) {
    res.json({
      total: 0,
      list: [],
      nextOffset: null,
    });
    return;
  }

  const totalCount = Number(total[0].count);

  const isOverOffset = totalCount - Number(limit) * (Number(offset) + 1) <= 0;

  res.json({
    total: totalCount,
    list: rows,
    nextOffset: isOverOffset ? null : Number(offset) + 1,
  });
});

bookRouter.get('/summary/like-count', async (req: Request, res: Response) => {
  const id = req.query?.id;

  if (!id) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

  const { rowCount } =
    await sql`SELECT summary_id FROM summary_like_count WHERE summary_id = ${String(id)};`;

  const userToken = req.headers['authorization']?.split(' ')[1];

  const decodedInfo = decodeJwtToken(userToken || null);

  let specUserId = req.ip;

  if (decodedInfo.id) {
    specUserId = decodedInfo.id;
  }

  const { rows } = await sql`
    SELECT EXISTS (
      SELECT 1 
      FROM summary_like_count 
      WHERE summary_id = ${String(id)}
      AND user_id = ${String(specUserId)}
    );`;

  res.json({ like_count: rowCount, is_clicked: isExistRows(rows) });
});

bookRouter.post('/summary/click-like', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  let specUserId = req.ip;

  const decodedInfo = decodeJwtToken(userToken || null);

  if (decodedInfo.id) {
    specUserId = decodedInfo.id;
  }

  const id = req.body?.id;

  if (!id) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

  const { rows } = await sql`
  SELECT EXISTS (
    SELECT 1 
    FROM summary_like_count 
    WHERE summary_id = ${id}
    AND user_id = ${specUserId}
  );`;

  if (isExistRows(rows)) {
    await sql`
    DELETE FROM summary_like_count 
    WHERE summary_id = ${id} 
    AND user_id = ${specUserId};`;
    res.send('delete like count.');
  } else {
    await sql`
    INSERT INTO summary_like_count (summary_id, user_id) 
    VALUES (${id}, ${specUserId});`;
    res.send('insert like count.');
  }
});

bookRouter.get('/category-list', async (req: Request, res: Response) => {
  const { rows } = await sql`
  SELECT 
    book_category.id,
    book_category.name,
    COUNT(summaries.id) AS summary_count
  FROM 
    book_category
  LEFT JOIN 
    summaries
  ON 
    book_category.id = summaries.category_id
  GROUP BY 
    book_category.id, book_category.name
  ORDER BY 
    summary_count DESC;`;

  res.json(rows);
});

export default bookRouter;
