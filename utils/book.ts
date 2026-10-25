import { BookSearchParameterType } from "../model/book"

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
