-- Hut tag profile and the name-and-tag rule (issue #462 prototype). psql -f huts.sql
with h as (
  select o.cc, o.display_name, o.elevation_m, o.location, p.subtypes[array_upper(p.subtypes, 1)] st,
    coalesce(o.tags->>'operator', '') ~* '(SAC|CAS|DAV|ÖAV|OeAV|Alpenverein|CAI|Club Alpino|AVS|Naturfreunde|SAT|Alpenclub|Alpine Club|SEM|SAF)'
      or o.tags ?| array['capacity', 'beds', 'website', 'contact:website', 'url', 'wikidata', 'wikipedia',
                         'reservation', 'opening_hours', 'phone', 'contact:phone'] known,
    o.display_name ~* '(\malm\M|alm$|\malpe?\M|^alp |malga|casera|baita|forst|forestal|forestière|jagd|caccia|ristoro|gasthaus|gasthof|albergo|restaurant|stadel|privat)' other,
    case o.cc
      when 'CH' then exists (select 1 from scratch_sn.pts z where z.objektart in ('Gebaeude', 'Offenes Gebaeude') and st_dwithin(z.g, o.location, 150))
      when 'AT' then exists (select 1 from scratch_sn.at z where z.cls in ('Schutzhütte', 'Biwakschachtel') and st_dwithin(z.g, o.location, 150))
    end gaz
  from scratch_sn.osm_cc o join places p using (id) where o.kind = 'hut')
select cc, st, count(*) huts,
  round(100.0 * avg(gaz::int)) "in gazetteer %",
  round(100.0 * avg(case when known then gaz::int end)) "in gazetteer | known %",
  round(100.0 * avg(case when not known then gaz::int end)) "in gazetteer | bare %",
  count(*) filter (where not known and other) hidden,
  count(*) filter (where not known and other and gaz) "hidden but in gazetteer"
from h group by 1, 2 order by 1, 2;
