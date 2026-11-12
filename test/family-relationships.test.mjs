import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marriageChildren,childParents} from '../web/family-relationships.js';
test('children stay with their actual marriage regardless of spouse order or parent role',()=>{
 const people=[{id:4,father_id:1,mother_id:2},{id:5,father_id:1,mother_id:3},{id:6,father_id:1},{id:7,father_id:8,mother_id:2}];
 const before=structuredClone(people);
 assert.deepEqual(marriageChildren(people,1,2).map(c=>c.id),[4]);
 assert.deepEqual(marriageChildren(people,1,3).map(c=>c.id),[5]);
 assert.deepEqual(marriageChildren(people,3,1).map(c=>c.id),[5]);
 assert.deepEqual(marriageChildren(people,1).map(c=>c.id),[4,5,6]);
 assert.deepEqual(childParents(1,3,1),{father_id:1,mother_id:3});
 assert.deepEqual(childParents(3,1,1),{father_id:1,mother_id:3});
 assert.throws(()=>childParents(1,3,0)); assert.throws(()=>childParents(1,1,1));
 assert.deepEqual(people,before);
});
