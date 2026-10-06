// 응답 저장용 Apps Script (구글 시트에 붙여서 웹 앱으로 배포)
// 시트 메뉴: 확장 프로그램 → Apps Script → 이 코드 붙여넣기 → 배포 → 새 배포 → 웹 앱
//   실행 사용자: 나 / 액세스 권한: 모든 사용자 → 배포 후 나오는 URL을 config.js 의 ENDPOINT 에 넣는다
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('log') || ss.insertSheet('log');
    if (sh.getLastRow() === 0) sh.appendRow(['received_at', 'rid', 'step', 'client_ts', 'payload']);
    sh.appendRow([new Date(), d.rid, d.step, d.ts, JSON.stringify(d.payload)]);
    return ContentService.createTextOutput('ok');
  } finally {
    lock.releaseLock();
  }
}
