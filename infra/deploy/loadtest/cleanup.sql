\set ON_ERROR_STOP on
begin;
create temp table load_ids as
  select id from hmt_state where namespace = 'organizer' and collection = 'hackathons' and data->>'title' like 'LOADTEST%'
  union select id from hmt_state where collection = 'users' and data->>'email' like '%@load.hmt';
insert into load_ids
  select id from hmt_state where namespace = 'participant' and collection = 'teams' and data->>'hackathonId' in (select id from load_ids);
create temp table doomed as
  select s.namespace, s.collection, s.id from hmt_state s
  where not exists (select 1 from hmt_state_preload p where p.namespace = s.namespace and p.collection = s.collection and p.id = s.id)
    and (s.data::text like '%@load.hmt%'
         or s.data::text like '%LOADTEST%'
         or exists (select 1 from load_ids l where s.id = l.id or position(l.id in s.data::text) > 0));
select 'load_ids', count(*) from load_ids;
select namespace, collection, count(*) from doomed group by 1, 2 order by 1, 2;
select 'new rows NOT matched' k, s.namespace, s.collection, count(*) from hmt_state s
  where not exists (select 1 from hmt_state_preload p where p.namespace = s.namespace and p.collection = s.collection and p.id = s.id)
    and not exists (select 1 from doomed d where d.namespace = s.namespace and d.collection = s.collection and d.id = s.id)
  group by 2, 3;
select 'preexisting rows referencing load', p.namespace, p.collection, p.id from hmt_state p
  join hmt_state_preload x using (namespace, collection, id)
  where exists (select 1 from load_ids l where position(l.id in p.data::text) > 0) or p.data::text like '%@load.hmt%';
\if :{?apply}
update hmt_state set data = (
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
  from jsonb_array_elements(data) with ordinality as t(e, ord)
  where coalesce(e->>'hackathonId', '') not in (select id from load_ids)
) where namespace = 'organizer' and collection = 'outbox';
select 'outbox after', jsonb_array_length(data) from hmt_state where namespace = 'organizer' and collection = 'outbox';
delete from hmt_state s using doomed d where s.namespace = d.namespace and s.collection = d.collection and s.id = d.id;
commit;
\else
rollback;
\endif
