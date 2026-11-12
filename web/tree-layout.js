// Collapse only explicit, reciprocal spouse links. Every person keeps both parent edges.
export function familyUnits(people) {
  const byId = new Map(people.map(p => [p.id, p]));
  const units = [], byPerson = new Map();
  for (const person of people) {
    if (byPerson.has(person.id)) continue;
    const spouse = byId.get(person.spouse_id);
    const members = spouse && spouse.id !== person.id && spouse.spouse_id === person.id
      ? [person, spouse].sort((a, b) => a.id - b.id) : [person];
    const unit = { id: person.id, members, parents: new Set(), level: 0 };
    units.push(unit);
    for (const member of members) byPerson.set(member.id, unit);
  }
  const edges = [], intraUnitConflicts = [];
  for (const person of people) {
    for (const parentId of new Set([person.father_id, person.mother_id, person.parent_id].filter(Boolean))) {
      const from = byPerson.get(parentId), to = byPerson.get(person.id);
      if (!from) continue;
      if (from === to) {intraUnitConflicts.push({parentId,childId:person.id});continue;}
      to.parents.add(from.id);
      edges.push({ parentId, childId: person.id });
    }
  }
  // Parent edges impose a one-generation difference in BOTH directions.
  // Solving the connected family together aligns co-parents/in-laws even when
  // only one branch has known ancestors. Missing parents never become roots
  // at a different generation merely because their records are incomplete.
  const neighbours = new Map(units.map(unit => [unit.id, []]));
  for (const edge of edges) {
    const parent = byPerson.get(edge.parentId), child = byPerson.get(edge.childId);
    neighbours.get(parent.id).push({ id: child.id, delta: 1, edge });
    neighbours.get(child.id).push({ id: parent.id, delta: -1, edge });
  }
  const byUnit = new Map(units.map(unit => [unit.id, unit]));
  const assigned = new Map(), generationConflicts = [...intraUnitConflicts];
  for (const seed of units) {
    if (assigned.has(seed.id)) continue;
    assigned.set(seed.id, 0);
    const queue = [seed.id];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const next of neighbours.get(current)) {
        const expected = assigned.get(current) + next.delta;
        if (!assigned.has(next.id)) {
          assigned.set(next.id, expected);
          queue.push(next.id);
        } else if (assigned.get(next.id) !== expected) {
          generationConflicts.push(next.edge);
        }
      }
    }
    const firstGeneration = queue.reduce((min,id)=>Math.min(min,assigned.get(id)),Infinity);
    for (const id of queue) byUnit.get(id).level = assigned.get(id) - firstGeneration;
  }
  // Member order follows the visual parent branches, not creation order.
  // The same order is used by RTL rows and the two spouse cards.
  const positions = new Map(units.map((unit, index) => [unit.id, index]));
  const parentPosition = person => {
    const parents = [...new Set([person.father_id, person.mother_id, person.parent_id].filter(id => byPerson.has(id)))];
    return parents.length ? parents.reduce((sum, id) => sum + positions.get(byPerson.get(id).id), 0) / parents.length : Infinity;
  };
  for (const unit of units) {
    unit.members.sort((a, b) => {
      const first = parentPosition(a), second = parentPosition(b);
      return first === second ? a.id - b.id : first < second ? -1 : 1;
    });
  }
  return { units, edges, generationConflicts };
}


// Fit the complete graph; retain a readable lower bound and scroll beyond it.
export function fitTreeScale(width, height, availableWidth, availableHeight) {
  if (![width,height,availableWidth,availableHeight].every(n=>Number.isFinite(n) && n>0)) return 1;
  return Math.max(0.2,Math.min(1,availableWidth/width,availableHeight/height));
}
