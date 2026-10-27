export type BookSearchParameterType = {
  query: string;
  display?: string;
  start?: string;
  sort?: 'sim' | 'date';
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
  FORM?: string;
  CIP_YN?: string;
  DEPOSIT_YN?: string;
  TITLE_URL?: string;
  [key: string]: unknown;
};

export type NLBookItemType = {
  title: string;
  author: string;
  publisher: string;
  pubdate: string;
  image: string;
  isbn: string;
  seriesTitle?: string;
  price?: string;
  page?: string;
  form?: string;
};
