#!/usr/bin/env python3
"""Render the static, privacy-safe /report/0923 page from aggregate JSON."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = Path(__file__).with_name("usage-report.template.html")
DEFAULT_INPUT = Path("/tmp/sharehtml-0923/report-aggregates.json")
DEFAULT_TRAFFIC_INPUT = Path("/tmp/sharehtml-0923/traffic-aggregates.json")
DEFAULT_USAGE_TIME_INPUT = Path("/tmp/sharehtml-0923/usage-time-analysis.json")
DEFAULT_USAGE_MATURITY_INPUT = Path("/tmp/sharehtml-0923/usage-maturity-analysis.json")
DEFAULT_IMPACT_INPUT = Path("/tmp/sharehtml-0923/impact-analysis.json")
DEFAULT_RELEASE_INPUT = Path("/tmp/sharehtml-0923/release-evidence.json")
DEFAULT_ACQUISITION_INPUT = Path("/tmp/sharehtml-0923/acquisition-platform-findings.json")
DEFAULT_CONTENT_VALUE_INPUT = Path("/tmp/sharehtml-0923/content-value-findings.json")
DEFAULT_SITE_TRAFFIC_INPUT = Path("/tmp/sharehtml-0923/site-traffic-analysis.json")
DEFAULT_OUTPUT = ROOT / "public/report/0923/index.html"
ALLOWED_CRAWLER_LABELS = {
    "Claude-SearchBot", "OAI-SearchBot", "ClaudeBot", "WebMCPIndexBot",
    "Googlebot", "Bingbot", "ChatGPT-User", "GPTBot", "PerplexityBot",
    "DeepSeekBot", "xAI-SearchBot", "Amazonbot", "CCBot", "Baiduspider",
    "YandexBot", "Applebot", "MCP-Cloud-AboutBot", "Google-CloudVertexBot",
}

# These are broad paraphrases of manually inspected public examples. They must
# never contain original titles, slugs, links, identifiers, or long excerpts.
ANONYMIZED_EXAMPLES = [
    {"label": "研究与决策简报。", "description": "把结论、证据表格、来源链接与图表压进一个可直接转发的单页，降低读者进入长报告的成本。"},
    {"label": "互动游戏与故事。", "description": "公开样本里可见触屏操作、得分或回合反馈，也有需要连续阅读和选择的互动叙事；作者身份无法由作品推知。"},
    {"label": "学习与练习材料。", "description": "课程说明、数学练习、复习题与即时反馈会出现在同一页面，适合让读者边读边操作。"},
    {"label": "业务计算与记录工具。", "description": "从多条件报价、计算器到日常记录页面，输入后整理结果，便于在不同设备间打开。"},
    {"label": "个人祝福与表达。", "description": "样本中有生日祝福、道歉或心意表达的互动页面，说明分享物也承担个人沟通用途。"},
    {"label": "产品介绍与操作指南。", "description": "服务说明、活动预览、公司规范或使用指南被整理成带导航的网页材料；这不等同于正式线上产品。"},
]


def public_projection(source: dict) -> dict:
    result = copy.deepcopy(source)
    result["artifact_classification"].pop("rule_set", None)
    result["artifact_classification"]["anonymized_examples"] = ANONYMIZED_EXAMPLES
    result["artifact_fetch"].pop("raw_directory", None)
    edge = result.get("edge_traffic")
    if edge:
        edge.pop("top_named_user_agents", None)
        edge.pop("user_agent_samples", None)
        edge.pop("raw_user_agents", None)
    artifact_fetch = result.get("artifact_fetch")
    if artifact_fetch:
        artifact_fetch.pop("raw_directory", None)
        artifact_fetch.pop("user_agent", None)
        artifact_fetch.pop("downloaded_bytes", None)
    if "edge_country" in result:
        result["edge_country"] = project_edge_country(result["edge_country"])
    forbidden = {"slug", "content_hash", "ip_group", "ua_group", "user_id", "owner_user_id", "share_id", "full_html", "title"}
    def inspect(value, path="$"):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.lower() in forbidden:
                    raise ValueError(f"Sensitive field in public aggregate: {path}.{key}")
                inspect(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                inspect(child, f"{path}[{index}]")
    inspect(result)
    if result["population"]["records"] != 2797:
        raise ValueError("Unexpected public report population")
    validate_aggregates(result)
    return result


def read_json_if_present(path: Path | None) -> dict | None:
    if path is None or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected an aggregate JSON object at {path}")
    return value


def safe_source(value: str | None) -> str:
    if value in {"api", "mcp", "direct"}:
        return value
    if value in {"unknown", "(missing)", "(null)", None, ""}:
        return "unknown"
    return "other"


def project_usage_time(raw: dict, cutoff: str) -> dict:
    """Project timestamped application events without share-level keys."""
    if raw.get("cohort_records") != 2797 or raw.get("cohort_views") != 14939:
        raise ValueError("Unexpected timestamped-event cohort totals")
    event_types = {"created", "viewed", "reported", "access_granted"}
    by_day: dict[str, dict[str, int]] = {}
    totals = {key: 0 for key in event_types}
    for row in raw.get("daily_events", []):
        kind = row.get("event_type")
        if kind not in event_types:
            raise ValueError(f"Unexpected share event type: {kind}")
        day = str(row["day"])
        item = by_day.setdefault(day, {key: 0 for key in event_types})
        item[kind] += int(row["events"])
        totals[kind] += int(row["events"])
    if totals != {"created": 2786, "viewed": 14969, "reported": 4, "access_granted": 20}:
        raise ValueError(f"Timestamped event totals changed: {totals}")
    days = sorted(by_day)
    if not days or days[0] != "2026-07-01" or days[-1] != cutoff[:10]:
        raise ValueError("Timestamped event date coverage changed")
    import datetime
    first = datetime.date.fromisoformat(days[0])
    last = datetime.date.fromisoformat(days[-1])
    daily = []
    for offset in range((last - first).days + 1):
        day = (first + datetime.timedelta(days=offset)).isoformat()
        counts = by_day.get(day, {key: 0 for key in event_types})
        daily.append({
            "date": day,
            "created": counts["created"],
            "viewed": counts["viewed"],
            "reported": counts["reported"],
            "access_granted": counts["access_granted"],
            "partial_day": day == cutoff[:10],
        })
    delay_labels = {"none", "under_1m", "1m_to_1h", "1h_to_24h", "1d_to_7d"}
    delay_rows = raw.get("first_request_delay", [])
    first_delay = [{"bucket": row["bucket"], "records": int(row["records"])} for row in delay_rows]
    if any(row["bucket"] not in delay_labels for row in first_delay):
        raise ValueError("Unexpected first-request delay bucket")
    if sum(row["records"] for row in first_delay) != 2797:
        raise ValueError("First-request delay distribution does not reconcile")
    followup_fields = (
        "records", "content_requests", "with_requests", "eligible_24h", "requested_within_24h",
        "eligible_7d", "requested_within_7d", "eligible_for_day8", "requested_after_7d",
        "requested_on_multiple_dates",
    )
    followup = []
    for row in raw.get("cohort_followup", []):
        followup.append({
            "month": str(row["month"]), "source": safe_source(row.get("source")),
            **{key: int(row.get(key, 0)) for key in followup_fields},
        })
    if sum(row["records"] for row in followup) != 2797:
        raise ValueError("Follow-up cohorts do not reconcile to the frozen snapshot")
    return {
        "timezone": "Asia/Taipei",
        "start": "2026-07-01",
        "cutoff": cutoff,
        "totals": totals,
        "daily_events": daily,
        "first_request_delay": first_delay,
        "cohort_followup": followup,
        "note": "Timestamped share_events are event counts, not people; viewed includes embedded and direct document requests.",
    }


def project_usage_maturity(raw: dict) -> dict:
    fields = ("eligible_7d", "requested_days2to7", "requested_multiple_dates_in7d", "eligible_14d", "requested_days8to14")
    rows = []
    for row in raw.get("mature_cohorts", []):
        rows.append({"month": str(row["month"]), "source": safe_source(row.get("source")), **{key: int(row.get(key, 0)) for key in fields}})
    concentration = raw.get("concentration", {})
    expected = {"requests": 14939, "largest_record_requests": 1723, "top5_requests": 5842, "top10_requests": 6351, "top28_requests": 7385}
    if {key: int(concentration.get(key, -1)) for key in expected} != expected:
        raise ValueError("Content-request concentration totals changed")
    request_age = [{"bucket": str(row["bucket"]), "requests": int(row["requests"])} for row in raw.get("request_age", [])]
    if sum(row["requests"] for row in request_age) != 14939:
        raise ValueError("Request-age distribution does not reconcile")
    return {"mature_cohorts": rows, "concentration": expected, "request_age": request_age}


def project_impact(raw: dict) -> dict:
    """Allowlist impact summaries and discard all grouping identities."""
    windows = raw.get("before_after_july19", {}).get("windows", [])
    projected_windows = []
    for row in windows:
        classes = row.get("edge_classes", {})
        projected_windows.append({
            "from": str(row["from"]), "to": str(row["to"]), "calendar_days": int(row["calendar_days"]),
            "creation_records": int(row["creation_records"]), "creation_timezone": str(row["creation_timezone"]),
            "source_labeled_records": int(row["source_labeled_records"]),
            "edge_timezone": str(row["edge_timezone"]), "edge_days_observed": int(row["edge_days_observed"]),
            "edge_base_observations": int(row["edge_base_observations"]),
            "edge_classes": {key: int(classes.get(key, 0)) for key in ("human", "unverified_bot", "verified_bot")},
            "ai_subset_overlapping": int(row.get("edge_ai_subset_overlapping", 0)),
        })
    if len(projected_windows) != 2 or [row["creation_records"] for row in projected_windows] != [25, 5]:
        raise ValueError("July 19 paired-window comparison changed")
    equal = raw.get("aug_sep_equal_window", {})
    source_delta = []
    source_labels = {"api": "api", "mcp": "mcp", "direct": "direct"}
    combined_other = {"delta": 0, "august": 0, "september": 0}
    for row in equal.get("sources", []):
        key = row.get("source")
        if key in source_labels:
            source_delta.append({"source": source_labels[key], "august": int(row["august"]), "september": int(row["september"]), "delta": int(row["delta"])})
        else:
            for field in combined_other:
                combined_other[field] += int(row.get(field, 0))
    source_delta.append({"source": "other", **combined_other})
    if int(equal.get("net_additional_records", 0)) != 1628 or sum(row["delta"] for row in source_delta) != 1628:
        raise ValueError("Equal-window source changes do not reconcile")
    outcomes = []
    for row in raw.get("source_outcomes", []):
        if row.get("source") not in {"api", "mcp", "direct"}:
            continue
        outcomes.append({
            "source": row["source"], "records": int(row["records"]),
            "active_public_records": int(row["active_public_records"]),
            "with_content_requests": int(row["with_content_requests"]),
            "content_requests": int(row["content_requests"]),
            "rate": float(row["with_content_requests_rate"]),
        })
    group_concentration = []
    for row in raw.get("growth_group_concentration", []):
        if row.get("source") not in {"all", "api", "mcp"}:
            continue
        field = row.get("field")
        if field not in {"ip_group", "ua_group"}:
            raise ValueError("Unexpected grouping field in aggregate")
        group_concentration.append({
            "source": row["source"],
            "group_kind": "network_group" if field == "ip_group" else "client_characteristic_group",
            "august_records": int(row["aug_records"]), "september_records": int(row["sep_records"]),
            "september_largest_group_records": int(row["sep_largest_group_records"]),
            "september_top5_group_records": int(row["sep_top5_group_records"]),
        })
    matched = []
    for row in raw.get("matched_active_public_outcomes", []):
        purposes = {}
        for purpose, metrics in row.get("purposes", {}).items():
            purposes[str(purpose)] = {
                "records": int(metrics.get("records", 0)),
                "with_content_requests": int(metrics.get("with_content_requests", 0)),
                "content_requests": int(metrics.get("content_requests", 0)),
            }
        matched.append({
            "month": str(row["month"]), "source": safe_source(row.get("source")),
            "active_public_records": int(row["active_public_records"]),
            "with_content_requests": int(row["with_content_requests"]),
            "content_requests": int(row["content_requests"]), "purposes": purposes,
        })
    edge_windows = raw.get("edge_aug_sep_equal22", {}).get("windows", [])
    projected_edge_windows = [{
        "from": row["from"], "to": row["to"], "calendar_days": int(row["calendar_days"]),
        "edge_timezone": str(row["edge_timezone"]), "edge_days_observed": int(row["edge_days_observed"]),
        "edge_base_observations": int(row["edge_base_observations"]),
        "edge_classes": {key: int(row.get("edge_classes", {}).get(key, 0)) for key in ("human", "unverified_bot", "verified_bot")},
        "ai_subset_overlapping": int(row.get("edge_ai_subset_overlapping", 0)),
    } for row in edge_windows]
    return {
        "snapshot_cutoff": str(raw["snapshot_cutoff"]),
        "before_after_july19": projected_windows,
        "aug_sep_equal_window": {"august_records": 410, "september_records": 2038, "net_additional_records": 1628, "ratio": float(equal["ratio"]), "sources": source_delta},
        "source_outcomes": outcomes,
        "group_concentration": group_concentration,
        "matched_active_public_outcomes": matched,
        "edge_aug_sep_equal22": projected_edge_windows,
    }


def project_content_value(raw: dict) -> dict:
    top = raw.get("top5", {})
    if int(top.get("links", 0)) != 5 or int(top.get("content_requests", 0)) != 5842 or int(top.get("cohort_content_requests", 0)) != 14939:
        raise ValueError("Top-five artifact summary changed")
    cases = [{"broad_use": str(row["broad_use"]), "language": str(row["content_language"])} for row in top.get("anonymous_cases", [])]
    if len(cases) != 5:
        raise ValueError("Top-five anonymous case review is incomplete")
    categories = []
    for row in raw.get("active_public_by_parser_category", []):
        if row.get("category") not in {"学习与教学", "游戏与互动叙事", "报告与研究"}:
            continue
        categories.append({
            "category": str(row["category"]), "links": int(row["links"]),
            "requested_links": int(row["requested_links"]), "rate": float(row["requested_link_rate"]),
            "unique_contents": int(row["unique_contents"]),
        })
    return {"top5": {"links": 5, "unique_contents": 5, "content_requests": 5842, "cohort_content_requests": 14939, "request_share": float(top["request_share"]), "parser_unclassified_links": int(top["parser_unclassified_links"]), "anonymous_cases": cases}, "purpose_outcomes": categories, "selection": "Frozen top five by cumulative content requests; purposive case review, not a representative sample."}


def project_acquisition(raw: dict) -> dict:
    final = raw.get("final_report_extract")
    if not final or final.get("status") != "verified_read_only_platform_query":
        raise ValueError("Frozen acquisition/RUM extract is missing")
    categories = {"home", "marketing", "share_wrapper", "content"}
    monthly = []
    for row in final.get("summaries", []):
        if row.get("category") not in categories:
            continue
        monthly.append({
            "month": str(row["month"]), "category": row["category"],
            "estimated_pageloads": int(row["estimated_pageloads"]),
            "estimated_visits": int(row["estimated_visits"]),
            "sample_interval": max([int(n) for n in row.get("sample_intervals", [])] or [0]),
            "has_sampled_rows": bool(row.get("returned_groups", 0)),
        })
    # Use only the combined page-category rows to create the full-window referrer summary.
    allowed_referrers = {"": "unattributed_or_unknown", "l.instagram.com": "instagram", "com.google.android.gm": "gmail_app", "sharehtml.zhenjia.dev": "internal"}
    referrers = []
    for row in final.get("aggregates", []):
        if row.get("category") != "all":
            continue
        host = str(row.get("referrer_host", ""))
        if host not in allowed_referrers:
            raise ValueError("Unapproved referrer host in report input")
        referrers.append({
            "month": str(row["month"]), "source": allowed_referrers[host],
            "estimated_pageloads": int(row["estimated_pageloads"]),
            "estimated_visits": int(row["estimated_visits"]),
            "sample_interval": int(row["sample_interval"]),
            "cloudflare_bot_flag": int(row["cloudflare_bot_flag"]),
        })
    page_totals = {"estimated_pageloads": 0, "estimated_visits": 0}
    for row in monthly:
        if row["month"] not in {"2026-08", "2026-09"}:
            continue
        for key in page_totals:
            page_totals[key] += row[key]
    if page_totals != {"estimated_pageloads": 580, "estimated_visits": 550}:
        raise ValueError(f"Frozen RUM page totals changed: {page_totals}")
    source_totals = {"estimated_pageloads": 0, "estimated_visits": 0}
    for row in referrers:
        for key in source_totals:
            source_totals[key] += row[key]
    if source_totals != page_totals:
        raise ValueError("RUM referrer estimates do not reconcile to page-category estimates")
    bot_flag_visits = {
        flag: sum(row["estimated_visits"] for row in referrers if row["cloudflare_bot_flag"] == flag)
        for flag in (0, 1)
    }
    if bot_flag_visits != {0: 380, 1: 170}:
        raise ValueError(f"RUM bot-flag visit estimates changed: {bot_flag_visits}")
    return {
        "from": str(final["start_inclusive"]), "to_exclusive": str(final["end_exclusive"]),
        "timezone": str(final["timezone"]), "page_monthly": monthly, "referrers": referrers,
        "totals": page_totals,
        "visits_by_cloudflare_bot_flag": {str(key): value for key, value in bot_flag_visits.items()},
        "note": "Sampled Cloudflare RUM estimates with interval 10; estimates are not people and must not be multiplied again. Blank referrer means direct-or-unknown, not proven direct acquisition.",
    }


def project_site_traffic(raw: dict) -> dict:
    allowed_scopes = {"homepage", "product_pages", "share_wrapper", "html_content", "discovery_files", "mcp_endpoint", "service_api"}
    by_scope = {key: int(value) for key, value in raw.get("by_scope", {}).items() if key in allowed_scopes}
    monthly = []
    for month, scopes in sorted(raw.get("monthly_by_scope", {}).items()):
        monthly.append({"month": str(month), **{key: int(value) for key, value in scopes.items() if key in allowed_scopes}})
    if int(raw.get("total_stored_path_observations", -1)) != 60713 or int(raw.get("observed_days", -1)) != 111:
        raise ValueError("Stored main-host path sample has changed")
    return {"from": str(raw["from"]), "to": str(raw["to"]), "timezone": str(raw["timezone"]), "observed_days": int(raw["observed_days"]), "total_stored_path_observations": int(raw["total_stored_path_observations"]), "by_scope": by_scope, "monthly_by_scope": monthly, "coverage": str(raw.get("coverage", ""))}


def project_release_evidence(raw: dict, milestones: list[dict]) -> list[dict]:
    """Join curated milestone hashes locally, then export only dates and evidence class."""
    commits = raw.get("commits", [])
    result = []
    for milestone in milestones:
        if milestone.get("type") != "code_change":
            continue
        prefix = str(milestone.get("commit", ""))
        match = next((row for row in commits if prefix and str(row.get("sha", "")).startswith(prefix)), None)
        evidence = match.get("production_evidence", {}) if match else {}
        item = {"key": str(milestone["key"]), "code_at": str(milestone["at"]), "production_build_at": None, "exact_deployment_at": None, "evidence_kind": "not_recovered"}
        if evidence:
            item["production_build_at"] = evidence.get("build_success_at")
            item["exact_deployment_at"] = evidence.get("deployment_created_on")
            item["evidence_kind"] = str(evidence.get("evidence_kind", "not_recovered"))
        if item["key"] in {"seo_discovery_metadata", "readonly_webmcp_remote_mcp", "sitemap_homepage_only"}:
            inherited = raw.get("may26_inherited_evidence", {})
            item["production_build_at"] = inherited.get("production_build_success_at")
            item["evidence_kind"] = "ancestor_in_successful_production_build"
        result.append(item)
    return result


def assert_public_data_safe(data: dict) -> None:
    forbidden = {"slug", "content_hash", "ip_group", "ua_group", "user_id", "owner_user_id", "share_id", "full_html", "title", "details_url", "version_id", "deployment_id", "sha"}
    def inspect(value, path="$"):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.lower() in forbidden:
                    raise ValueError(f"Sensitive field in public aggregate: {path}.{key}")
                inspect(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                inspect(child, f"{path}[{index}]")
    inspect(data)


def add_research_inputs(data: dict, args: argparse.Namespace) -> None:
    """Attach strict aggregate-only projections from separate frozen analyses."""
    usage = read_json_if_present(args.usage_time_input)
    maturity = read_json_if_present(args.usage_maturity_input)
    impact = read_json_if_present(args.impact_input)
    acquisition = read_json_if_present(args.acquisition_input)
    content_value = read_json_if_present(args.content_value_input)
    site_traffic = read_json_if_present(args.site_traffic_input)
    release = read_json_if_present(args.release_input)
    cutoff = data["report_charts"]["snapshot_outcome_funnel"].get("cutoff", "2026-09-23T15:27:28.147672Z")
    if usage:
        data["usage_time"] = project_usage_time(usage, cutoff)
    if maturity:
        data["usage_maturity"] = project_usage_maturity(maturity)
    if impact:
        data["impact_findings"] = project_impact(impact)
    if content_value:
        data["content_value"] = project_content_value(content_value)
    if acquisition:
        data["acquisition_rum"] = project_acquisition(acquisition)
    if site_traffic:
        data["site_traffic_sample"] = project_site_traffic(site_traffic)
    if release:
        milestones = data.get("report_charts", {}).get("milestones", [])
        data["release_evidence"] = project_release_evidence(release, milestones)
        for row in milestones:
            row.pop("commit", None)
    assert_public_data_safe(data)


def project_country_rows(rows: list[dict]) -> list[dict]:
    allowed_classes = ("human", "unverified_bot", "verified_bot")
    projected = []
    for row in rows:
        projected.append({
            "country": str(row["country"]),
            "base_observations": int(row["base_observations"]),
            "classes": {key: int(row.get("classes", {}).get(key, 0)) for key in allowed_classes},
            "ai_subset_overlapping": int(row.get("ai_subset_overlapping", 0)),
        })
    return sorted(projected, key=lambda row: (-row["base_observations"], row["country"]))


def project_edge_country(source: dict) -> dict:
    """Retain only country-level aggregate counts; never project request identifiers."""
    return {
        "from": source["from"],
        "to": source["to"],
        "timezone": source["timezone"],
        "base_observations": int(source["base_observations"]),
        "ai_subset_overlapping": int(source.get("ai_subset_overlapping", 0)),
        "known_country_code_count": int(source.get("known_country_code_count", max(0, len(source["countries"]) - 1))),
        "countries": project_country_rows(source["countries"]),
        "monthly": {
            month: {
                "base_observations": int(value["base_observations"]),
                "ai_subset_overlapping": int(value.get("ai_subset_overlapping", 0)),
                "countries": project_country_rows(value["countries"]),
            }
            for month, value in sorted(source["monthly"].items())
        },
        "note": source.get("note", "Country estimates describe request egress, not people."),
    }


def validate_aggregates(data: dict) -> None:
    """Fail closed if counts or the joint-flow population drift from the report scope."""
    population = data["population"]["records"]
    if sum(row["records"] for row in data["monthly"].values()) != population:
        raise ValueError("Monthly record counts do not reconcile to the snapshot")
    if sum(row["records"] for row in data["daily"]) != population:
        raise ValueError("Daily record counts do not reconcile to the snapshot")
    if [row["records"] for row in data["equal_23_day_windows"]] != [30, 410, 2038]:
        raise ValueError("Equal-window counts changed; update report claims")
    fetched = data["artifact_fetch"]
    if fetched["unique_active_public_targets"] != 2453 or fetched["status_counts"].get("ok") != 2453:
        raise ValueError("Public HTML retrieval coverage changed")
    classification = data["artifact_classification"]
    if sum(classification["by_category_unique"].values()) != 2453:
        raise ValueError("Unique artifact classifications do not reconcile")
    views = data["views_asof_snapshot"]
    if sum(views["distribution"].values()) != population or views["requests"] != 14939:
        raise ValueError("Content-request distribution does not reconcile")
    flow = data["report_charts"]["source_purpose_preview_flow"]
    if flow["population"] != 2640 or sum(path["records"] for path in flow["paths"]) != flow["population"]:
        raise ValueError("Source-purpose-content-request flow does not reconcile")
    if data["report_charts"]["snapshot_outcome_funnel"]["stages"] != [
        {"key": "created_records", "records": 2797},
        {"key": "active_at_cutoff", "records": 2778},
        {"key": "active_with_preview_at_cutoff", "records": 1367},
    ]:
        raise ValueError("Snapshot state stages changed; review funnel labels")
    edge = data["edge_traffic"]
    if edge["base_observations"] != 70340 or edge["host_days_with_data"] != 111:
        raise ValueError("Edge observation coverage changed")
    if sum(row["base_observations"] or 0 for row in data["report_charts"]["edge_daily"]) != edge["base_observations"]:
        raise ValueError("Daily edge observations do not reconcile")
    if [row["date"] for row in data["report_charts"]["edge_daily"] if row["base_observations"] is None] != ["2026-08-25"]:
        raise ValueError("Edge missing-day coverage changed")
    country = data.get("edge_country")
    if country:
        if country["base_observations"] != edge["base_observations"] or sum(row["base_observations"] for row in country["countries"]) != country["base_observations"]:
            raise ValueError("Country egress buckets do not reconcile to edge observations")
        if len(country["countries"]) != country["known_country_code_count"] + 1:
            raise ValueError("Country egress must contain known codes plus one unknown bucket")
        for row in country["countries"]:
            if sum(row["classes"].values()) != row["base_observations"]:
                raise ValueError(f"Country egress classes do not reconcile for {row['country']}")
        for month, summary in country["monthly"].items():
            if sum(row["base_observations"] for row in summary["countries"]) != summary["base_observations"]:
                raise ValueError(f"Country egress buckets do not reconcile for {month}")
            for row in summary["countries"]:
                if sum(row["classes"].values()) != row["base_observations"]:
                    raise ValueError(f"Country egress classes do not reconcile for {month}/{row['country']}")


def safe_crawler_labels(path: Path | None) -> list[dict]:
    """Project only an explicit allowlist of aggregate bot-name labels and counts."""
    if path is None or not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or len(raw) < 3 or not isinstance(raw[2], dict):
        raise ValueError("Unexpected traffic aggregate shape")
    rows = raw[2].get("results", [])
    safe = [
        {"name": row["bot_name"], "observations": int(row["observations"])}
        for row in rows
        if row.get("bot_name") in ALLOWED_CRAWLER_LABELS
    ]
    return sorted(safe, key=lambda row: (-row["observations"], row["name"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--traffic-input", type=Path, default=DEFAULT_TRAFFIC_INPUT)
    parser.add_argument("--usage-time-input", type=Path, default=DEFAULT_USAGE_TIME_INPUT)
    parser.add_argument("--usage-maturity-input", type=Path, default=DEFAULT_USAGE_MATURITY_INPUT)
    parser.add_argument("--impact-input", type=Path, default=DEFAULT_IMPACT_INPUT)
    parser.add_argument("--release-input", type=Path, default=DEFAULT_RELEASE_INPUT)
    parser.add_argument("--acquisition-input", type=Path, default=DEFAULT_ACQUISITION_INPUT)
    parser.add_argument("--content-value-input", type=Path, default=DEFAULT_CONTENT_VALUE_INPUT)
    parser.add_argument("--site-traffic-input", type=Path, default=DEFAULT_SITE_TRAFFIC_INPUT)
    parser.add_argument("--template", type=Path, default=TEMPLATE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    aggregates = json.loads(args.input.read_text(encoding="utf-8"))
    data = public_projection(aggregates)
    data["edge_traffic"]["claimed_bot_labels"] = safe_crawler_labels(args.traffic_input)
    add_research_inputs(data, args)
    template = args.template.read_text(encoding="utf-8")
    marker = "__REPORT_DATA__"
    if template.count(marker) != 1:
        raise ValueError("Template must contain exactly one data marker")
    embedded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = template.replace(marker, embedded)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(page, encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "population": data["population"]["records"],
        "classified_unique_documents": data["artifact_classification"]["unique_documents"],
        "fetch_status": data["artifact_fetch"]["status_counts"],
        "edge_traffic_included": bool(data.get("edge_traffic")),
        "allowlisted_crawler_labels": len(data["edge_traffic"]["claimed_bot_labels"]),
        "timestamped_events_included": bool(data.get("usage_time")),
        "acquisition_rum_included": bool(data.get("acquisition_rum")),
        "impact_analysis_included": bool(data.get("impact_findings")),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
