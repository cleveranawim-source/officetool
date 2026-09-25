/**
 * 시수핏 — Google Apps Script 웹앱
 *
 * 웹 화면(index.html)은 web/ 폴더에서 빌드한 단일 파일이다.
 * 이 스크립트는 화면이 부르는 서버 함수만 제공한다.
 *   - 학사일정 캘린더 읽기 / 보완 제안 일정 등록
 *   - 시간표 시트 읽기
 *   - 학교 공용 설정 저장 (스크립트 속성, 여러 선생님이 같은 설정을 봄)
 */

var TZ = 'Asia/Seoul';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('시수핏')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 접근 가능한 캘린더 목록 */
function listCalendars() {
  return CalendarApp.getAllCalendars().map(function (c) {
    return { id: c.getId(), name: c.getName() };
  });
}

/**
 * 기간 안의 일정을 화면 형식으로 돌려준다.
 * 종일 일정의 끝 날짜는 포함 날짜(inclusive)로 바꾼다.
 */
function getEvents(calendarId, start, end) {
  var cal = openCalendar_(calendarId);
  var from = new Date(start + 'T00:00:00+09:00');
  var to = new Date(end + 'T23:59:59+09:00');
  return cal.getEvents(from, to).map(function (e) {
    var s, t;
    if (e.isAllDayEvent()) {
      s = e.getAllDayStartDate();
      t = new Date(e.getAllDayEndDate().getTime() - 24 * 3600 * 1000);
    } else {
      s = e.getStartTime();
      t = e.getEndTime();
    }
    var sd = fmt_(s);
    var ed = fmt_(t);
    return {
      id: e.getId() + '_' + sd,
      title: e.getTitle(),
      start: sd,
      end: ed < sd ? sd : ed,
      description: e.getDescription() || undefined,
      source: 'calendar',
    };
  });
}

/** 보완 제안(요일 교체 등)을 종일 일정으로 등록 */
function addPlanEvents(calendarId, events) {
  var cal = openCalendar_(calendarId);
  var n = 0;
  events.forEach(function (ev) {
    var day = new Date(ev.start + 'T00:00:00+09:00');
    var exists = cal.getEventsForDay(day).some(function (e) {
      return e.getTitle() === ev.title;
    });
    if (!exists) {
      cal.createAllDayEvent(ev.title, day, { description: '시수핏 보완 제안으로 추가' });
      n++;
    }
  });
  return n;
}

/** 시간표 시트(첫 번째 탭)를 탭 구분 텍스트로 */
function readTimetableSheet(url) {
  var sheet = SpreadsheetApp.openByUrl(url).getSheets()[0];
  return sheet
    .getDataRange()
    .getDisplayValues()
    .map(function (row) {
      return row.join('\t');
    })
    .join('\n');
}

/** NEIS 교육정보 개방 포털: 브라우저가 직접 못 부를 때 대신 받는다 (NEIS 주소만) */
function fetchNeis(url) {
  if (String(url).indexOf('https://open.neis.go.kr/hub/') !== 0) throw new Error('NEIS 주소만 읽을 수 있습니다.');
  return UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText('UTF-8');
}

/** 학사일정 시트: 모든 시트를 보이는 값 그대로 [{sheet, rows}] 로 */
function readEventSheets(url) {
  return SpreadsheetApp.openByUrl(url)
    .getSheets()
    .map(function (sheet) {
      return { sheet: sheet.getName(), rows: sheet.getDataRange().getDisplayValues() };
    });
}

/* ---------- 공용 설정: 속성 값 하나가 9KB 제한이라 나눠 저장 ---------- */
var CHUNK = 8000;

function saveState(json) {
  var props = PropertiesService.getScriptProperties();
  var old = Number(props.getProperty('state_n') || 0);
  var n = Math.ceil(json.length / CHUNK);
  var data = { state_n: String(n) };
  for (var i = 0; i < n; i++) data['state_' + i] = json.slice(i * CHUNK, (i + 1) * CHUNK);
  props.setProperties(data);
  for (var j = n; j < old; j++) props.deleteProperty('state_' + j);
}

function loadState() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('state_n') || 0);
  if (!n) return null;
  var out = '';
  for (var i = 0; i < n; i++) out += props.getProperty('state_' + i) || '';
  return out;
}

/**
 * 캘린더 열기. 내 목록에 없는 공개 캘린더는 구독해서 연다.
 */
function openCalendar_(calendarId) {
  var cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) {
    try {
      cal = CalendarApp.subscribeToCalendar(calendarId, { hidden: true });
    } catch (e) {
      cal = null;
    }
  }
  if (!cal) throw new Error('캘린더를 열 수 없습니다. 캘린더 ID와 공유 설정을 확인하세요: ' + calendarId);
  return cal;
}

/** 공개 캘린더의 iCal 원문 (캘린더를 열 수 없을 때 대체 경로) */
function fetchPublicIcs(calendarId) {
  var url = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(calendarId) + '/public/basic.ics';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('공개 iCal을 받지 못했습니다 (' + res.getResponseCode() + ')');
  return res.getContentText();
}

function fmt_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}
