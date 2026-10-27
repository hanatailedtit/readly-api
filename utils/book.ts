import { BookSearchParameterType, NLBookListParameterType } from "../model/book"

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

export const searchBookList = async (query: BookSearchParameterType) => {
  const queryString = new URLSearchParams(query).toString()
  const apiUrl = `https://openapi.naver.com/v1/search/book.json?${queryString}`

  const data = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id': String(process.env.NAVER_CLIENT_ID),
      'X-Naver-Client-Secret': String(process.env.NAVER_CLIENT_SECRET)
    }
  })

  return data.json()
}

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

