import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticHebrewDate} from '../web/hebrew-date.js';
import {hebrewForYmd} from '../dist/hebrew.js';

test('automatic simcha date matches the server calendar across leap months and DST',()=>{
  const day=new Date('2026-01-01T12:00:00Z');
  for(let i=0;i<1100;i++) {
    const ymd=day.toISOString().slice(0,10);
    assert.equal(automaticHebrewDate(ymd),hebrewForYmd(ymd),ymd);
    const next=new Date(day);next.setUTCDate(next.getUTCDate()+1);
    assert.equal(automaticHebrewDate(ymd,true),hebrewForYmd(next.toISOString().slice(0,10)),ymd+' after sunset');
    day.setUTCDate(day.getUTCDate()+1);
  }
  for(const invalid of ['','2026-02-30','2026-13-01','not-a-date'])assert.equal(automaticHebrewDate(invalid),'');
});
