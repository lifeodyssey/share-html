-- Additive analytics: application data and existing share_events are unchanged.
create table public.analytics_events (
 event_id uuid primary key, occurred_at timestamptz not null default now(),
 traffic_type text not null check (traffic_type in ('production','internal')),
 event_name text not null check (event_name in ('page_view','upload_started','upload_failed','share_link_copied','share_created','share_create_failed','discovery_read','preview_served','mcp_initialize','mcp_request')),
 session_id uuid, route text not null check (length(route)<=128),
 transport text not null check (transport in ('browser','http_api','mcp')),
 actor_category text not null check (actor_category in ('human_likely','browser_unknown','ai_search','ai_training','ai_user_fetch','automation','unknown','verified_bot')),
 bot_verified boolean not null default false,
 actor_evidence text not null check (actor_evidence in ('cloudflare_verified','ua_self_reported','unknown')),
 acquisition_category text not null check (acquisition_category in ('google','ai_referral','direct_or_unknown','tagged')),
 acquisition jsonb not null default '{}' check (octet_length(acquisition::text)<=1024),
 acquisition_evidence text not null check (acquisition_evidence in ('client_self_reported','referer_self_reported')),
 status integer, outcome text check (outcome in ('success','failure','blocked')),
 legacy_source text check (legacy_source ~ '^[a-z0-9_-]{1,64}$'),
 mcp_method text check (mcp_method in ('initialize','tools/list','tools/call','other')),
 mcp_tool text check (mcp_tool in ('create_share','get_public_share','describe_share_html','other')),
 mcp_client text check (mcp_client in ('claude','codex','cursor','chatgpt','other','unknown'))
);
create index analytics_events_time on public.analytics_events(occurred_at);
create index analytics_events_session_time on public.analytics_events(session_id, occurred_at) where session_id is not null;
create table public.analytics_rate_buckets (
 bucket text not null, window_start timestamptz not null, requests integer not null,
 primary key(bucket, window_start)
);
create table public.analytics_daily (
 day date not null, traffic_type text not null, route text not null, status integer not null, event_name text not null, transport text not null,
 actor_category text not null, actor_evidence text not null, bot_verified boolean not null, acquisition_category text not null,
 outcome text not null, source text not null, medium text not null, campaign text not null, referrer_domain text not null,
 legacy_source text not null, mcp_method text not null, mcp_tool text not null, mcp_client text not null,
 events bigint not null, tab_sessions bigint not null,
 primary key(day,traffic_type,route,status,event_name,transport,actor_category,actor_evidence,bot_verified,acquisition_category,outcome,source,medium,campaign,referrer_domain,legacy_source,mcp_method,mcp_tool,mcp_client)
);
alter table public.analytics_events enable row level security;
alter table public.analytics_rate_buckets enable row level security;
alter table public.analytics_daily enable row level security;
revoke all on public.analytics_events, public.analytics_rate_buckets, public.analytics_daily from public, anon, authenticated;
grant select, insert on public.analytics_events to anon;
grant select, insert, update on public.analytics_rate_buckets to anon;
grant select on public.analytics_daily to anon;
create policy analytics_events_worker on public.analytics_events to anon using (public.worker_secret_valid()) with check (public.worker_secret_valid());
create policy analytics_rate_worker on public.analytics_rate_buckets to anon using (public.worker_secret_valid()) with check (public.worker_secret_valid());
create policy analytics_daily_worker on public.analytics_daily for select to anon using (public.worker_secret_valid());

create function public.record_analytics_event(payload jsonb) returns boolean
language plpgsql security invoker set search_path=public as $$
begin
 if not public.worker_secret_valid() then raise insufficient_privilege; end if;
 insert into public.analytics_events(event_id,traffic_type,event_name,session_id,route,transport,actor_category,actor_evidence,bot_verified,acquisition_category,acquisition,acquisition_evidence,status,outcome,legacy_source,mcp_method,mcp_tool,mcp_client)
 values ((payload->>'event_id')::uuid,payload->>'traffic_type',payload->>'event_name',nullif(payload->>'session_id','')::uuid,payload->>'route',payload->>'transport',payload->>'actor_category',payload->>'actor_evidence',coalesce((payload->>'bot_verified')::boolean,false),payload->>'acquisition_category',coalesce(payload->'acquisition','{}'::jsonb),payload->>'acquisition_evidence',(payload->>'status')::integer,payload->>'outcome',payload->>'legacy_source',payload->>'mcp_method',payload->>'mcp_tool',payload->>'mcp_client')
 on conflict (event_id) do nothing;
 return true;
end $$;
revoke all on function public.record_analytics_event(jsonb) from public,anon,authenticated;
grant execute on function public.record_analytics_event(jsonb) to anon;

create function public.ingest_browser_analytics(payload jsonb, abuse_key text) returns boolean
language plpgsql security invoker set search_path=public as $$
declare current_window timestamptz := date_trunc('minute',now()); count_ip integer; count_session integer;
begin
 if not public.worker_secret_valid() then raise insufficient_privilege; end if;
 if abuse_key !~ '^[0-9a-f]{64}$' or payload->>'transport' <> 'browser' or payload->>'event_name' not in ('page_view','upload_started','upload_failed','share_link_copied') then raise invalid_parameter_value; end if;
 -- Atomic upserts serialize concurrent calls across all Worker isolates.
 insert into public.analytics_rate_buckets values ('ip:'||abuse_key,current_window,1)
 on conflict(bucket,window_start) do update set requests=analytics_rate_buckets.requests+1 returning requests into count_ip;
 if count_ip>120 then return false; end if;
 insert into public.analytics_rate_buckets values ('session:'||(payload->>'session_id'),current_window,1)
 on conflict(bucket,window_start) do update set requests=analytics_rate_buckets.requests+1 returning requests into count_session;
 if count_session>30 then return false; end if;
 return public.record_analytics_event(payload);
end $$;
revoke all on function public.ingest_browser_analytics(jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_browser_analytics(jsonb,text) to anon;

-- Maintenance remains owner-only, never callable using the public/worker REST key.
create function public.maintain_analytics() returns void
language plpgsql security invoker set search_path=public as $$
begin
 insert into public.analytics_daily
 select (occurred_at at time zone 'UTC')::date,traffic_type,route,coalesce(status,0),event_name,transport,actor_category,actor_evidence,bot_verified,acquisition_category,coalesce(outcome,'unknown'),coalesce(acquisition->>'source',''),coalesce(acquisition->>'medium',''),coalesce(acquisition->>'campaign',''),coalesce(acquisition->>'referrer_domain',''),coalesce(legacy_source,''),coalesce(mcp_method,''),coalesce(mcp_tool,''),coalesce(mcp_client,''),count(*),count(distinct session_id)
 from public.analytics_events
 where occurred_at < (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')
 group by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19
 on conflict(day,traffic_type,route,status,event_name,transport,actor_category,actor_evidence,bot_verified,acquisition_category,outcome,source,medium,campaign,referrer_domain,legacy_source,mcp_method,mcp_tool,mcp_client)
 do update set events=excluded.events,tab_sessions=excluded.tab_sessions;
 delete from public.analytics_events where occurred_at < (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - interval '90 days';
 delete from public.analytics_rate_buckets where window_start < now()-interval '1 day';
 delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='share-html-analytics-maintenance') and end_time < now()-interval '14 days';
 delete from public.analytics_daily where day < (now() at time zone 'UTC')::date - 730;
end $$;
revoke all on function public.maintain_analytics() from public,anon,authenticated;
create extension if not exists pg_cron;
select cron.schedule('share-html-analytics-maintenance','17 2 * * *','select public.maintain_analytics()');
