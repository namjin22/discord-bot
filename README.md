# 글쓰기 방 디스코드 봇

교내 글쓰기 방의 글 작성 인증과 현황 집계를 맡는 디스코드 봇입니다.
GSM SV(학교 서버)에서 **Cloudflare Workers + D1**으로 이전했습니다.

## 명령어

| 명령어 | 설명 | 권한 |
| --- | --- | --- |
| `/글작성인증` | 오늘 글 작성을 인증합니다. 하루 1회. | 전체 |
| `/글작성현황` | 이번 달 순위와 누적 횟수를 표시합니다. | 전체 |
| `/월별글작성현황 [year] [month]` | 특정 연월의 현황. 생략하면 이번 달. | 전체 |
| `/오늘글작성현황` | 오늘 글을 쓴 멤버 목록. | 전체 |
| `/규칙` | 활동 규칙 안내. | 전체 |
| `/글작성횟수추가 <member>` | 횟수 1 추가. | 관리자 |
| `/글작성횟수차감 <member>` | 횟수 1 차감. | 관리자 |
| `/글작성횟수설정 <member> <count>` | 이번 달 횟수를 지정값으로 설정. | 관리자 |

날짜는 모두 KST(UTC+9) 기준입니다.

## 구조

```
src/
  index.ts         Worker 진입점 — 서명 검증 후 인터랙션 라우팅
  commands.ts      슬래시 커맨드 핸들러 (기존 bot.py)
  db.ts            D1 쿼리 (기존 database.py)
  discord.ts       Discord 타입 · Ed25519 서명 검증 · REST 호출
  kst.ts           KST 날짜 계산
  command-defs.ts  슬래시 커맨드 정의(JSON)
  env.ts           바인딩 타입
scripts/
  register-commands.ts  커맨드 등록 (기존 clear_commands.py의 반대)
  clear-commands.ts     커맨드 전체 삭제 (기존 clear_commands.py)
  export-sqlite.py      기존 writing_bot.db → D1 이관용 SQL
schema.sql         D1 테이블 스키마
legacy/            이전의 Python(discord.py) 버전. 참고용으로만 남겨둠.
```

### 동작 방식이 바뀐 점

기존 버전은 discord.py가 서버에 **상주하며 Gateway(WebSocket)로 접속**해 이벤트를 받았습니다.
Workers에는 상주 프로세스가 없으므로, **Discord가 명령 실행 시마다 이 Worker로 HTTPS 요청을 보내는**
HTTP Interactions 방식으로 바뀌었습니다. 그래서:

- 요청마다 **Ed25519 서명을 직접 검증**합니다 (`src/discord.ts`).
- 봇이 **멤버 목록에서 오프라인(회색)으로 표시**됩니다. 슬래시 커맨드는 정상 동작합니다.
- 응답은 **3초 안에** 나가야 합니다. 길드 멤버 목록을 불러와야 하는 `/오늘글작성현황`만
  먼저 "생각 중" 응답을 보내고(`defer`) 내용을 나중에 채웁니다.
- 기존의 15일 주기 **GSM SV 인스턴스 연장 알림은 제거**했습니다. 이전 후 의미가 없어졌습니다.

DB는 SQLite → D1로 옮겼습니다. D1 자체가 SQLite라 **테이블 스키마와 SQL은 그대로**입니다.

---

## 처음 배포하기

### 0. 준비

```bash
npm install
npx wrangler login
```

Discord 개발자 포털(https://discord.com/developers/applications)에서 봇 애플리케이션을 열고
다음 값을 준비해두세요.

- **APPLICATION ID** (General Information)
- **PUBLIC KEY** (General Information)
- **BOT TOKEN** (Bot → Reset Token)
- **서버 ID** (디스코드에서 서버 우클릭 → ID 복사, 개발자 모드 필요)

Bot 탭의 **SERVER MEMBERS INTENT는 계속 켜두세요.** `/오늘글작성현황`이 멤버 목록을 읽습니다.

### 1. D1 데이터베이스 생성

```bash
npx wrangler d1 create writing-bot
```

출력된 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 붙여넣습니다.
이어서 테이블을 만듭니다.

```bash
npm run db:init
```

### 2. 설정값 채우기

`wrangler.jsonc`의 `vars`에 비밀이 아닌 값 세 개를 채웁니다.

```jsonc
"vars": {
  "DISCORD_APPLICATION_ID": "실제 애플리케이션 ID",
  "DISCORD_PUBLIC_KEY": "실제 퍼블릭 키",
  "GUILD_ID": "실제 서버 ID"
}
```

봇 토큰만 비밀값이라 따로 넣습니다.

```bash
npx wrangler secret put DISCORD_TOKEN
```

### 3. 배포

```bash
npm run deploy
```

출력되는 `https://discord-writing-bot.<계정>.workers.dev` 주소를 복사해둡니다.

### 4. 기존 데이터 이관 ← 엔드포인트 연결 **전에** 하세요

#### 4-1. GSM SV에서 DB 파일 찾기

```bash
ssh ubuntu@ssh.gsmsv.site -p 24114
```

접속한 뒤 파일 위치를 찾습니다.

```bash
find ~ -name "writing_bot.db" 2>/dev/null
```

안 나오면 실행 중인 봇 프로세스에서 역추적합니다.

```bash
pgrep -af bot.py        # PID 확인
ls -l /proc/<PID>/cwd   # 그 프로세스가 돌고 있는 폴더
```

#### 4-2. 안전한 스냅샷 만들기

봇이 돌아가는 중에 파일을 그냥 복사하면 쓰는 도중의 상태가 섞일 수 있습니다.
SQLite 백업 API로 일관된 사본을 뜹니다. 봇을 끄지 않아도 됩니다.

```bash
cd <4-1에서 찾은 폴더>
python3 -c "
import sqlite3
src = sqlite3.connect('writing_bot.db')
dst = sqlite3.connect('/tmp/writing_bot_backup.db')
src.backup(dst); dst.close(); src.close()
print('스냅샷 완료')
"
```

내려받기 전에 실제 데이터가 맞는지 확인합니다.

```bash
python3 -c "
import sqlite3
c = sqlite3.connect('/tmp/writing_bot_backup.db')
print('기록', c.execute('SELECT COUNT(*) FROM writing_records').fetchone()[0], '건')
print('인원', c.execute('SELECT COUNT(DISTINCT user_id) FROM writing_records').fetchone()[0], '명')
print('기간', c.execute('SELECT MIN(write_date), MAX(write_date) FROM writing_records').fetchone())
"
```

#### 4-3. 내 컴퓨터로 내려받기

`exit`로 SSH를 빠져나온 뒤, **이 저장소 폴더에서** 실행합니다.

```bash
scp -P 24114 ubuntu@ssh.gsmsv.site:/tmp/writing_bot_backup.db gsmsv_writing_bot.db
```

> `ssh`는 포트 옵션이 소문자 `-p`, `scp`는 대문자 `-P`입니다. 자주 틀리는 부분입니다.

scp가 막혀 있으면 base64로 우회할 수 있습니다.

```bash
ssh ubuntu@ssh.gsmsv.site -p 24114 "base64 -w0 /tmp/writing_bot_backup.db" > db.b64
python -c "import base64,pathlib; pathlib.Path('gsmsv_writing_bot.db').write_bytes(base64.b64decode(pathlib.Path('db.b64').read_text()))"
```

#### 4-4. D1로 넣기

```bash
python scripts/export-sqlite.py gsmsv_writing_bot.db
npx wrangler d1 execute writing-bot --remote --file=data/import.sql
```

변환 스크립트가 `기록 N건, 인원 N명`을 출력합니다. 4-2에서 본 숫자와 같은지 확인하세요.

`data/import.sql`은 기존 기록을 그대로 옮깁니다. 스크립트가 `DELETE FROM writing_records`로
시작하므로 여러 번 실행해도 중복되지 않습니다. (그래서 **새 봇이 기록을 쌓기 시작한 뒤에
실행하면 그 기록이 지워집니다.** 반드시 이 순서를 지키세요.)

### 5. 인터랙션 엔드포인트 연결 ← 여기가 전환 시점

> 이 URL을 저장하는 순간부터 Discord는 인터랙션을 **Gateway로 보내지 않습니다.**
> 즉 GSM SV에서 돌던 기존 봇은 이 시점에 명령을 못 받습니다. 4번을 먼저 끝내고 진행하세요.

개발자 포털 → General Information → **INTERACTIONS ENDPOINT URL**에 3번의 Worker 주소를
넣고 저장합니다. Discord가 검증용 PING을 보내며, 서명 검증이 올바르면 바로 저장됩니다.

### 6. 슬래시 커맨드 등록

`.dev.vars.example`을 복사해 `.dev.vars`를 만들고 실제 값을 채운 뒤:

```bash
cp .dev.vars.example .dev.vars   # 값 채우기
npm run register
```

기존에는 봇이 켜질 때 `tree.sync()`로 자동 등록했지만, 이제 상주 프로세스가 없어서
이 스크립트로 분리했습니다. **명령어를 추가·수정하면 매번 실행해야 반영됩니다.**

### 7. 기존 봇 종료

GSM SV의 봇 프로세스를 끄고 인스턴스를 정리합니다.

---

## 평소 작업

| 작업 | 명령 |
| --- | --- |
| 코드 수정 후 배포 | `npm run deploy` |
| 타입 검사 | `npm run typecheck` |
| 로컬 실행 | `npm run dev` (로컬 D1은 `npm run db:init:local` 먼저) |
| 실시간 로그 | `npx wrangler tail` |
| 커맨드 재등록 | `npm run register` |
| 커맨드 전체 삭제 | `npm run unregister` |
| DB 조회 | `npx wrangler d1 execute writing-bot --remote --command "SELECT * FROM writing_records LIMIT 10"` |
| DB 백업 | `npx wrangler d1 export writing-bot --remote --output backup.sql` |

D1은 자동 백업이 없습니다. 학기 말처럼 중요한 시점에는 위 `d1 export`로 한 번씩 받아두세요.

## 무료 티어 한도

| 항목 | 한도 | 이 봇의 사용량 |
| --- | --- | --- |
| Workers 요청 | 100,000회/일 | 명령 1회 = 1요청. 여유 많음 |
| D1 읽은 행 | 500만 행/일 | 인덱스가 있어 현황 조회도 수십~수백 행 |
| D1 쓴 행 | 10만 행/일 | 인증 1회 = 1행 |
| D1 저장 용량 | 5GB | 기록 1건이 100바이트 미만 |

스핀다운이나 외부 핑거가 필요 없고, 카드 등록 없이 계속 무료입니다.
`schema.sql`의 인덱스는 기존 SQLite 버전에는 없던 것으로, D1이 "읽은 행 수"로 한도를 세기
때문에 풀스캔을 막으려고 추가했습니다.

## 문제가 생기면

- **명령어가 안 보임** → `npm run register` 실행 여부, `GUILD_ID`가 맞는지 확인
- **"애플리케이션이 응답하지 않았습니다"** → `npx wrangler tail`로 로그 확인
- **엔드포인트 URL 저장이 안 됨** → `DISCORD_PUBLIC_KEY`가 봇 토큰이 아니라 **PUBLIC KEY**인지 확인
- **`/오늘글작성현황`만 실패** → 개발자 포털의 SERVER MEMBERS INTENT가 꺼졌는지 확인
