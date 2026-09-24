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

단계별 안내: [`docs/02-deploy.md`](docs/02-deploy.md). 코드를 고친 뒤에는 `cd web && npm run build:gas`로 `apps-script/index.html`을 다시 만듭니다.

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
