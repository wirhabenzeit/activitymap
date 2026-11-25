-- Match catalogue peaks and passes of one country to a prominence run (issue #462 research).
-- usage: psql -v cc=AT -v dem=dem_at -v osm=osm_at -v pk=pk_at -v ps=ps_at -f match-dem.sql
-- Expects scratch_sn.:dem(lat, lon, ele, slat, slon, prom) loaded from merge_divide_trees results.txt,
-- and scratch_sn.osm_cc(id, kind, display_name, elevation_m, location, tags, cc).
drop table if exists scratch_sn.:"osm", scratch_sn.:"pk", scratch_sn.:"ps";
alter table scratch_sn.:"dem" add column id serial, add column pk geography, add column sk geography;
update scratch_sn.:"dem" set pk = st_setsrid(st_makepoint(lon, lat), 4326)::geography,
  sk = case when slat is not null then st_setsrid(st_makepoint(slon, slat), 4326)::geography end;
create index on scratch_sn.:"dem" using gist (pk);
create index on scratch_sn.:"dem" using gist (sk);

create table scratch_sn.:"osm" as
select id, kind, display_name, elevation_m, location, tags from scratch_sn.osm_cc where cc = :'cc';
create index on scratch_sn.:"osm" using gist (location);

-- peaks: candidates within 250 m not closer to another OSM peak; prefer consistent height, then prominence, then distance
create table scratch_sn.:"pk" as
select o.id, o.display_name, o.elevation_m, o.tags->>'wikidata' qid, d.ele dem_ele, d.prom dem_prom, d.dist
from scratch_sn.:"osm" o
left join lateral (
  select x.ele, x.prom, st_distance(x.pk, o.location) dist from scratch_sn.:"dem" x
  where st_dwithin(x.pk, o.location, 250)
    and not exists (select 1 from scratch_sn.:"osm" o2 where o2.kind = 'peak' and o2.id <> o.id
                    and st_dwithin(o2.location, x.pk, st_distance(o.location, x.pk) - 1))
  order by (o.elevation_m is null or abs(x.ele - o.elevation_m) <= 15) desc, x.prom desc, x.pk <-> o.location
  limit 1) d on true
where o.kind = 'peak';

-- passes: nearest key saddle within 150 m; depth = prominence of the peak it separates
create table scratch_sn.:"ps" as
select o.id, o.display_name, o.elevation_m, d.ele - d.prom dem_saddle_ele, d.prom sig, d.dist
from scratch_sn.:"osm" o
left join lateral (
  select x.*, st_distance(x.sk, o.location) dist from scratch_sn.:"dem" x
  where x.sk is not null and st_dwithin(x.sk, o.location, 150) order by x.sk <-> o.location limit 1) d on true
where o.kind = 'pass';
