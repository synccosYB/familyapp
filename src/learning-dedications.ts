import { personSql } from './family-scope.js';

// Resolve names in the list's family and the recipient's access scope.
export function learningTitleSql(sides: string) {
  const personSide = (alias: string) => `${personSql(alias, 'ARRAY[l.family_group_id]')}
    AND (${alias}.side IN ('both','all') OR ${alias}.side=ANY(${sides}))`;
  return `(SELECT string_agg(regexp_replace(btrim(CASE
    WHEN p.id IS NOT NULL THEN concat_ws(' ',nullif(p.title,''),p.name,
      CASE WHEN f.id IS NOT NULL THEN concat_ws(' ',nullif(p.lineage_term,''),nullif(f.title,''),f.name) END)
    WHEN y.id IS NOT NULL AND y.person_id IS NULL AND y.family_group_id=l.family_group_id
      AND (y.side IN ('both','all') OR y.side=ANY(${sides})) THEN concat_ws(' ',y.name,nullif(y.father_name,''))
    ELSE d.niftar END), '([[:space:]]+ז[״"“”]ל[.!?]?)+$', '') || ' ז״ל', ' · ' ORDER BY d.position)
    FROM learning_dedications d
    LEFT JOIN yahrzeits y ON y.id=d.yahrzeit_id
    LEFT JOIN people p ON p.id=y.person_id AND ${personSide('p')}
    LEFT JOIN people f ON f.id=p.father_id AND ${personSide('f')}
    WHERE d.list_id=l.id)`;
}

export function learningListFieldsSql(sides: string) {
  return `${learningTitleSql(sides)} niftar,
    ARRAY(SELECT d.yahrzeit_id FROM learning_dedications d
      WHERE d.list_id=l.id AND d.yahrzeit_id IS NOT NULL ORDER BY d.position) yahrzeit_ids,
    (SELECT coalesce(json_agg(json_build_object('id',f.id,'name',f.name) ORDER BY f.name,f.id),'[]')
      FROM families f WHERE f.family_group_id=l.family_group_id AND EXISTS (
        SELECT 1 FROM learning_dedications d JOIN yahrzeits y ON y.id=d.yahrzeit_id
        JOIN person_families pf ON pf.person_id=y.person_id
        WHERE d.list_id=l.id AND pf.family_id=f.id)) families`;
}
