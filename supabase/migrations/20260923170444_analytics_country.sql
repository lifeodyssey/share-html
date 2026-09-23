-- Coarse Cloudflare request country only. Existing history stays unknown; no IP backfill.
alter table public.analytics_events add column country_code text not null default 'ZZ' check(country_code ~ '^[A-Z]{2}$');
alter table public.analytics_daily add column country_code text not null default 'ZZ' check(country_code ~ '^[A-Z]{2}$');
alter table public.analytics_daily drop constraint analytics_daily_pkey;
alter table public.analytics_daily add primary key(day,traffic_type,route,status,event_name,transport,actor_category,actor_evidence,bot_verified,acquisition_category,outcome,source,medium,campaign,referrer_domain,legacy_source,mcp_method,mcp_tool,mcp_client,country_code);

create or replace function public.record_analytics_event(payload jsonb) returns boolean
language plpgsql security invoker set search_path=public as $$
begin
 if not public.worker_secret_valid() then raise insufficient_privilege; end if;
 insert into public.analytics_events(event_id,traffic_type,event_name,session_id,route,transport,actor_category,actor_evidence,bot_verified,acquisition_category,acquisition,acquisition_evidence,status,outcome,legacy_source,mcp_method,mcp_tool,mcp_client,country_code)
 values ((payload->>'event_id')::uuid,payload->>'traffic_type',payload->>'event_name',nullif(payload->>'session_id','')::uuid,payload->>'route',payload->>'transport',payload->>'actor_category',payload->>'actor_evidence',coalesce((payload->>'bot_verified')::boolean,false),payload->>'acquisition_category',coalesce(payload->'acquisition','{}'::jsonb),payload->>'acquisition_evidence',(payload->>'status')::integer,payload->>'outcome',payload->>'legacy_source',payload->>'mcp_method',payload->>'mcp_tool',payload->>'mcp_client',case when payload->>'country_code' ~ '^[A-Z]{2}$' then payload->>'country_code' else 'ZZ' end)
 on conflict (event_id) do nothing;
 return true;
end $$;
revoke all on function public.record_analytics_event(jsonb) from public,anon,authenticated;
grant execute on function public.record_analytics_event(jsonb) to anon;

create or replace function public.maintain_analytics() returns void
language plpgsql security invoker set search_path=public as $$
begin
 insert into public.analytics_daily(day,traffic_type,route,status,event_name,transport,actor_category,actor_evidence,bot_verified,acquisition_category,outcome,source,medium,campaign,referrer_domain,legacy_source,mcp_method,mcp_tool,mcp_client,country_code,events,tab_sessions)
 select (occurred_at at time zone 'UTC')::date,traffic_type,route,coalesce(status,0),event_name,transport,actor_category,actor_evidence,bot_verified,acquisition_category,coalesce(outcome,'unknown'),coalesce(acquisition->>'source',''),coalesce(acquisition->>'medium',''),coalesce(acquisition->>'campaign',''),coalesce(acquisition->>'referrer_domain',''),coalesce(legacy_source,''),coalesce(mcp_method,''),coalesce(mcp_tool,''),coalesce(mcp_client,''),country_code,count(*),count(distinct session_id)
 from public.analytics_events
 where occurred_at < (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')
 group by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20
 on conflict(day,traffic_type,route,status,event_name,transport,actor_category,actor_evidence,bot_verified,acquisition_category,outcome,source,medium,campaign,referrer_domain,legacy_source,mcp_method,mcp_tool,mcp_client,country_code)
 do update set events=excluded.events,tab_sessions=excluded.tab_sessions;
 delete from public.analytics_events where occurred_at < (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - interval '90 days';
 delete from public.analytics_rate_buckets where window_start < now()-interval '1 day';
 delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='share-html-analytics-maintenance') and end_time < now()-interval '14 days';
 delete from public.analytics_daily where day < (now() at time zone 'UTC')::date - 730;
end $$;
revoke all on function public.maintain_analytics() from public,anon,authenticated;
