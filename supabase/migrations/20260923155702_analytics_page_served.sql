-- Count successful first-party page responses independently of optional browser events.
alter table public.analytics_events
  drop constraint analytics_events_event_name_check;
alter table public.analytics_events
  add constraint analytics_events_event_name_check
  check (event_name in (
    'page_view', 'upload_started', 'upload_failed', 'share_link_copied',
    'share_created', 'share_create_failed', 'discovery_read', 'preview_served',
    'mcp_initialize', 'mcp_request', 'page_served'
  ));
