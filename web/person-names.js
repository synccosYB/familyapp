const withoutMemorialSuffix = (name) => String(name ?? '').trim()
  .replace(/(?:(?:^|\s+)ז(?:[״"“”]|['׳’]{2})ל[.!?]?)+$/u, '');

export function withMemorialSuffix(name) {
  const base = withoutMemorialSuffix(name);
  return base ? `${base} ז״ל` : '';
}

export const isDeceased = (person) => person.life_status === 'deceased' ||
  (person.life_status !== 'living' && person.niftar === true);

export function personName(person, name = [person.title, person.name].filter(Boolean).join(' ')) {
  return isDeceased(person) ? withMemorialSuffix(name) : name;
}

export function yahrzeitName(yahrzeit) {
  const name = [withoutMemorialSuffix(yahrzeit.name), String(yahrzeit.father_name ?? '').trim()].filter(Boolean).join(' ');
  return withMemorialSuffix(name);
}
