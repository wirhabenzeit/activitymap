-- Parameters: $1 = athlete ID (bigint). No existing titles influence sampling.
with eligible as (
  select a.id::text, a.name, a.sport_type, a.start_date::date::text,
    a.distance, a.total_elevation_gain,
    case when a.sport_type = 'BackcountrySki' then 'ski'
         when a.sport_type = 'Hike' then 'hike' else 'bike' end as category,
    s.payload is not null as has_streams,
    row_number() over (partition by case when a.sport_type = 'BackcountrySki' then 'ski' when a.sport_type = 'Hike' then 'hike' else 'bike' end order by a.start_date desc, a.id desc) as recent_rank,
    row_number() over (partition by case when a.sport_type = 'BackcountrySki' then 'ski' when a.sport_type = 'Hike' then 'hike' else 'bike' end order by a.total_elevation_gain desc nulls last, a.id desc) as climbing_rank,
    row_number() over (partition by case when a.sport_type = 'BackcountrySki' then 'ski' when a.sport_type = 'Hike' then 'hike' else 'bike' end order by md5(a.id::text || 'osm-name-prototype-v1')) as random_rank
  from activities a left join activity_streams s on s.activity_id = a.id
  where a.athlete = $1::bigint
    and a.sport_type in ('BackcountrySki', 'Hike', 'Ride', 'GravelRide', 'MountainBikeRide')
    and a.start_date >= '2023-01-01'
    and a.distance > case when a.sport_type in ('BackcountrySki', 'Hike') then 5000 else 50000 end
    and coalesce(a.map_polyline, a.map_summary_polyline, '') <> ''
)
select * from eligible
where recent_rank <= 2 or climbing_rank <= 2 or random_rank <= 2
order by category, start_date desc;
