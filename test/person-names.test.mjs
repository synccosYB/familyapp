import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personName, yahrzeitName } from '../web/person-names.js';

test('a yahrzeit ends with one memorial suffix after the full name', () => {
  const memorial = { name: 'הרב ר׳ משה', father_name: 'בן הרב ר׳ דוד' };
  const expected = 'הרב ר׳ משה בן הרב ר׳ דוד ז״ל';
  assert.equal(yahrzeitName(memorial), expected);
  assert.equal(yahrzeitName({ name: 'הרב ר׳ משה ז"ל', father_name: 'בן הרב ר׳ דוד ז״ל ז”ל.' }), expected);
});

test('deceased profiles get a single suffix and other profiles keep their name', () => {
  const person = { title: 'הרב', name: 'ר׳ דוד' };
  assert.equal(personName({ ...person, life_status: 'deceased' }), 'הרב ר׳ דוד ז״ל');
  assert.equal(personName({ ...person, niftar: true }, "ר׳ דוד ז''ל"), 'ר׳ דוד ז״ל');
  assert.equal(personName({ ...person, life_status: 'living' }), 'הרב ר׳ דוד');
  assert.equal(personName({ ...person, life_status: 'unknown' }), 'הרב ר׳ דוד');
});
