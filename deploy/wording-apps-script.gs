/** @OnlyCurrentDoc */

const KOBOR_WORDING_URL = 'https://kobor.it.com/api/wording/sync';
const KOBOR_WORDING_TAB = 'Wording';

function installKoborWording() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  syncKoborWording();
  const handlers = ScriptApp.getProjectTriggers().map(trigger => trigger.getHandlerFunction());
  if (!handlers.includes('onKoborWordingEdit')) {
    ScriptApp.newTrigger('onKoborWordingEdit').forSpreadsheet(spreadsheet).onEdit().create();
  }
  if (!handlers.includes('syncKoborWording')) {
    ScriptApp.newTrigger('syncKoborWording').timeBased().everyMinutes(5).create();
  }
}

function onKoborWordingEdit(event) {
  const range = event.range;
  if (range.getSheet().getName() === KOBOR_WORDING_TAB && range.getLastRow() >= 3 &&
    range.getColumn() <= 2 && range.getLastColumn() >= 2) syncKoborWording();
}

function syncKoborWording() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  const properties = PropertiesService.getScriptProperties();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(KOBOR_WORDING_TAB);
  try {
    const token = properties.getProperty('KOBOR_WORDING_SYNC_TOKEN');
    if (!token) throw new Error('The Kobor sync token is missing.');
    const lastRow = sheet.getLastRow();
    if (lastRow < 3 || sheet.getRange('E2').getDisplayValue() !== 'Key') {
      throw new Error('The Wording tab needs its original headers and keys.');
    }
    const overrides = Object.create(null);
    const rowsByKey = Object.create(null);
    const rows = sheet.getRange(3, 2, lastRow - 2, 4).getDisplayValues();
    for (const [index, [edited, original, , key]] of rows.entries()) {
      if (!key) continue;
      if (rowsByKey[key]) throw new Error('Duplicate wording key in row ' + (index + 3) + '.');
      rowsByKey[key] = index + 3;
      if (edited.trim() && edited !== original) overrides[key] = edited;
    }
    const payload = JSON.stringify({ overrides });
    const digest = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload));
    if (digest === properties.getProperty('KOBOR_WORDING_DIGEST')) return;
    const response = UrlFetchApp.fetch(KOBOR_WORDING_URL, {
      method: 'put',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'x-familye': '1' },
      payload,
      followRedirects: false,
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error('Kobor returned HTTP ' + response.getResponseCode() + '.');
    const { revision, rejected } = JSON.parse(response.getContentText());
    const status = rejected.length
      ? 'Kobor kept the previous wording for rows ' + rejected.map(key => rowsByKey[key]).join(', ') + '. Check the {placeholders}.'
      : 'Synced to Kobor. Revision ' + revision + ' at ' + new Date().toISOString();
    sheet.getRange('B2').setNote(status);
    properties.setProperty('KOBOR_WORDING_DIGEST', digest);
  } catch (error) {
    if (sheet) sheet.getRange('B2').setNote('Kobor sync will retry. ' + error.message);
    throw error;
  } finally {
    lock.releaseLock();
  }
}
