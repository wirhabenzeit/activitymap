-- Export the reviewed pass decisions from the prominence research (scratch_sn.pass_rule_all, PR #472).
-- psql -At -f export-passes.sql > passes.csv
\copy (select r.cc, r.id, r.display_name, st_x(p.location::geometry) lon, st_y(p.location::geometry) lat, p.elevation_m, array_to_string(p.subtypes, '+') subtypes, (p.tags ? 'wikidata') has_wikidata, r.has_wikipedia, r.in_gazetteer or r.same_name_gazetteer gaz, r.sig, r.cat from scratch_sn.pass_rule_all r join places p using (id) order by 1, 5, 4) to stdout csv header
