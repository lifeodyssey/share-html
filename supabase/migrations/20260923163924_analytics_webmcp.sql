-- Optional consented browser WebMCP observations; self-reported, not agent identity.
-- Existing RLS, grants, rate limits and retention remain unchanged.
alter table public.analytics_events drop constraint analytics_events_event_name_check;
alter table public.analytics_events add constraint analytics_events_event_name_check check(event_name in (
 'page_view','upload_started','upload_failed','share_link_copied','share_created','share_create_failed',
 'discovery_read','preview_served','mcp_initialize','mcp_request','page_served',
 'webmcp_available','webmcp_registered','webmcp_call','webmcp_result'
));
alter table public.analytics_events drop constraint analytics_events_transport_check;
alter table public.analytics_events add constraint analytics_events_transport_check check(transport in ('browser','http_api','mcp','webmcp'));
alter table public.analytics_events drop constraint analytics_events_mcp_tool_check;
alter table public.analytics_events add constraint analytics_events_mcp_tool_check check(mcp_tool in ('create_share','get_public_share','describe_share_html','access_private_share','other'));

create or replace function public.ingest_browser_analytics(payload jsonb, abuse_key text) returns boolean
language plpgsql security invoker set search_path=public as $$
declare current_window timestamptz := date_trunc('minute',now()); count_ip integer; count_session integer;
begin
 if not public.worker_secret_valid() then raise insufficient_privilege; end if;
 if coalesce(abuse_key,'') !~ '^[0-9a-f]{64}$' or coalesce(payload->>'session_id','') = '' then raise invalid_parameter_value; end if;
 if not coalesce(
   (payload->>'transport'='browser' and payload->>'event_name' in ('page_view','upload_started','upload_failed','share_link_copied'))
   or (payload->>'transport'='webmcp' and payload->>'legacy_source'='webmcp' and payload->>'mcp_method' is null and payload->>'mcp_client' is null and (
     (payload->>'event_name' in ('webmcp_available','webmcp_registered') and payload->>'mcp_tool' is null and payload->>'outcome' in ('success','failure'))
     or (payload->>'event_name' in ('webmcp_call','webmcp_result') and payload->>'mcp_tool' in ('create_share','get_public_share','describe_share_html','access_private_share') and (
       (payload->>'event_name'='webmcp_call' and payload->>'outcome' is null)
       or (payload->>'event_name'='webmcp_result' and payload->>'outcome' in ('success','failure'))
     ))
   )), false) then raise invalid_parameter_value; end if;
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

