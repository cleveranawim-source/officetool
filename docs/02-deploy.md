# 시수핏 배포하기 (Google Apps Script 웹앱)

학교 구글 계정으로 한 번만 하면 됩니다. 15분 정도 걸립니다.
배포하면 `https://script.google.com/a/macros/…/exec` 주소가 생기고, 학교 선생님은 누구나 이 주소로 들어와 같은 화면과 설정을 봅니다.

## 준비물

| 파일 | 가져올 곳 |
|---|---|
| `Code.gs` | [apps-script/Code.gs](https://github.com/cleveranawim-source/officetool/blob/claude/admiring-turing-cdqq7w/apps-script/Code.gs) |
| `index.html` | [apps-script/index.html (원문 보기)](https://raw.githubusercontent.com/cleveranawim-source/officetool/claude/admiring-turing-cdqq7w/apps-script/index.html) |
| `appsscript.json` | [apps-script/appsscript.json](https://github.com/cleveranawim-source/officetool/blob/claude/admiring-turing-cdqq7w/apps-script/appsscript.json) |

`index.html`은 한 줄이 아주 긴 파일입니다. 원문 보기 페이지에서 **Ctrl+A → Ctrl+C**로 통째로 복사하세요.

## 1. 프로젝트 만들기

1. 학교 계정으로 [script.google.com](https://script.google.com) → **새 프로젝트**
2. 왼쪽 위 "제목 없는 프로젝트"를 눌러 이름을 **시수핏**으로 바꿉니다.

## 2. 파일 세 개 넣기

1. **Code.gs**: 편집기에 있는 `function myFunction() {…}`을 모두 지우고 `Code.gs` 내용을 붙여 넣습니다.
2. **index.html**: 파일 옆 **＋ → HTML** → 이름에 `index`만 입력(`.html`은 자동으로 붙음) → 기본 내용을 지우고 붙여 넣습니다.
3. **appsscript.json**: 왼쪽 톱니바퀴(**프로젝트 설정**) → **"편집기에서 'appsscript.json' 매니페스트 파일 표시"** 체크 → 편집기로 돌아와 `appsscript.json`을 열고 내용을 통째로 바꿉니다.
4. **Ctrl+S**로 저장합니다.

## 3. 웹 앱으로 배포

1. 오른쪽 위 **배포 → 새 배포**
2. 톱니바퀴(유형 선택) → **웹 앱**
3. 설정
   - 설명: `v1`
   - 다음 사용자 인증 정보로 실행: **나**
   - 액세스 권한이 있는 사용자: **학교 도메인 안의 모든 사용자**
4. **배포** → **액세스 승인** → 학교 계정 선택
   - "Google에서 확인하지 않은 앱" 화면이 나오면 **고급 → 시수핏(으)로 이동(안전하지 않음)** 을 누릅니다. 직접 만든 스크립트라 뜨는 안내입니다.
   - 요청 권한: 캘린더(일정 읽기·제안 등록), 스프레드시트 읽기(시간표), 외부 요청(공개 캘린더 iCal)
5. 나온 **웹 앱 URL**을 복사해 둡니다. 이 주소를 선생님들께 공유합니다.

> "나"로 실행하므로 다른 선생님은 권한 승인 없이 바로 씁니다. 대신 **보완 제안을 캘린더에 등록**하면 배포한 선생님 권한으로 등록되므로, 학사일정 캘린더 편집 권한이 있는 계정으로 배포하세요.

## 4. 처음 설정 (웹앱 화면에서)

1. 웹앱 URL 접속 → 왼쪽 **데이터·설정**
2. **학사일정 가져오기 → 구글 캘린더** → "캘린더 ID 또는 공유 주소"에 학사일정 캘린더의 iCal 주소나 임베드 주소를 그대로 붙여 넣고 **불러오기**
3. **시간표**: Drive에 있는 "전체 학반" 시간표 엑셀 파일을 열고 **파일 → Google 스프레드시트로 저장**한 뒤, 그 시트 주소를 "시간표 시트 주소"에 넣고 **시트 읽기 → 시간표 바꾸기**
4. **계산 기준**에서 학기 시작일·끝(12/31)을 맞춥니다.
5. **학사일정** 화면에서 "확인 필요" 일정의 분류를 확인합니다.

여기서 바꾼 설정(분류 수정, 적용한 제안, 시간표)은 학교 공용으로 저장되어 다른 선생님 화면에도 똑같이 보입니다.

## 5. 새 버전으로 올리기

코드가 바뀌면 `index.html`(과 바뀐 경우 `Code.gs`)만 다시 붙여 넣고
**배포 → 배포 관리 → 연필(수정) → 버전: 새 버전 → 배포**. 웹앱 주소는 그대로입니다.

## 문제가 생기면

| 증상 | 해결 |
|---|---|
| 화면이 하얗게 나옴 | `index.html` 파일 이름이 정확히 `index`인지, 내용이 끝까지 붙었는지 확인 |
| "캘린더를 열 수 없습니다" | 캘린더 공유 설정이 "공개" 또는 학교 도메인 공개인지 확인. 주소를 iCal 주소로 넣어 보기 |
| 시트를 읽지 못함 | .xlsx 파일이 아니라 구글 스프레드시트로 저장한 주소인지, 첫 번째 탭이 "전체 학반 시간표"인지 확인 |
| 예전 화면이 보임 | 배포 관리에서 새 버전으로 올렸는지 확인 |
