# StudyProject Inventory Manager

간단한 재고관리 CLI/GUI 프로그램입니다. 모든 입/출고 내역은 JSON 파일(`inventory_data.json`)에 보관되고, 입고/출고 시각과 아티스트, 품목, 로케이션, 수량을 저장합니다. 단일 PC에서 사용하는 것을 전제로 하며 별도의 NAS/SQLite 설정 없이 동작합니다.

## 주요 기능

- **입고/출고 기록**: `receive`, `dispatch` 서브커맨드로 각각 입고/출고를 기록합니다. 각 기록에는 ISO8601 시간, 아티스트명, 품목명, 로케이션, 수량, 입고·출고 구분이 저장됩니다.
- **현재 재고 자동 반영**: 입고 시 수량을 더하고 출고 시 차감하여 현재 재고를 추적합니다.
- **일/월/연도별 검색**: `search` 명령으로 원하는 기간의 입출고 데이터를 필터링하고 요약할 수 있습니다. 필요 시 특정 아티스트만 골라볼 수 있습니다.
- **월별 기초재고 관리**: 새로운 달의 첫 기록이 들어오면 직전 달 말 기준 재고를 해당 월의 기초재고로 자동 반영합니다.
- **데이터 영구 보관**: 월이 바뀌더라도 기존 내역은 `history`에 남아 언제든지 열람할 수 있습니다.
- **엑셀(xlsx) 내보내기**: 검색된 입/출고 데이터를 엑셀 파일로 저장할 수 있어 월/연 단위 보고서 작성이 편해집니다.
- **GUI 데스크톱 앱**: `inventory_gui.py` 를 실행하면 마우스 클릭만으로 입고/출고 및 재고 조회를 할 수 있는 Tkinter 기반 창이 열립니다.
- **앨범/MD 구분 관리**: 품목을 앨범과 MD(굿즈)로 나눠 입력/검색할 수 있으며, 재고/이력/구글 시트 모두 구분 정보를 유지합니다.

## 설치 및 실행

1. 저장소를 클론하거나 ZIP으로 내려받은 뒤 압축을 풉니다.
2. Python 3.10 이상이 설치돼 있는지 확인합니다. (윈도우의 경우 [python.org](https://www.python.org/downloads/)에서 설치)
3. 터미널(또는 CMD/PowerShell)에서 프로젝트 폴더로 이동합니다.
4. 아래 명령을 실행해 프로그램의 도움말을 확인합니다.

```
python inventory.py --help
```

> macOS / Linux에서는 `python3`, Windows에서는 `py` 명령을 사용해야 할 수도 있습니다. 예: `python3 inventory.py --help`

5. (선택) 검색 결과를 엑셀 파일로 내보내려면 `pip install openpyxl` 로 의존성을 설치합니다.
6. `inventory_data.json` 파일이 같은 폴더에 있는지 확인한 뒤, 아래 섹션의 명령을 실행하여 입/출고를 기록합니다. (실행 파일로 패키징할 경우 데이터 파일은 자동으로 사용자 전용 폴더에 저장됩니다.)

## GUI 실행 (데스크톱)

일반적인 PC 프로그램처럼 마우스/키보드로 조작하려면 다음 명령으로 Tkinter 기반 GUI를 실행하세요.

```bash
python inventory_gui.py
```

- 좌측 상단에서 품목/아티스트/수량을 입력하고 **입고 기록**, **출고 기록** 버튼을 누르면 CLI와 동일한 규칙으로 내역이 저장됩니다.
- 중앙 재고 테이블과 우측 검색 패널을 나란히 배치해 현재 재고와 기간별 조회 결과를 동시에 볼 수 있습니다.
- 우측에는 최근 30일(또는 지정한 기간) 동안의 입출고 그래프와 기본 표시되는 입고/출고 내역이 함께 제공돼 검색 버튼을 누르기 전에도 흐름을 확인할 수 있습니다. 기간이 31일 이상이면 월별 그래프가 그려지며, 날짜 라벨이 겹치지 않도록 가로 스크롤도 지원합니다.
- 재고 행 왼쪽 체크박스로 여러 품목을 선택한 뒤 일괄 삭제하거나, 백업 버튼으로 JSON 데이터를 즉시 보존할 수 있습니다.
- 상단 **⚙ 설정** 버튼에서 시작 잠금 여부, 비밀번호, 자동 잠금 대기시간을 지정할 수 있어 일정 시간 미사용 시에도 화면을 보호할 수 있습니다.
- 상단 **Inventory Manager로 업데이트** 버튼은 구글 시트의 데이터를 반영하고, **구글 드라이브로 업데이트** 버튼은 로컬 데이터를 구글 시트로 업로드합니다. (아래 구글 드라이브 연동 안내 참고)
- **재고 실사 모드**: 재고 테이블에서 `재고 실사 모드`를 열어 각 품목의 실사 수량을 입력하면 완료된 행이 색으로 표시됩니다. 모든 항목을 점검한 뒤 "실사 결과 일괄 적용"을 누르면 입력한 수량과 현재 재고 차이가 자동으로 입고(`물류실사 실재고 증가분`) 또는 출고(`물류실사 실재고 감소분`) 기록으로 저장돼 재고에 반영됩니다.

PyInstaller 실행 파일도 GUI 모드로 패키징할 수 있으니 아래 EXE 패키징 섹션을 참고하세요.

## Next.js + Supabase 웹 전환 가이드 (구글 드라이브 연동 불필요)

단일 PC에서 쓰던 Tkinter 앱을 웹으로 전환하려면 아래 설계를 따라 Next.js(프론트+API), Supabase(Postgres), 세션 기반 인증을 적용하세요. 이 가이드는 실제 배포 가능한 형태를 전제로 합니다.

### 핵심 요구사항 정리
- **스택**: Next.js(App Router) + Supabase(Postgres) + Vercel 배포
- **인증/세션**: 자체 API 경유 로그인 → HttpOnly 세션 쿠키 발급, RBAC(Admin/Operator/Viewer)
- **권한 미들웨어**: 모든 API 라우트에 역할 검사 적용
- **트랜잭션 처리**: 입/출고는 `movements` 기록과 `inventory` 업데이트를 단일 트랜잭션으로 처리, 출고 부족 시 롤백
- **멱등성**: `idempotency_keys` 테이블로 중복 요청 방지
- **감사 로그**: `movements`에 `user_id`, `created_at` 저장
- **백업/복구**: Supabase(또는 psql) 백업, CSV 내보내기 API 제공
- **배포**: Vercel, 모든 시크릿은 환경 변수로 관리, HTTPS 강제

### 데이터베이스 스키마 (Supabase SQL 예시)
```sql
-- 사용자 및 RBAC
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin','operator','viewer')),
  created_at timestamptz not null default now()
);

-- 아이템 마스터(앨범/MD 구분)
create table items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('album','md')),
  artist text not null,
  item text not null,
  option text default '' not null,
  unique(category, artist, item, option)
);

-- 재고 테이블
create table inventory (
  item_id uuid references items(id) on delete cascade,
  location text not null,
  quantity integer not null default 0,
  last_audited timestamptz,
  primary key (item_id, location)
);

-- 이동 이력(감사 로그 포함)
create table movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  location text not null,
  direction text not null check (direction in ('in','out')),
  quantity integer not null,
  reason text,
  category text not null,
  user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);

-- 멱등성 키
create table idempotency_keys (
  key text primary key,
  created_at timestamptz not null default now()
);
```

### API 라우트 설계 (Next.js App Router)
- `/api/auth/login` (POST): 이메일/비밀번호 검증 후 HttpOnly 세션 쿠키 발급.
- `/api/auth/logout` (POST): 세션 쿠키 삭제.
- `/api/items` (GET/POST): 항목 조회/등록. Admin, Operator만 POST 허용.
- `/api/stock` (GET): 재고 목록/필터.
- `/api/movements` (POST): 입·출고 등록. **미들웨어**에서 RBAC 확인 및 멱등성 키 소비.
- `/api/history` (GET): 기간/필터 조회.
- `/api/export/csv` (GET): 필터된 재고/이력을 CSV로 다운로드.
- `/api/backup` (POST): Admin만 호출 가능, Supabase `pg_dump` 또는 `supabase db dump` 래핑.

### 공통 미들웨어
Next.js `middleware.ts`에서 API 경로를 가드합니다.
1) 세션 쿠키 파싱 → Supabase JWT 검증(또는 자체 서명 토큰) → 사용자 조회
2) 요청 경로/메서드와 역할 매핑 (Admin/Operator/Viewer) 후 거부 시 403
3) 모든 API에서 `X-Idempotency-Key` 존재 시 `idempotency_keys` 테이블 확인 → 존재하면 409 반환 → 없으면 트랜잭션 내에 삽입

### 입/출고 트랜잭션 예시 (Supabase SQL)
```sql
begin;
  -- 멱등성 키 확인/삽입
  insert into idempotency_keys(key) values(:key);

  -- 현재 재고 조회 및 잠금
  select quantity into :current_qty
  from inventory where item_id = :item_id and location = :location for update;

  -- 부족 시 롤백
  if :direction = 'out' and :current_qty < :qty then
    rollback;
    raise exception 'INSUFFICIENT_STOCK';
  end if;

  -- 재고 갱신
  insert into inventory(item_id, location, quantity)
  values(:item_id, :location, :delta)
  on conflict(item_id, location) do update
    set quantity = inventory.quantity + :delta;

  -- 감사 로그
  insert into movements(item_id, location, direction, quantity, reason, category, user_id)
  values(:item_id, :location, :direction, :qty, :reason, :category, :user_id);
commit;
```

### 세션/인증
- 로그인 시 비밀번호는 서버에서 bcrypt 검증 후, 사용자 id/role을 담은 서명 토큰을 생성하여 **HttpOnly, Secure, SameSite=Strict** 쿠키로 반환합니다.
- 클라이언트는 토큰을 직접 보지 않고, 모든 API 요청은 쿠키를 통해 인증됩니다.

### CSV 내보내기
- `/api/export/csv?type=stock` 또는 `type=history`로 요청 → 필터 적용 후 RFC 4180 CSV 스트림 반환.

### 백업/복구
- **백업**: Admin 전용 `/api/backup`에서 Supabase `db dump`를 실행하거나 Vercel Build Output API를 이용해 백업 파일을 Supabase Storage에 업로드합니다.
- **복구**: 운영 전환 시 수동으로 `psql` 또는 Supabase SQL Editor에서 `< dump.sql` 실행.

### 배포/환경 변수 (Vercel)
- 필수 환경 변수: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `IDEMPOTENCY_TTL_MINUTES` 등
- Vercel 환경에서 **HTTPS 강제**: `next.config.js`에서 `redirects`로 http→https, 또는 Vercel 기본 HTTPS 사용.
- 로그: Vercel Log Drain 또는 Supabase `movements` 테이블 활용.

### 프런트엔드 페이지 구성 제안
- `/login`: 이메일/비밀번호 로그인
- `/inventory`: 재고 테이블(필터: 카테고리/아티스트/옵션/로케이션), CSV 버튼, 백업 버튼
- `/movements`: 입/출고 입력 폼 (멱등성 키 자동 생성), 최근 기록 테이블
- `/history`: 기간/필터 조회, CSV 다운로드
- `/settings`: 사용자 관리(Admin), 세션/보안 옵션

### 마이그레이션 순서 체크리스트
1. Supabase 프로젝트 생성 후 위 스키마 적용
2. Next.js 프로젝트 초기화, App Router 사용, `middleware.ts`로 인증 가드 추가
3. 서버 액션/Route Handler에서 Supabase 서비스 키로 DB 접근, 트랜잭션 래핑 구현
4. 로그인/로그아웃 API 작성 → HttpOnly 쿠키 발급
5. 입/출고 POST에 멱등성 키 처리 추가 → 클라이언트에서 UUID 생성해 헤더로 전송
6. CSV/백업 API 구현 → Admin 전용 가드
7. Vercel에 환경 변수 등록 후 배포, HTTPS 및 쿠키 옵션 확인

> 웹 전환 이후에는 구글 드라이브 연동이 필요하지 않습니다.

### 빠르게 적용·사용하기 (현실적인 작업 순서)

아래 순서는 “이 저장소 코드 + Next.js 새 프로젝트”를 조합해 실제로 웹 버전을 띄우는 최소 작업 흐름입니다.

1. **Supabase 프로젝트 생성**
   - Supabase 콘솔에서 새 프로젝트를 만들고 위 **데이터베이스 스키마** SQL을 적용합니다. (SQL Editor에 그대로 붙여넣기)
   - 서비스 롤 키와 프로젝트 URL을 메모해 둡니다.

2. **Next.js 프로젝트 초기화**
   - 로컬에 Node 18+가 설치돼 있어야 합니다.
   - 새 디렉터리에서 `npx create-next-app@latest inventory-web --ts --app --eslint` 실행 후, `cd inventory-web`.
   - 서버 액션/Route Handler를 사용할 수 있도록 App Router 템플릿을 선택합니다.

3. **환경 변수 설정 (.env.local)**
   - Next.js 프로젝트 루트에 `.env.local`을 만들고 아래와 같이 채웁니다.
   ```env
   SUPABASE_URL=https://<your-project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   SESSION_SECRET=<32+ byte random string>
   ENCRYPTION_KEY=<32+ byte random string for cookie encryption>
   IDEMPOTENCY_TTL_MINUTES=30
   ```
   - Vercel 배포 시에는 동일한 키를 Vercel 환경 변수로 등록합니다.

4. **DB 액세스 래퍼와 미들웨어 추가**
   - `lib/supabase.ts`에서 서비스 롤 키로 Supabase 클라이언트를 초기화합니다.
   - `middleware.ts`에서 API 경로를 가드해 세션 쿠키 → 사용자 조회 → RBAC 체크를 수행합니다. (가이드의 “공통 미들웨어” 섹션 참고)

5. **API Route 작성**
   - `app/api/movements/route.ts`, `app/api/stock/route.ts` 등에서 가이드의 **입/출고 트랜잭션 예시**를 그대로 적용합니다.
   - 출고 시 재고 부족이면 400/409를 반환하고 롤백합니다.
   - `X-Idempotency-Key` 헤더를 읽어 `idempotency_keys` 테이블을 처리합니다.

6. **초기 관리자 생성**
   - Supabase SQL Editor에서 관리자 계정을 추가합니다.
   ```sql
   insert into users(email, password_hash, role)
   values('admin@example.com', crypt('password', gen_salt('bf')), 'admin');
   ```
   - 실제 서비스에서는 bcrypt 검증을 서버에서 수행하고, 회원가입을 제한하거나 초대 기반으로 운영합니다.

7. **프런트엔드 페이지 구성**
   - `/login`: 세션 발급 후 홈으로 리다이렉트.
   - `/inventory`: 재고 테이블 + 필터 + CSV/백업 버튼.
   - `/movements`: 입고/출고 입력 폼(멱등성 키 자동 생성) + 최근 기록 테이블.
   - `/history`: 기간 검색 + CSV 내보내기.
   - `/settings`: 사용자/역할 관리(관리자 전용).

8. **백업/복구 및 CSV**
   - `/api/backup`에서 `supabase db dump` 혹은 `pg_dump`를 실행해 Supabase Storage나 외부 스토리지에 업로드합니다.
   - `/api/export/csv`로 필터링된 재고/이력을 CSV 스트림으로 제공합니다.

9. **로컬 실행 & 배포**
   - 로컬: `npm install && npm run dev` → http://localhost:3000
   - 배포: `vercel` CLI로 프로젝트를 연결하고 빌드하면 Vercel이 HTTPS 환경에서 자동 배포합니다. 환경 변수 누락 시 API가 500을 반환하므로 필수 키를 모두 등록하세요.

10. **운영 팁**
   - 모든 API 응답에 `user_id`, `created_at`이 기록되므로 감사 로그 용도로 `movements` 테이블만 확인해도 됩니다.
   - 멱등성 키를 클라이언트에서 UUID로 생성해 헤더로 보내면 네트워크 재시도 시 중복 등록을 막을 수 있습니다.
   - 웹 버전에서는 구글 드라이브 연동이 필요 없으니 설정 메뉴에서 해당 기능을 노출하지 않아도 됩니다.

## 구글 드라이브(구글 시트) 연동

Google Sheets를 통해 원격 데이터를 확인/동기화하려면 아래 순서를 따라 설정하세요.

1. 필요한 패키지를 설치합니다.

   ```bash
   pip install gspread google-auth
   ```

2. Google Cloud Console에서 **서비스 계정**을 만들고, 서비스 계정 JSON 키 파일을 다운로드합니다.
3. 사용할 구글 시트를 만들고, 해당 시트를 서비스 계정 이메일 주소로 **공유**합니다.
4. GUI 상단의 **⚙ 설정**을 열어 아래 값을 입력합니다.
   - **연동 사용** 체크
   - **구글 시트 ID**: 시트 URL 중 `/d/`와 `/edit` 사이의 문자열
   - **서비스 계정 JSON**: 다운로드한 JSON 키 파일 경로
5. 상단의 **Inventory Manager로 업데이트** 버튼을 누르면 구글 시트의 데이터를 로컬에 반영합니다.
6. 상단의 **구글 드라이브로 업데이트** 버튼을 누르면 로컬 데이터를 구글 시트로 업로드합니다.

동기화 규칙:

- 구글 시트에는 `Stock_Album`, `Stock_MD`, `History`, `Metadata` 탭이 생성됩니다.
  - `Stock_Album`/`Stock_MD`에는 **아티스트 / 앨범·버전 / 옵션 / 현재고 / 로케이션**이 표 형태로 저장됩니다.
  - `History` 탭은 `Category` 열을 포함해 모든 입출고 내역을 기록합니다.
- **Inventory Manager로 업데이트**를 누르면 구글 시트의 현재고와 로컬 재고를 비교하여 차이만큼 자동으로 입고/출고를 기록합니다. (내역 설명: `Google Drive 수정`)
- **구글 드라이브로 업데이트**는 로컬 데이터를 그대로 시트에 덮어씌우는 방식입니다.

구글 드라이브 동기화 백업:

- 구글 동기화 전에는 자동으로 스냅샷 백업이 생성됩니다.
- `backups/` 폴더에 `inventory_data_google_pull_YYYYMMDDHHMMSS.json` (시트 → 로컬), `inventory_data_google_push_YYYYMMDDHHMMSS.json` (로컬 → 시트) 형식으로 저장됩니다.
- 문제가 발생하면 GUI의 **백업 불러오기**에서 해당 파일을 선택해 복원할 수 있습니다.

## EXE 패키징 및 배포

1. PyInstaller를 설치합니다.

   ```
   pip install pyinstaller
   ```

2. (최초 1회) `inventory_data.json`을 원하는 초기 재고 상태로 수정합니다.
3. 아래 스크립트를 실행하면 `dist/` 폴더에 각 운영체제에 맞는 실행 파일이 생성됩니다. Windows에서는 `inventory_cli.exe`가 만들어집니다.

   ```
   python build_exe.py --clean
   ```

   - `--name my_inventory` 처럼 실행 파일 이름을 바꿀 수 있습니다.
   - `--onedir` 옵션을 주면 여러 파일로 구성된 폴더 형태로 패키징합니다.
   - `--target gui` 옵션을 추가하면 `inventory_gui.py` 기반의 창 형태 실행 파일을 만들고 `--windowed` 모드가 자동으로 적용됩니다.
   - Windows용 `.exe`는 Windows 환경에서 빌드해야 합니다. (macOS/Linux에서는 해당 플랫폼 실행 파일이 생성됩니다.)

4. `dist/`의 결과물을 원하는 PC로 복사하면 설치가 끝납니다. 첫 실행 시 사용자 데이터 폴더(`%APPDATA%\InventoryCLI` 또는 `~/.inventory_cli`)에 재고 데이터가 생성되며, 이후에는 해당 파일을 백업/복원하면 됩니다.

## 사용법

### 입고 기록

```
python inventory.py receive --artist "아티스트A" --item "A 1집" --location "A-01" --quantity 15
```

- `--timestamp` 옵션으로 과거 시간을 ISO8601 형식(`2023-08-01T09:00`)으로 지정할 수 있습니다.
- 처음 등록하는 품목이라면 반드시 `--artist`를 입력해야 하며, 이후 동일 품목을 재입고할 때는 생략해도 자동 인식됩니다.

### 출고 기록

```
python inventory.py dispatch --item "A 1집" --location "A-01" --quantity 5
```

출고 시 재고가 부족하면 명령이 실패합니다.

### 현재 재고 확인

```
python inventory.py stock
```

`--opening` 옵션을 주면 현재 월의 기초재고도 함께 확인할 수 있습니다.

특정 아티스트만 확인하고 싶다면 다음처럼 `--artist`를 사용합니다.

```
python inventory.py stock --artist "아티스트A"
```

또는 전체 재고를 아티스트별로 묶어서 보고 싶다면 다음 명령으로 합계를 확인할 수 있습니다.

```
python inventory.py stock --group-by-artist
```

### 기간별 검색

```
python inventory.py search --month 2023-08
```

- `--day`, `--month`, `--year` 중 하나를 선택합니다.
- `--summary` 옵션을 사용하면 필터링된 내역을 품목/로케이션 기준으로 합산해 보여줍니다.
- `--artist`로 특정 아티스트의 내역만 추려볼 수 있습니다.
- `--export-xlsx report.xlsx` 옵션을 주면 현재 검색 결과(및 `--summary`가 있다면 요약까지)를 엑셀 파일로 저장합니다.

### 새로운 월 강제 시작

새 달이 시작되면 첫 기록 시 자동으로 월이 전환됩니다. 필요 시 수동으로 다음 명령을 실행하여 월을 미리 시작할 수 있습니다.

```
python inventory.py start-period --month 2023-09
```

## 데이터 파일 구조 및 위치

- `inventory_data.json`: 현재 재고(`stock`), 월별 기초재고(`periods`), 전체 입/출고 내역(`history`), 품목별 아티스트 정보(`item_metadata`)를 저장합니다.

### 기본 저장 위치

- 소스 코드에서 직접 실행할 때: `inventory.py`와 같은 폴더의 `inventory_data.json`
- PyInstaller 실행 파일로 사용할 때: OS별 사용자 데이터 디렉터리(Windows: `%APPDATA%/InventoryCLI`, macOS/Linux: `~/.inventory_cli`)

필요하다면 `INVENTORY_DATA_FILE` 환경 변수를 지정하여 원하는 경로의 JSON 파일을 강제로 사용할 수 있습니다.

모든 저장 시 동일 폴더의 `backups/` 아래에 타임스탬프 기반 JSON 백업이 자동 생성되며 최대 10개까지 보관합니다. GUI에서는 `백업 불러오기` 버튼을 통해 원하는 백업 JSON을 선택해 즉시 복원할 수 있습니다.

## 웹 버전 빠른 시작(폴더 구조/스키마/배포 요약)

### 폴더 구조
```
web/                      # Next.js 단일 프로젝트 (프론트 + API)
  app/
    api/                  # 인증/재고/이력/내보내기 API 라우트
    globals.css
    layout.tsx
    page.tsx              # 데모 UI(로그인/입출고/재고/이력)
  lib/                    # Supabase, 세션, 권한, 멱등성 헬퍼
  middleware.ts           # 세션 체크
  package.json
  tsconfig.json
.env.example               # 환경 변수 예시
supabase/schema.sql        # 테이블/뷰/트랜잭션 함수 정의
scripts/migrate_json.py    # inventory_data.json → Supabase 이관 스크립트
```

### Supabase SQL 스키마
- `users`(RBAC: admin/operator/viewer, active 여부)
- `items`(artist, category, album_version, option 조합 유니크)
- `inventory`(item + location 단위 수량)
- `movements`(입/출고/조정 + 감사로그 created_by/created_at/opening/closing)
- `idempotency_keys`(중복 요청 방지)
- `inventory_view`, `movements_view` 뷰
- `record_movement(...)` 함수: 하나의 트랜잭션에서 멱등키 확인 → 재고 부족 검사 → 재고 갱신 → 이력 기록

### 핵심 코드 파일(Next.js)
- `web/lib/supabase.ts` : 서비스 롤 키 기반 서버 클라이언트
- `web/lib/session.ts`  : iron-session HttpOnly 쿠키
- `web/lib/auth.ts`     : 로그인 검증, RBAC 헬퍼
- `web/lib/idempotency.ts` : 멱등키 저장
- API(App Router)
  - `app/api/auth/login` / `logout`
  - `app/api/movements` : `record_movement` RPC 호출(재고 부족 시 실패)
  - `app/api/inventory`, `app/api/history` : 뷰 기반 조회
  - `app/api/export` : 재고/이력 CSV 다운로드
- `middleware.ts` : 로그인 필요 경로 보호
- `app/page.tsx` : 로그인/입출고/재고/이력 데모 UI

### 로컬 실행 (웹)
1. Node 18+ 설치 → `cd web && cp .env.example .env`
2. `.env`에 Supabase URL / SERVICE_ROLE_KEY / ANON_KEY, 세션 비밀키 설정
3. Supabase 콘솔 → SQL Editor → `supabase/schema.sql` 실행
4. 관리자 계정 생성(SQL):
   ```sql
   insert into users(email,password_hash,role)
   values('admin@example.com', crypt('admin123', gen_salt('bf')), 'admin');
   ```
5. `npm install`
6. `npm run dev`
7. 브라우저 http://localhost:3000 접속 → 로그인 후 입/출고 테스트

### Vercel 배포 체크리스트
1. Vercel에 새 프로젝트 생성 후 이 저장소 연결
2. Build Command: `npm run build`, Output: `.next`
3. Env 설정: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SESSION_PASSWORD`, `SESSION_COOKIE_NAME`, `SITE_URL`
4. Supabase에 `schema.sql` 반영 및 관리자 계정 추가
5. 배포 후 URL에서 로그인 → 입/출고 → 재고/이력/CSV 확인

### JSON 데이터 이관 스크립트
- `scripts/migrate_json.py`로 기존 `inventory_data.json`을 Supabase로 업로드
- 필요 패키지: `pip install requests`
- 실행 예:
  ```bash
  SUPABASE_URL=https://... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  SOURCE_JSON=inventory_data.json \
  python scripts/migrate_json.py
  ```
- 스크립트는 item 키(artist/category/album_version/option)별로 items → inventory → movements 순서로 업서트합니다.

### 백업/복구 & 보안
- Supabase 관리형 백업 기능 활성화(유료 플랜) 후 주기 확인
- 비상 시 `app/api/export?type=inventory|history`로 CSV 백업
- 모든 API는 세션(RBAC) 검사를 거치며 `/api/movements`는 admin/operator만 허용
- 쿠키는 HttpOnly + Secure + SameSite=Lax
