import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normPhoneB } from '../dist/phone.js';
import { gem, hebrewForYmd, nextYahrzeit, MONTH_CODES } from '../dist/hebrew.js';
import { MASECHTOS } from '../dist/masechtos.js';

test('US and international phone identities normalize consistently',()=>{
 assert.equal(normPhoneB('(845) 555-0101'),'18455550101');
 assert.equal(normPhoneB('+1 845 555 0101'),'18455550101');
 assert.equal(normPhoneB('+44 20 7946 0123'),'442079460123');
 for(const value of ['',null,undefined,'1234','1234567890123456'])assert.equal(normPhoneB(value),'');
});
test('Hebrew labels and learning catalogue retain expected special cases',()=>{
 assert.equal(gem(15),'ט״ו');assert.equal(gem(16),'ט״ז');assert.equal(gem(23),'כ״ג');
 assert.equal(MASECHTOS.length,63);assert.equal(new Set(MASECHTOS).size,63);
 assert.ok(!hebrewForYmd('2026-11-11').includes('undefined'));
 for(const code of MONTH_CODES){
  const occurrence=nextYahrzeit(15,code);
  assert.ok(occurrence);assert.ok(occurrence.days>=0&&occurrence.days<=400,code);
  assert.match(occurrence.ymd,/^\d{4}-\d{2}-\d{2}$/);assert.ok(!occurrence.hebrew.includes('undefined'));
 }
});
test('compiled deployment entry points and static assets exist',async()=>{
 for(const name of ['dist/index.js','dist/bootstrap.js','db/migrations/001_schema.sql','web/app.js','web/styles.css','web/index.html'])assert.ok((await readFile(name)).length,name);
 const html=await readFile('web/index.html','utf8');assert.match(html,/dir="rtl"/);assert.match(html,/lang="yi"/);
});
