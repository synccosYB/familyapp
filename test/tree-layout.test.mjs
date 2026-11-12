import {test} from 'node:test';
import assert from 'node:assert/strict';
import {familyUnits} from '../web/tree-layout.js';

test('married couple appears once, with both people’s father and mother edges',()=>{
  const people=[{id:1},{id:2},{id:3},{id:4},{id:5,father_id:1,mother_id:2,spouse_id:6},{id:6,father_id:3,mother_id:4,spouse_id:5}];
  const {units,edges}=familyUnits(people);
  assert.equal(units.length,5);
  assert.deepEqual(units.flatMap(u=>u.members.map(p=>p.id)).sort(),[1,2,3,4,5,6]);
  const couple=units.find(u=>u.members.length===2);
  assert.deepEqual(couple.members.map(p=>p.id),[5,6]);assert.equal(couple.level,1);
  assert.deepEqual(edges,[{parentId:1,childId:5},{parentId:2,childId:5},{parentId:3,childId:6},{parentId:4,childId:6}]);
});
test('shared ancestors, legacy links and hidden spouses do not duplicate people',()=>{
  const {units,edges}=familyUnits([{id:1},{id:2,parent_id:1,spouse_id:99},{id:3,father_id:1,mother_id:1}]);
  assert.equal(units.length,3);assert.ok(units.every(u=>u.members.length===1));assert.equal(edges.length,2);
  assert.deepEqual(units.map(u=>u.level),[0,1,1]);
});
test('several generations rank below both parents, independent of record ordering',()=>{
  const {units}=familyUnits([{id:4,father_id:3},{id:3,father_id:2},{id:2,mother_id:1},{id:1}]);
  assert.deepEqual(units.map(u=>u.level),[3,2,1,0]);
});
test('invalid legacy cycles cannot hang rendering',()=>{
  const {units}=familyUnits([{id:1,parent_id:2},{id:2,parent_id:1}]);
  assert.equal(units.length,2);assert.ok(units.every(u=>Number.isFinite(u.level)));
});


test('spouses follow the displayed parent branches even when created in the opposite order',()=>{
  const {units}=familyUnits([{id:1},{id:2},{id:3},{id:4},{id:5,father_id:3,mother_id:4,spouse_id:6},{id:6,father_id:1,mother_id:2,spouse_id:5}]);
  assert.deepEqual(units.find(u=>u.members.length===2).members.map(p=>p.id),[6,5]);
});
