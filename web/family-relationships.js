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

export function relationshipPath(people, from, to) {
  const graph = new Map(people.map(person => [person.id, new Map()]));
  if (!graph.has(from) || !graph.has(to)) return null;
  const connect = (id, relative, direction, reverse) => {
    if (id === relative || !graph.has(relative)) return;
    if (!graph.get(id).has(relative)) graph.get(id).set(relative, direction);
    if (!graph.get(relative).has(id)) graph.get(relative).set(id, reverse);
  };
  for (const person of people) {
    connect(person.id, person.father_id, 'father', 'child');
    connect(person.id, person.mother_id, 'mother', 'child');
    connect(person.id, person.parent_id, 'parent', 'child');
    connect(person.id, person.spouse_id, 'spouse', 'spouse');
    connect(person.id, person.second_spouse_id, 'spouse', 'spouse');
  }
  const queue = [from];
  const seen = new Map([[from, { id: from, previous: null, relation: null }]]);
  for (let index = 0; index < queue.length && !seen.has(to); index++) {
    for (const [id, relation] of graph.get(queue[index])) {
      if (seen.has(id)) continue;
      seen.set(id, { id, previous: queue[index], relation });
      queue.push(id);
    }
  }
  if (!seen.has(to)) return null;
  const path = [];
  for (let id = to; id !== null;) {
    const step = seen.get(id);
    path.push({ id, relation: step.relation });
    id = step.previous;
  }
  return path.reverse();
}
