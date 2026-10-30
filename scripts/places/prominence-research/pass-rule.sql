-- Pass keep/hide rule for CH, AT and IT (issue #462 research).
-- Inputs, all in schema scratch_sn:
--   pts        swissNAMES3D points (objektart 'Pass' / 'Strassenpass'), g geography
--   at         BEV DLM names (cls 'Übergang'), g geography
--   osm_ch     catalogue places in Switzerland (kinds text[])
--   osm_at/it  catalogue places in Austria / Italy (kind text), from match-dem.sql
--   ps_a       CH passes with DEM saddle depth (sig) and saddle height, from the swissALTI3D run
--   ps_at/it   AT / IT passes with DEM saddle depth, from match-dem.sql
-- A pass is kept when any rule matches, in this order; otherwise it is hidden.
drop table if exists scratch_sn.pass_rule_all;
create table scratch_sn.pass_rule_all as
with passes as (
  select 'CH' cc, o.id, o.display_name, o.elevation_m, o.location, o.tags, s.sig, s.dem_saddle_ele
  from scratch_sn.osm_ch o left join scratch_sn.ps_a s using (id) where 'pass' = any(o.kinds)
  union all
  select 'AT', o.id, o.display_name, o.elevation_m, o.location, o.tags, s.sig, s.dem_saddle_ele
  from scratch_sn.osm_at o join scratch_sn.ps_at s using (id)
  union all
  select 'IT', o.id, o.display_name, o.elevation_m, o.location, o.tags, s.sig, s.dem_saddle_ele
  from scratch_sn.osm_it o join scratch_sn.ps_it s using (id)),
gazetteer as (
  select 'CH' cc, name, g from scratch_sn.pts where objektart in ('Pass', 'Strassenpass')
  union all
  select 'AT', name, g from scratch_sn.at where cls = 'Übergang')
select p.cc, p.id, p.display_name, p.elevation_m,
  coalesce(p.elevation_m, p.dem_saddle_ele) alt_m, p.sig,
  exists (select 1 from gazetteer z where z.cc = p.cc and st_dwithin(z.g, p.location, 250)) in_gazetteer,
  exists (select 1 from gazetteer z where z.cc = p.cc and lower(z.name) = lower(p.display_name)
          and st_dwithin(z.g, p.location, 1500)) same_name_gazetteer,
  p.tags ? 'wikipedia' has_wikipedia
from passes p;

alter table scratch_sn.pass_rule_all add column cat text;
update scratch_sn.pass_rule_all set cat = case
  when in_gazetteer then 'keep: in gazetteer'
  when same_name_gazetteer then 'keep: same name in gazetteer within 1.5 km'
  when sig >= 150 then 'keep: depth >= 150 m'
  when alt_m >= 1800 and sig >= 50 then 'keep: alpine (>= 1800 m, depth >= 50 m)'
  when has_wikipedia then 'keep: has Wikipedia article'
  else 'hide' end;

select cc, cat, count(*) from scratch_sn.pass_rule_all group by 1, 2 order by 1, 2;
