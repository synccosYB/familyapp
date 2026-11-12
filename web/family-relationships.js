// A marriage's children share these two actual parent IDs; spouse order is personal.
export function marriageChildren(people, personId, spouseId) {
  return people.filter(c => (c.father_id === personId || c.mother_id === personId) &&
    (spouseId === undefined || (c.father_id === personId ? c.mother_id : c.father_id) === spouseId));
}
export function childParents(personId, spouseId, fatherId) {
  if (!personId || !spouseId || personId === spouseId || ![personId, spouseId].includes(fatherId)) {
    throw new Error('קלייב דעם ריכטיגן טאטע און מאמע');
  }
  return {father_id: fatherId, mother_id: fatherId === personId ? spouseId : personId};
}
