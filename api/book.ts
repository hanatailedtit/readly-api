import express, { Request, Response } from 'express';
import { decodeJwtToken } from '../utils/auth';
import { BookApiError, fetchNLBookList, getSummaryPagination, searchBookList } from '../utils/book';
import { sql } from '../utils/sql';

const bookRouter = express.Router();

const sendBookApiError = (error: unknown, res: Response) => {
  const status = error instanceof BookApiError ? error.status : 502;
  const message = error instanceof BookApiError ? error.message : 'Invalid book provider response.';
  res.status(status).json({ error: message });
};

const handleNLBookList = async (req: Request, res: Response) => {
  const input = { ...req.body, ...req.query };
  const page = input.page_no ?? input.page ?? 1;
  const size = input.page_size ?? input.display ?? input.limit ?? 20;
  try {
    const rawData = await fetchNLBookList({
      ...input, page_no: page, page_size: size, title: input.title ?? input.query,
    });
    const items = rawData.docs.map(doc => ({
      title: doc.TITLE || '',
      author: doc.AUTHOR || '',
      publisher: doc.PUBLISHER || '',
      pubdate: doc.PUBLISH_PREDATE || '',
      image: doc.TITLE_URL || '',
      isbn: doc.EA_ISBN || doc.SET_ISBN || '',
      seriesTitle: doc.SERIES_TITLE || '',
      price: doc.REAL_PRICE || doc.PRE_PRICE || doc.PRICE || '',
      page: doc.PAGE || '',
      form: doc.FORM || '',
      depositYn: doc.DEPOSIT_YN || '',
    }));
    res.json({
      ...rawData,
      page_no: Number(rawData.PAGE_NO ?? page),
      page_size: Number(size),
      total_count: Number(rawData.TOTAL_COUNT),
      items,
    });
  } catch (error) {
    sendBookApiError(error, res);
  }
};

bookRouter.get('/list', handleNLBookList);
bookRouter.post('/list', handleNLBookList);
bookRouter.get('/all', handleNLBookList);
bookRouter.get('/nl-list', handleNLBookList);

const handleBookSearch = async (req: Request, res: Response) => {
  try {
    res.json(await searchBookList({ ...req.query, ...req.body }));
  } catch (error) {
    sendBookApiError(error, res);
  }
};

bookRouter.post('/search', handleBookSearch);
bookRouter.get('/search', handleBookSearch);

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

  res.setHeader(
    'Cache-Control',
    'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
  );
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

  const { rowCount } = await sql`
  INSERT INTO summaries (contents, book_title, book_author, book_publisher, book_pubdate, book_image, book_link, isbn, user_id, user_name, user_image, start_page, end_page, category_id)
  SELECT
    ${content},
    ${bookInfo.title},
    ${bookInfo.author},
    ${bookInfo.publisher},
    ${bookInfo.pubdate},
    ${bookInfo.image},
    ${bookInfo.link},
    ${bookInfo.isbn},
    id,
    nickname,
    profile_image,
    ${startPage},
    ${endPage},
    ${categoryId}
  FROM users
  WHERE id = ${decodedInfo.id};`;

  if (!rowCount) {
    res.status(401).send('There is no user information.');
    return;
  }

  res.send('success created');
});

bookRouter.get('/summary', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  const decodedInfo = decodeJwtToken(userToken || null);

  const id = req.query?.id;

  if (!id || Number.isNaN(Number(id))) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

  const { rows } = await sql`
  WITH updated_summary AS (
    UPDATE summaries
    SET view_count = view_count + 1
    WHERE id = ${Number(id)}
    RETURNING *
  )
  SELECT 
    s.*,
    bc.name AS category_name,
    u.nickname AS user_name,
    u.profile_image AS user_image
  FROM 
    updated_summary s
  LEFT JOIN 
    users u
  ON 
    s.user_id = u.id
  LEFT JOIN 
    book_category bc
  ON 
    s.category_id = bc.id;`;

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

  const pagination = getSummaryPagination(limit, offset);
  if (!pagination) {
    res.status(400).send('Invalid pagination parameters.');
    return;
  }
  const { limitNum, offsetNum } = pagination;

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
    const likeCountFilter = whereConditions.length > 0
      ? `WHERE summary_id IN (SELECT s.id FROM summaries s ${whereClause})`
      : '';

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
      ${likeCountFilter}
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
        s.book_image,
        s.book_publisher,
        s.book_pubdate,
        s.book_link,
        s.isbn,
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
        s.book_image,
        s.book_publisher,
        s.book_pubdate,
        s.book_link,
        s.isbn,
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

  const pagination = getSummaryPagination(limit, offset);
  if (!pagination) {
    res.status(400).send('Invalid pagination parameters.');
    return;
  }
  const { limitNum, offsetNum } = pagination;

  const validTypes = ['title', 'author', 'category'] as const;
  type SearchType = (typeof validTypes)[number];
  const typeStr = String(type);
  const searchType: SearchType = (validTypes as readonly string[]).includes(
    typeStr,
  )
    ? (typeStr as SearchType)
    : 'title';

  let searchParam = String(keyword);
  if (searchType === 'category') {
    try {
      const parsed = JSON.parse(searchParam);
      searchParam = JSON.stringify(
        Array.isArray(parsed) ? parsed : [String(parsed)],
      );
    } catch {
      searchParam = searchParam ? JSON.stringify([searchParam]) : '[]';
    }
  }

  const whereByTypeMap: Record<SearchType, string> = {
    title: `WHERE s.book_title ILIKE '%' || $1 || '%'`,
    author: `WHERE s.book_author ILIKE '%' || $1 || '%'`,
    category: `WHERE s.category_id IN (
      SELECT bc_filter.id
      FROM book_category bc_filter
      WHERE bc_filter.name = ANY(SELECT jsonb_array_elements_text($1::jsonb))
    )`,
  };

  const whereClause = whereByTypeMap[searchType];

  const sqlQuery = `
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
      s.book_image,
      s.book_publisher,
      s.book_pubdate,
      s.book_link,
      s.isbn,
      s.view_count,
      s.user_id,
      s.created_at,
      s.start_page,
      s.end_page,
      s.category_id
    FROM summaries s
    ${whereClause}
    ORDER BY s.created_at DESC
    LIMIT $2 OFFSET $3
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
  ORDER BY ps.created_at DESC NULLS LAST;
  `;

  const { rows } = await sql.query(sqlQuery, [searchParam, limitNum, offsetNum]);

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

bookRouter.get('/summary/like-count', async (req: Request, res: Response) => {
  const id = req.query?.id;

  if (!id || Number.isNaN(Number(id))) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

  const userToken = req.headers['authorization']?.split(' ')[1];
  const decodedInfo = decodeJwtToken(userToken || null);
  const specUserId = decodedInfo.id || req.ip;

  const { rows } = await sql<{ like_count: number; is_clicked: boolean }>`
    SELECT
      COUNT(*)::int AS like_count,
      COALESCE(BOOL_OR(user_id = ${String(specUserId)}), false) AS is_clicked
    FROM summary_like_count
    WHERE summary_id = ${Number(id)};`;

  res.json({
    like_count: rows[0]?.like_count ?? 0,
    is_clicked: rows[0]?.is_clicked ?? false,
  });
});

bookRouter.post('/summary/click-like', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];
  const decodedInfo = decodeJwtToken(userToken || null);
  const specUserId = decodedInfo.id || req.ip;

  const id = req.body?.id;

  if (!id || Number.isNaN(Number(id))) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

  const { rows } = await sql<{ was_deleted: boolean }>`
  WITH deleted AS (
    DELETE FROM summary_like_count
    WHERE summary_id = ${Number(id)}
      AND user_id = ${String(specUserId)}
    RETURNING id
  ),
  inserted AS (
    INSERT INTO summary_like_count (summary_id, user_id)
    SELECT ${Number(id)}, ${String(specUserId)}
    WHERE NOT EXISTS (SELECT 1 FROM deleted)
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM deleted) AS was_deleted;`;

  if (rows[0]?.was_deleted) {
    res.send('delete like count.');
  } else {
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

  res.setHeader(
    'Cache-Control',
    'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
  );
  res.json(rows);
});

export default bookRouter;
