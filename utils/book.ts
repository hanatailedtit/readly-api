import {
  BookSearchParameterType,
  KakaoBookResponse,
  NLBookListParameterType,
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

export const searchBookList = async (params: BookSearchParameterType) => {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    throw new Error('KAKAO_REST_API_KEY is not configured.');
  }

  const query = params.query || '';
  const display = Number(params.display || params.size || 10);
  const size = Math.min(Math.max(display, 1), 50);

  let page = 1;
  if (params.page) {
    page = Number(params.page);
  } else if (params.start) {
    const start = Number(params.start);
    page = Math.floor((Math.max(start, 1) - 1) / size) + 1;
  }
  page = Math.min(Math.max(page, 1), 50);

  let sort = 'accuracy';
  if (params.sort === 'date' || params.sort === 'latest') {
    sort = 'latest';
  }

  const queryParams = new URLSearchParams({
    query,
    page: String(page),
    size: String(size),
    sort,
  });

  if (params.target) {
    queryParams.set('target', params.target);
  }

  const apiUrl = `https://dapi.kakao.com/v3/search/book?${queryParams.toString()}`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `KakaoAK ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Kakao Book API error: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data: KakaoBookResponse = await response.json();

  const items = (data.documents || []).map((doc) => {
    const isbns = (doc.isbn || '').trim().split(/\s+/);
    const isbn13 = isbns.find((s) => s.length === 13) || isbns[0] || '';
    const pubdate = doc.datetime ? doc.datetime.slice(0, 10).replace(/-/g, '') : '';

    return {
      title: doc.title || '',
      link: doc.url || '',
      image: doc.thumbnail || '',
      author: Array.isArray(doc.authors) ? doc.authors.join(', ') : (doc.authors || ''),
      discount: doc.sale_price > 0 ? String(doc.sale_price) : '',
      publisher: doc.publisher || '',
      pubdate,
      isbn: isbn13,
      description: doc.contents || '',
      price: String(doc.price || ''),
    };
  });

  return {
    lastBuildDate: new Date().toUTCString(),
    total: data.meta?.total_count || 0,
    start: (page - 1) * size + 1,
    display: size,
    items,
    meta: data.meta,
    documents: data.documents,
  };
};

export const fetchNLBookList = async (params?: NLBookListParameterType) => {
  const apiKey = process.env.NL_ISBN_API_KEY;
  if (!apiKey) {
    throw new Error('NL_ISBN_API_KEY is not configured.');
  }

  const queryParams = new URLSearchParams({
    cert_key: apiKey,
    result_style: 'json',
    page_no: String(params?.page_no || 1),
    page_size: String(params?.page_size || 20),
  });

  if (params?.isbn) queryParams.set('isbn', String(params.isbn));
  if (params?.title) queryParams.set('title', String(params.title));
  if (params?.author) queryParams.set('author', String(params.author));
  if (params?.publisher) queryParams.set('publisher', String(params.publisher));
  if (params?.start_publish_date) queryParams.set('start_publish_date', String(params.start_publish_date));
  if (params?.end_publish_date) queryParams.set('end_publish_date', String(params.end_publish_date));
  if (params?.deposit_yn) queryParams.set('deposit_yn', String(params.deposit_yn));

  const apiUrl = `https://www.nl.go.kr/seoji/SearchApi.do?${queryParams.toString()}`;

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`National Library API HTTP error: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

