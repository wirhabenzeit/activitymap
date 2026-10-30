-- Print the 0.1-degree tile list for one country: every tile touching the concave hull of the
-- country's catalogue places, buffered by 25 km so that prominence near the border sees the terrain beyond.
-- usage: psql -At -F' ' -v cc=AT -f domain-tiles.sql > tiles.txt
-- Output lines are "lon lat name", lower-left corner, with the FLT name of the upper-left corner.
with dom as (
  select st_buffer(st_concavehull(st_collect(location::geometry), 0.05)::geography, 25000) g
  from scratch_sn.osm_cc where cc = :'cc'),
box as (
  select floor(st_xmin(g::geometry) * 10)::int x0, ceil(st_xmax(g::geometry) * 10)::int x1,
         floor(st_ymin(g::geometry) * 10)::int y0, ceil(st_ymax(g::geometry) * 10)::int y1, g from dom),
t as (
  select x / 10.0 x, y / 10.0 y from box, generate_series(x0, x1) x, generate_series(y0, y1) y
  where st_intersects(st_makeenvelope(x / 10.0, y / 10.0, x / 10.0 + 0.1, y / 10.0 + 0.1, 4326)::geography, g))
select x, y, format('tile_%sx%s_%sx%s.flt',
  floor(y + 0.1)::int, lpad(round(((y + 0.1) - floor(y + 0.1)) * 100)::int::text, 2, '0'),
  lpad(floor(x)::int::text, 3, '0'), lpad(round((x - floor(x)) * 100)::int::text, 2, '0'))
from t order by y, x;
