export type BookSearchParameterType = {
  query: string;
  display?: string | number;
  start?: string | number;
  sort?: 'sim' | 'date' | 'accuracy' | 'latest';
  page?: string | number;
  size?: string | number;
  target?: 'title' | 'isbn' | 'publisher' | 'person';
};

export type KakaoBookDocument = {
  title: string;
  contents: string;
  url: string;
  isbn: string;
  datetime: string;
  authors: string[];
  publisher: string;
  translators: string[];
  price: number;
  sale_price: number;
  thumbnail: string;
  status: string;
};

export type KakaoBookMeta = {
  is_end: boolean;
  pageable_count: number;
  total_count: number;
};

export type KakaoBookResponse = {
  documents: KakaoBookDocument[];
  meta: KakaoBookMeta;
};


export type NLBookListParameterType = {
  page_no?: number | string;
  page_size?: number | string;
  isbn?: string;
  title?: string;
  author?: string;
  publisher?: string;
  start_publish_date?: string;
  end_publish_date?: string;
  deposit_yn?: string;
};

export type NLBookDocType = {
  TITLE?: string;
  VOL?: string;
  SERIES_TITLE?: string;
  SERIES_NO?: string;
  AUTHOR?: string;
  EA_ISBN?: string;
  EA_ADD_CODE?: string;
  SET_ISBN?: string;
  SET_ADD_CODE?: string;
  PUBLISHER?: string;
  PUBLISH_PREDATE?: string;
  INPUT_DATE?: string;
  PAGE?: string;
  PRICE?: string;
  PRE_PRICE?: string;
  REAL_PRICE?: string;
  FORM?: string;
  CIP_YN?: string;
  DEPOSIT_YN?: string;
  TITLE_URL?: string;
  [key: string]: unknown;
};

export type NLBookListResponse = {
  PAGE_NO?: string | number;
  TOTAL_COUNT: string | number;
  docs: NLBookDocType[];
  [key: string]: unknown;
};
