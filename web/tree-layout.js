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
  const edges = [];
  for (const person of people) {
    for (const parentId of new Set([person.father_id, person.mother_id, person.parent_id].filter(Boolean))) {
      const from = byPerson.get(parentId), to = byPerson.get(person.id);
      if (!from || from === to) continue;
      to.parents.add(from.id);
      edges.push({ parentId, childId: person.id });
    }
  }
  const byUnit = new Map(units.map(u => [u.id, u]));
  const resolved = new Set(), visiting = new Set();
  function rank(unit) {
    if (resolved.has(unit.id)) return unit.level;
    // Defensive guard for invalid legacy data; never recurse indefinitely.
    if (visiting.has(unit.id)) return 0;
    visiting.add(unit.id);
    unit.level = Math.max(0, ...[...unit.parents].map(id => rank(byUnit.get(id)) + 1));
    visiting.delete(unit.id);
    resolved.add(unit.id);
    return unit.level;
  }
  units.forEach(rank);
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
  return { units, edges };
}


// Fit the complete graph; retain a readable lower bound and scroll beyond it.
export function fitTreeScale(width, height, availableWidth, availableHeight) {
  if (![width,height,availableWidth,availableHeight].every(n=>Number.isFinite(n) && n>0)) return 1;
  return Math.max(0.2,Math.min(1,availableWidth/width,availableHeight/height));
}
