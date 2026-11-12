import {test} from 'node:test';
import assert from 'node:assert/strict';
import {familyUnits,fitTreeScale,treeViewportLayout} from '../web/tree-layout.js';

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


test('fit keeps a wide multi-generation tree inside the available screen',()=>{
  for(const [w,h,aw,ah] of [[1000,800,400,500],[750,1400,1100,500],[600,400,1100,700]]) {
    const scale=fitTreeScale(w,h,aw,ah);
    assert.ok(w*scale<=aw+1);assert.ok(h*scale<=ah+1);assert.ok(scale<=1);
  }
  assert.equal(fitTreeScale(0,0,400,500),1);
  assert.equal(fitTreeScale(100000,100000,400,500),0.2,'very large trees remain scrollable at a readable lower bound');
});


const sparseFamily = [
  {id:1,father_id:26,mother_id:27},{id:2},{id:3},{id:4},
  {id:5,father_id:3,mother_id:4,spouse_id:6},
  {id:6,father_id:1,mother_id:2,spouse_id:5},
  {id:7,father_id:6,mother_id:5,spouse_id:8},{id:8},
  {id:9,father_id:7,mother_id:8},{id:26},{id:27}
];
const levelsFor = result => new Map(result.units.flatMap(u=>u.members.map(p=>[p.id,u.level])));
function assertGenerations(result) {
  assert.equal(result.generationConflicts.length,0);
  const levels=levelsFor(result);
  for(const edge of result.edges) assert.equal(levels.get(edge.childId),levels.get(edge.parentId)+1,JSON.stringify(edge));
  for(const unit of result.units) for(const person of unit.members) assert.equal(levels.get(person.id),unit.level);
}
test('missing in-law ancestors cannot put in-laws above the other parents',()=>{
  const result=familyUnits(sparseFamily);assertGenerations(result);const levels=levelsFor(result);
  for(const id of [1,2,3,4]) assert.equal(levels.get(id),1);
  for(const id of [26,27]) assert.equal(levels.get(id),0);
  assert.equal(levels.get(5),2);assert.equal(levels.get(6),2);
  assert.equal(levels.get(7),3);assert.equal(levels.get(8),3);assert.equal(levels.get(9),4);
});
test('adding ancestors and changing record order preserves generation constraints',()=>{
  const variants=[sparseFamily,[...sparseFamily].reverse(),[...sparseFamily.slice(4),...sparseFamily.slice(0,4)]];
  const expected=levelsFor(familyUnits(sparseFamily));
  for(const input of variants) {
    const result=familyUnits(input);assertGenerations(result);
    assert.deepEqual([...levelsFor(result)].sort((a,b)=>a[0]-b[0]),[...expected].sort((a,b)=>a[0]-b[0]));
  }
  const extended=sparseFamily.map(p=>p.id===3?{...p,father_id:30}:p);
  assertGenerations(familyUnits([...extended,{id:30}]));
  const deeper=extended.map(p=>p.id===26?{...p,mother_id:40}:p);
  assertGenerations(familyUnits([...deeper,{id:30},{id:40}]));
});
test('contradictory legacy generations are flagged instead of claiming a valid hierarchy',()=>{
  const result=familyUnits([{id:1,parent_id:2},{id:2,parent_id:1}]);
  assert.ok(result.generationConflicts.length);assert.equal(result.units.length,2);
});


test('a parent link hidden inside a spouse unit is never silently dropped',()=>{
  const result=familyUnits([{id:1,spouse_id:2},{id:2,spouse_id:1,father_id:1}]);
  assert.ok(result.generationConflicts.length);
});


test('zoom extents stay stable at scrollbar boundaries across the zoom range',()=>{
  for(let percent=20;percent<=200;percent++) {
    const zoom=percent/100;
    const first=treeViewportLayout(2111,592,1358,736,zoom);
    assert.deepEqual(treeViewportLayout(2111,592,1358,736,zoom),first);
    assert.ok(first.stageWidth>=1358);assert.ok(first.stageHeight>=736);
    assert.ok(first.right>=0);assert.ok(first.top>=0);
  }
  for(const zoom of [0.6399999,0.64,0.6400001]) {
    const layout=treeViewportLayout(2399,600,1536,700,zoom);
    assert.equal(layout.stageWidth,1536);assert.equal(layout.stageHeight,700);
  }
});
test('fit uses inner dimensions with room for pixel rounding and does not invent vertical overflow',()=>{
  const layout=treeViewportLayout(2111,592,1358,736);
  assert.ok(2111*layout.scale<1358);assert.ok(592*layout.scale<736);
  assert.equal(layout.stageWidth,1358);assert.equal(layout.stageHeight,736);
  assert.ok(Number.isInteger(layout.stageWidth));assert.ok(Number.isInteger(layout.stageHeight));
});
