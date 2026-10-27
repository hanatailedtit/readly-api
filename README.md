# Readly API

## 로컬 실행

Node.js 22 환경에서 `yarn dev`를 실행합니다. API 주소는 `http://localhost:3002`입니다.
Vercel CLI가 설치되어 있어야 하며, 개발 스크립트는 현재 터미널의 Node.js로 CLI를 실행합니다.
Homebrew의 Vercel 실행 파일에 고정된 Node.js 버전과 프로젝트 버전이 달라 발생하는 시작 오류를 방지합니다.

## 소개
이 프로젝트는 express로 구현된 Readly 서비스의 백엔드 프로젝트 입니다.

## 프로필 이미지 저장

이미지 파일은 Vercel Blob에, 이미지 URL은 PostgreSQL의 `users.profile_image`에 저장합니다. DB를 Supabase로 이전해도 Blob 연결은 별도로 필요합니다.

- 운영 프로젝트에 Public Blob 저장소를 연결합니다. OIDC 방식은 `BLOB_STORE_ID`와 런타임에서 자동 제공되는 OIDC 토큰을 사용합니다. 프로젝트는 이를 지원하는 `@vercel/blob` 2.8.2를 사용하며, SDK 변경 후 재배포합니다.
- 로컬에서는 Development 환경에도 Blob을 연결하고 `vercel env pull`로 설정을 갱신합니다. 만료되는 OIDC 토큰은 직접 복사해 고정하지 않습니다. 기존 인증 방식은 `BLOB_READ_WRITE_TOKEN`도 지원합니다.
- 새 이미지 업로드와 DB 저장이 성공한 다음 기존 이미지를 정리합니다. 다른 저장소의 기존 URL은 삭제하지 않으며, 정리 실패가 저장 성공을 취소하지 않습니다.
- Vercel Function은 요청 본문 크기를 4.5 MB로 제한합니다. 이미지와 multipart 헤더를 고려해 4 MB 이하 파일을 권장하며, 더 큰 파일을 지원하려면 Blob 직접 업로드가 필요합니다.

참고: [Blob OIDC 인증](https://vercel.com/changelog/vercel-blob-now-supports-oidc-authentication), [Function 업로드 크기 제한](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)

## 성능 개선 및 검증

- 요약·댓글 작성은 `INSERT ... SELECT`로 사용자 확인과 저장을 한 쿼리에서 처리합니다.
- 구글 로그인은 `ON CONFLICT (id) DO NOTHING`으로 사용자 조회와 조건부 생성을 한 쿼리에서 처리합니다.
- 카테고리·사용자로 필터된 좋아요순 목록은 해당 요약의 좋아요만 집계합니다.
- `/book/summary/list`, `/book/summary/search`의 `limit`은 기본 16, 최대 100입니다. `offset`은 건너뛸 행 수이며 기본 0입니다. 양의 정수가 아닌 `limit`과 음수·소수 `offset`은 HTTP 400을 반환합니다.
- `npm test`로 DB 접속 없이 쿼리 호출 수, 인증 실패 처리, 페이지 제한과 응답 형식을 검증합니다.

DB에는 목록 정렬·필터, 제목·저자 검색, 댓글·좋아요 집계용 인덱스가 이미 있어 추가하지 않았습니다. 배포 환경의 응답 시간은 별도로 측정해야 합니다.

## 기술 스택
- `Express`
- `Vercel CLI`
- `Vercel postgres`
- `Vercel Blob`

## 주요 기능
### Auth
- 유저 회원가입 API
- 유저 로그인 API
- 유저 구글 로그인 API
- 유저 아이디 중복체크 API
### User
- 내 정보 API
- 유저 정보 API
- 유저 닉네임 수정 API
- 유저 프로필 이미지 수정 API
### Book
- 책 검색 API
- 책 요약 작성/수정/삭제/조회/리스트 API
- 책 요약 좋아요 API
- 책 카테고리 리스트 API
### Comment
- 댓글 작성/삭제/리스트 API

## 학습 내용
이 프로젝트를 통해 다음을 배웠습니다.
- express의 전반적인 사용 방법
- PostgreSQL 쿼리문 작성 방법
- 잘못된 SQL JOIN문으로 인해 발생하는 카테시안 곱에 대한 내용과 서브쿼리를 통한 해결 방법
- Vercel Serverless에 따른 설정 및 배포 방법
- Vercel Blob의 사용 방법

## 개선 사항 및 향후 계획
- 유저 가드, 파라미터 가드에 대한 조건문 유틸화
- 책 요약 리스트 API의 SQL문 리팩터링
