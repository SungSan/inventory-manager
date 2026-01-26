# Inventory Manager (Web)

Next.js(App Router) + Supabase 기반의 웹 재고관리 시스템입니다. ID/PW 로그인 후 재고 조회, 입/출고 등록, 이력/CSV 내보내기를 동일한 화면에서 처리하며 Vercel에 바로 배포할 수 있는 구조로 제공합니다. 기존 Python CLI/GUI 코드는 레거시 참조용으로 `inventory.py`, `inventory_gui.py`에 남겨두었고, 필요한 경우 데이터를 Supabase로 옮길 수 있습니다.

## 주요 특징
- **스택**: Next.js 14(App Router) + Supabase(Postgres, Auth) + iron-session(HttpOnly 쿠키 세션)
- **인증**: 이메일/비밀번호로 로그인 → 세션 쿠키 발급, RBAC(`admin`/`operator`/`viewer`) 적용
- **데이터**: Supabase 테이블(`supabase/schema.sql`)과 트랜잭션 함수(`record_movement`)로 멱등/동시성 안전한 입·출고 처리
- **기능**: 재고 조회, 입/출고/조정 등록, 입출고 이력 확인, CSV 내보내기, 아이템 자동 생성 및 로케이션별 재고 관리
- **배포**: Vercel 지원. 루트 디렉터리 `web/`을 프로젝트로 연결하고 환경 변수를 설정하면 바로 배포 가능

## 저장소 구조
- `web/`: Next.js 애플리케이션(App Router 기반)
  - `app/`: UI와 API 라우트(`auth/login|logout`, `inventory`, `history`, `movements`, `export`, `admin/users`)
  - `lib/`: Supabase/세션/RBAC/멱등성 헬퍼
  - `middleware.ts`: 로그인 필요 경로 보호
  - `package.json`, `tsconfig.json`, `.env.example`: Vercel/로컬 실행에 필요한 설정
- `supabase/schema.sql`: Supabase 테이블, 뷰, 트랜잭션 함수 정의
- `scripts/migrate_json.py`: JSON 기반 레거시 데이터를 Supabase로 이관(선택 사항)
- `inventory.py`, `inventory_gui.py`: 기존 Python CLI/GUI 레거시 코드

## 사전 준비(Supabase)
1. Supabase 프로젝트를 생성하고 SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. 첫 관리자 계정을 추가합니다(이메일/비밀번호 로그인용). Supabase Auth 콘솔이나 `auth.admin.createUser`를 사용해 이메일/비밀번호 계정을 생성한 뒤, `users`/`user_profiles`에 role/approved/active 값을 맞춰 반영합니다.
3. 추가된 Supabase 마이그레이션(`supabase/migrations/*.sql`)이 있다면 CLI(`supabase db push`)나 SQL Editor로 적용한 뒤 `notify pgrst, 'reload schema';` 알림까지 실행해 스키마 캐시를 즉시 갱신합니다. 배포 CI에서도 동일하게 수행해야 합니다.
4. (선택) 레거시 JSON 데이터를 옮길 경우 `scripts/migrate_json.py`를 참고하거나 UI의 "레거시 데이터 이관" 안내 절차를 따라 실행합니다.

## 환경 변수
`web/.env.example`을 복사해 값을 채웁니다.

- `SUPABASE_URL`: Supabase 프로젝트 URL(서버 전용)
- `SUPABASE_SERVICE_ROLE_KEY`: Service Role 키(서버 전용)
- `SUPABASE_ANON_KEY`: anon/public 키(서버 전용)
- `NEXT_PUBLIC_SUPABASE_URL`: 브라우저에서 쓰는 Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: 브라우저에서 쓰는 anon/public 키
- `SESSION_PASSWORD`: 32자 이상의 임의 문자열(세션 암호화)
- `SESSION_COOKIE_NAME`: 세션 쿠키 이름(기본값 `inventory_session`)
- `NEXT_PUBLIC_SITE_URL`: 서비스 도메인(예: `http://localhost:3000` 또는 Vercel URL)

## 로컬 실행
```bash
cd web
npm install
npm run dev
```
- 브라우저에서 http://localhost:3000 접속 → 로그인 후 재고/입출고/이력/CSV 기능을 바로 사용할 수 있습니다.
- API는 서버에서 Supabase Service Role 키를 사용하며, 세션 쿠키는 개발환경(http)에서도 동작하도록 설정되어 있습니다.

## Vercel 배포
1. Vercel에서 새 프로젝트를 만들고 **Project Root**를 `web/`으로 지정합니다.
2. Build Command: `npm run build`, Output Directory: `.next`
3. 환경 변수에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SESSION_PASSWORD`, `SESSION_COOKIE_NAME`, `NEXT_PUBLIC_SITE_URL`을 입력합니다.
4. 배포 후 관리자 계정으로 로그인하여 입/출고 등록 → 재고/이력/CSV 다운로드를 확인합니다.

## 동작 및 관리자 가이드
- **입/출고/조정**: `/api/movements`가 Supabase의 `record_movement` 함수를 호출하여 재고 잠금→검증→업데이트→이력 기록을 하나의 트랜잭션으로 처리합니다. `idempotency_key`로 중복 요청을 방지합니다.
- **재고/이력 조회**: `inventory_view`, `movements_view`를 통해 현재 재고와 최근 이력을 제공합니다.
- **권한**: `middleware.ts`와 `withAuth` 헬퍼가 로그인 및 역할을 검사하며, 입/출고 등록은 `admin`/`operator`, 조회/다운로드는 `viewer` 이상이 사용할 수 있습니다.
- **신규 계정 발급**: `/api/admin/users`(admin 전용)을 통해 이메일/비밀번호/역할을 생성합니다. UI의 "관리자 도구" 섹션에서 바로 실행할 수 있으며, 생성된 계정은 즉시 로그인 가능합니다.
- **레거시 데이터 병합**:
  1. `inventory_data.json`을 최신 상태로 정리합니다(기존 Python 앱이 쓰던 포맷).
  2. Supabase SQL Editor에서 `supabase/schema.sql`을 실행해 테이블을 초기화/준비합니다.
  3. `python scripts/migrate_json.py --supabase-url <URL> --service-role-key <KEY>`를 실행해 JSON을 Supabase로 업서트합니다.
  4. 웹 앱에서 새로고침 후 재고/이력 테이블과 CSV 내보내기로 반영 여부를 확인합니다.

레거시 Python CLI/GUI는 동일한 저장소에 유지되지만, 배포 대상은 `web/`의 Next.js 애플리케이션입니다.
