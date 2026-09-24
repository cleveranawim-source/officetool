# 시수핏 (SisuFit)

학사일정(구글 캘린더)과 학반별 시간표를 읽어서 **반·과목별 실제 수업 시수**를 계산하고,
**편제 부족·시험 전 반간 진도 격차**를 찾아 **요일 교체·행사 교시 이동** 같은 보완안을 제안하는 도구입니다.

- 기획: [`docs/00-brainstorm.md`](docs/00-brainstorm.md)
- 설계와 결정 사항: [`docs/01-design.md`](docs/01-design.md)

## 구조

```
web/            웹 화면 (Vite + Preact + TypeScript, 빌드하면 HTML 파일 하나)
  src/engine/   계산 엔진 (화면과 분리된 순수 함수, 단위 테스트 포함)
  src/ui/       화면
  src/data/     익명화한 예시 시간표와 예시 학사일정
apps-script/    구글 Apps Script 웹앱 (캘린더·시트 연결, 공용 설정 저장)
```

## 개발

```bash
cd web
npm install
npm run dev        # 로컬 미리보기
npm test           # 엔진 테스트
npm run build      # dist/index.html 한 파일로 빌드
```

실제 학교 시간표는 공개 저장소에 올리지 않습니다. `web/data-private/timetable.json`(gitignore)에 두고
`npm run build:private`로 빌드하면 그 시간표가 기본값으로 들어갑니다.

## 구글 Apps Script로 배포 (학교 계정)

1. `cd web && npm run build:gas` → `apps-script/index.html`이 만들어집니다.
2. [script.google.com](https://script.google.com)에서 새 프로젝트를 만들고
   `Code.gs`, `index.html`(HTML 파일), `appsscript.json`(프로젝트 설정 → "appsscript.json 표시")을 붙여 넣습니다.
   (`clasp`를 쓰면 `apps-script/` 폴더를 그대로 `clasp push` 하면 됩니다.)
3. 배포 → 새 배포 → 웹 앱. 실행 사용자: **웹 앱에 액세스하는 사용자**, 액세스: **학교 도메인**.
4. 웹앱 주소로 들어가 `데이터·설정`에서 학사일정 캘린더를 고르고 시간표 시트 주소를 넣습니다.

각 선생님은 자기 계정 권한으로 캘린더를 읽고, 분류 수정·적용한 제안 같은 설정은 학교 공용으로 저장됩니다.

## 일정 제목 규칙

| 제목 예 | 해석 |
|---|---|
| `진로교육 1-7` | 1~7교시 진로교육으로 대체 |
| `함께하는 삶1` | 1교시 특별교육 |
| `2학년 수련회` | 2학년 전 교시 행사 |
| `목요일 시간표 운영` | 그날 목요일 시간표로 수업 |
| `재량휴업일`, 공휴일 | 수업 없음 (법정 공휴일은 자동 추가) |
| `2학기 중간고사` | 시험 기간, 시험 전 진도 비교의 기준점 |

자동 분류가 틀린 일정은 화면의 `학사일정`에서 바로 고칠 수 있습니다.
