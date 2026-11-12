// Collapse only explicit, reciprocal spouse links. Every person keeps both parent edges.
export function familyUnits(people) {
  const byId = new Map(people.map(p => [p.id, p]));
  const units = [], byPerson = new Map();
  for (const person of people) {
    if (byPerson.has(person.id)) continue;
    // One canonical card per person, including remarriage chains.
    const members = [], seen = new Set(), queue = [person];
    for (let i=0;i<queue.length;i++) {
      const current=queue[i];if(seen.has(current.id))continue;
      seen.add(current.id);members.push(current);
      for(const partnerId of [current.spouse_id,current.second_spouse_id]) {
        const partner=byId.get(partnerId);
        if(partner && partner.id!==current.id && [partner.spouse_id,partner.second_spouse_id].includes(current.id) && !seen.has(partner.id))queue.push(partner);
      }
    }
    members.sort((a,b)=>a.id-b.id);
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


// Use the scroll viewport's actual inner size, not its scrollbar-inclusive box.
// Quantize extents to pixels so floating-point values at a fit boundary cannot
// alternately add/remove overflow and trigger another layout.
export function treeViewportLayout(width, height, viewportWidth, viewportHeight, zoom = null) {
  const scale = zoom == null
    ? fitTreeScale(width,height,Math.max(1,viewportWidth-1),Math.max(1,viewportHeight-1))
    : Math.max(0.2,Math.min(2,zoom));
  const scaledWidth = Math.round(width*scale), scaledHeight = Math.round(height*scale);
  return {scale,stageWidth:Math.max(viewportWidth,scaledWidth),stageHeight:Math.max(viewportHeight,scaledHeight),
    right:Math.max(0,Math.floor((viewportWidth-scaledWidth)/2)),top:Math.max(0,Math.floor((viewportHeight-scaledHeight)/2))};
}
