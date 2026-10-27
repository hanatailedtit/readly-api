import {
  BookSearchParameterType,
  KakaoBookResponse,
  NLBookListParameterType,
  NLBookListResponse,
} from "../model/book";

export const getSummaryPagination = (limit: unknown, offset: unknown) => {
  if (
    !['string', 'number'].includes(typeof limit) ||
    !['string', 'number'].includes(typeof offset)
  ) {
    return null;
  }

  const limitNum = Number(limit);
  const offsetNum = Number(offset);
  if (
    !Number.isSafeInteger(limitNum) ||
    limitNum < 1 ||
    !Number.isSafeInteger(offsetNum) ||
    offsetNum < 0
  ) {
    return null;
  }

  return { limitNum: Math.min(limitNum, 100), offsetNum };
};

export class BookApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const positiveInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER) => {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw new BookApiError(400, 'Invalid pagination parameters.');
  }
  return number;
};

const fetchBookJson = async (url: string, headers?: Record<string, string>) => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Upstream request failed.');
    return await response.json();
  } catch {
    throw new BookApiError(502, 'Book provider is temporarily unavailable.');
  }
};

export const searchBookList = async (params: BookSearchParameterType) => {
  const display = positiveInteger(params.display ?? params.size ?? 10, params.page === undefined ? 100 : 50);
  const start = params.page === undefined
    ? positiveInteger(params.start ?? 1, 2500)
    : (positiveInteger(params.page, 50) - 1) * display + 1;
  const sort = params.sort ?? 'accuracy';
  if (
    typeof params.query !== 'string' || !params.query.trim() ||
    !['sim', 'date', 'accuracy', 'latest'].includes(sort) ||
    (params.target !== undefined && !['title', 'isbn', 'publisher', 'person'].includes(params.target))
  ) {
    throw new BookApiError(400, 'Invalid book search parameters.');
  }
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) throw new BookApiError(500, 'KAKAO_REST_API_KEY is not configured.');

  // Fixed-size pages preserve arbitrary row offsets and legacy 100-book requests.
  const firstPage = Math.floor((start - 1) / 50) + 1;
  const lastPage = Math.min(50, Math.ceil((start - 1 + display) / 50));
  const results: KakaoBookResponse[] = await Promise.all(
    Array.from({ length: lastPage - firstPage + 1 }, async (_, index) => {
      const queryParams = new URLSearchParams({
        query: params.query.trim(), page: String(firstPage + index), size: '50',
        sort: sort === 'date' || sort === 'latest' ? 'latest' : 'accuracy',
      });
      if (params.target) queryParams.set('target', params.target);
      const data = await fetchBookJson(`https://dapi.kakao.com/v3/search/book?${queryParams}`, {
        Authorization: `KakaoAK ${apiKey}`,
      });
      if (
        !Array.isArray(data?.documents) || !Number.isSafeInteger(data?.meta?.total_count) ||
        !Number.isSafeInteger(data?.meta?.pageable_count) || data.meta.pageable_count < 0 ||
        data.meta.total_count < 0 || typeof data.meta.is_end !== 'boolean' ||
        !data.documents.every(doc => doc && typeof doc === 'object' && !Array.isArray(doc))
      ) {
        throw new BookApiError(502, 'Invalid book provider response.');
      }
      return data;
    }),
  );
  // The provider can repeat the last page for out-of-range page numbers.
  const endIndex = results.findIndex(({ meta }) => meta.is_end);
  const total = results[0].meta.total_count;
  const available = Math.min(total, 2500, endIndex < 0 ? 2500
    : Math.min(results[endIndex].meta.pageable_count,
      (firstPage - 1 + endIndex) * 50 + results[endIndex].documents.length));
  const offset = (start - 1) % 50;
  const documents = start > available ? [] : results
    .slice(0, endIndex < 0 ? results.length : endIndex + 1)
    .flatMap(result => result.documents).slice(offset, offset + display);
  const items = documents.map((doc) => {
    const isbns = (doc.isbn || '').trim().split(/\s+/);
    const isbn13 = isbns.find((s) => s.length === 13) || isbns[0] || '';
    const pubdate = doc.datetime ? doc.datetime.slice(0, 10).replace(/-/g, '') : '';

    return {
      title: doc.title || '',
      link: doc.url || '',
      image: doc.thumbnail || '',
      author: Array.isArray(doc.authors) ? doc.authors.join(', ') : (doc.authors || ''),
      discount: String(doc.sale_price >= 0 ? doc.sale_price : doc.price ?? ''),
      publisher: doc.publisher || '',
      pubdate,
      isbn: isbn13,
      description: doc.contents || '',
      price: String(doc.price ?? ''),
    };
  });

  return {
    lastBuildDate: new Date().toUTCString(),
    total,
    start,
    display: items.length,
    items,
    meta: { total_count: total, pageable_count: available, is_end: start - 1 + items.length >= available },
    documents,
  };
};

export const fetchNLBookList = async (params?: NLBookListParameterType) => {
  const page = positiveInteger(params?.page_no ?? 1);
  const size = positiveInteger(params?.page_size ?? 20, 100);
  const apiKey = process.env.NL_ISBN_API_KEY;
  if (!apiKey) {
    throw new BookApiError(500, 'NL_ISBN_API_KEY is not configured.');
  }

  const queryParams = new URLSearchParams({
    cert_key: apiKey,
    result_style: 'json',
    page_no: String(page),
    page_size: String(size),
  });

  for (const field of ['isbn', 'title', 'author', 'publisher', 'start_publish_date', 'end_publish_date', 'deposit_yn'] as const) {
    const value = params?.[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new BookApiError(400, `Invalid ${field}.`);
    if (value.trim()) queryParams.set(field, value.trim());
  }
  for (const field of ['start_publish_date', 'end_publish_date']) {
    const value = queryParams.get(field);
    if (!value) continue;
    const formatted = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const date = new Date(`${formatted}T00:00:00Z`);
    if (!/^\d{8}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== formatted) {
      throw new BookApiError(400, `Invalid ${field}.`);
    }
  }
  if (
    (queryParams.has('deposit_yn') && !['Y', 'N'].includes(queryParams.get('deposit_yn'))) ||
    (queryParams.has('start_publish_date') && queryParams.has('end_publish_date') &&
      queryParams.get('start_publish_date') > queryParams.get('end_publish_date'))
  ) {
    throw new BookApiError(400, 'Invalid book list filters.');
  }

  const data = await fetchBookJson(`https://www.nl.go.kr/seoji/SearchApi.do?${queryParams}`);
  if (
    data?.RESULT === 'ERROR' || !Array.isArray(data?.docs) ||
    !['string', 'number'].includes(typeof data?.TOTAL_COUNT) ||
    !Number.isSafeInteger(Number(data?.TOTAL_COUNT)) || Number(data.TOTAL_COUNT) < 0 ||
    (data.PAGE_NO !== undefined && (!Number.isSafeInteger(Number(data.PAGE_NO)) || Number(data.PAGE_NO) < 1)) ||
    !data.docs.every(doc => doc && typeof doc === 'object' && !Array.isArray(doc))
  ) {
    throw new BookApiError(502, 'Invalid National Library response.');
  }
  return data as NLBookListResponse;
};

