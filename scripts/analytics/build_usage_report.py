#!/usr/bin/env python3
"""Build privacy-preserving aggregates for the 2026-09-23 Share HTML report.

The frozen snapshot is the measurement source of truth. Optional public-preview
fetches are used only to classify artifacts; those GETs can increase live view
counters, so this script never merges them into the frozen snapshot.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html.parser
import json
import re
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_SNAPSHOT = Path("/tmp/sharehtml-0923/snapshot.json")
DEFAULT_CONTENT = Path("/tmp/sharehtml-0923/content")
DEFAULT_FETCH_LOG = Path("/tmp/sharehtml-0923/fetch-status.json")
DEFAULT_AGGREGATES = Path("/tmp/sharehtml-0923/report-aggregates.json")
DEFAULT_TRAFFIC = Path("/tmp/sharehtml-0923/traffic-aggregates.json")
DEFAULT_COUNTRY = Path("/tmp/sharehtml-0923/country-query.json")
DEFAULT_COUNTRY_MONTHLY = Path("/tmp/sharehtml-0923/country-monthly-query.json")
PREVIEW_ORIGINS = (
    "https://sharehtml.zhenjia.dev",
    "https://share-html.zhenjiazhou0127.workers.dev",
)
USER_AGENT = "ShareHTML-Research/2026-09-23 (+frozen-report-study)"

# Compact, inspectable keyword rules. Classification is a reading aid, not a
# claim that every artifact has a single purpose or that every artifact was
# semantically reviewed by a human.
CATEGORY_RULES: dict[str, tuple[str, ...]] = {
    "数据与可视化": (
        "dashboard", "data visualization", "visualization", "chart", "graph", "analytics",
        "數據", "資料視覺", "資料分析", "數據分析", "圖表", "可視化", "趨勢圖",
        "数据", "资料视觉", "资料分析", "数据分析", "图表", "可视化", "趋势图", "echarts",
        "chart.js", "plotly", "d3.js", "crypto market dashboard", "cot/usda", "速览",
    ),
    "运营状态看板": (
        "job status", "status update", "work order", "traveler no", "production status",
        "production schedule", "operations dashboard", "live dashboard",
    ),
    "报告与研究": (
        "research", "report", "whitepaper", "paper", "analysis", "briefing", "memo", "brief", "forecast",
        "investor brief", "executive summary", "investment brief", "comparative analysis",
        "研究", "報告", "論文", "分析報告", "調研", "市場分析", "复盘", "復盤",
        "报告", "论文", "分析报告", "调研", "市场分析",
    ),
    "简报与提案": (
        "slide deck", "slides", "presentation", "pitch deck", "slidev", "reveal.js",
        "簡報", "演示文稿", "投影片", "提案簡報", "简报", "提案简报", "presentation deck",
    ),
    "学习与教学": (
        "tutorial", "course", "lesson", "quiz", "flashcard", "interview prep", "resume",
        "curriculum", "study guide", "bible study", "educational resource", "handout", "prep kit",
        "recurso didáctico", "qué vamos a aprender", "curso", "aprender", "calculo mental",
        "questions de maths", "exercices", "cours", "演習", "誤答", "問題", "대화 연습", "학습장", "시험",
        "контент-план", "учебный", "обучение", "пособие", "教學", "教程", "課程", "學習", "測驗", "面試", "履歷", "簡歷",
        "職涯", "求職", "題庫", "教学", "教程", "课程", "学习", "测试", "面试", "履历", "简历",
        "职业", "求职", "题库", "学习指南", "教学资源", "教学材料",
    ),
    "作品集与个人页": (
        "portfolio", "personal website", "about me", "cv", "resume page", "作品集",
        "個人網站", "個人簡介", "個人頁", "履歷頁", "个人网站", "个人简介", "个人页", "履历页",
    ),
    "互动工具与小应用": (
        "calculator", "converter", "generator", "editor", "planner", "tracker", "builder",
        "interactive tool", "web app", "mini app", "prompt builder", "prompt generator", "character builder",
        "chat room", "food journey", "start tracking", "daily log", "progress tracker", "workout tracker",
        "blackjack advisor", "hi-lo count", "true count", "計算器", "計算機", "轉換器", "產生器", "計算",
        "レシピ", "保存", "계산기", "투찰 계산기", "контент-план", "календарь", "задачи",
        "quote", "ledger", "계산", "生成器", "工具", "小工具", "互動應用", "待辦", "排程器",
        "计算器", "计算机", "转换器", "生成器", "工具", "小工具", "互动应用", "待办", "排程器",
        "旅行指南", "美食行旅", "提示词工坊", "角色工坊", "プロンプト工房", "キャラ＆プロンプト工房",
    ),
    "活动与邀请": (
        "invitation", "wedding", "conference", "event page", "event landing", "活動頁",
        "邀請函", "邀請頁", "婚禮", "婚宴", "研討會", "活動報名", "年會", "活动页", "邀请函",
        "邀请页", "婚礼", "婚宴", "研讨会", "活动报名", "年会",
    ),
    "游戏与互动叙事": (
        "game", "quiz game", "interactive story", "visual novel", "arcade", "遊戲",
        "space blaster", "space shooter", "tic-tac-toe", "tictactoe", "swampstone",
        "catch the money", "piramida", "minecraft", "tower defense", "start game", "new game", "rematch",
        "tap to play", "jouer", "jogar", "pontos", "jogadas", "디펜스", "웨이브 시작", "게임", "gra działa", "nowa gra",
        "jump", "punch", "lives", "coins", "score", "體力", "飽腹", "体力", "饱腹", "開始遊戲", "开始游戏",
        "互動故事", "互動小說", "小遊戲", "闖關", "游戏", "互动故事", "互动小说", "小游戏", "闯关",
    ),
    "祝福与个人表达": (
        "love letter", "why i love you", "our song", "i love you", "apology message", "sorry message",
        "birthday greeting", "birthday wishes", "personal message", "anniversary", "get well soon",
        "özür mesajı", "seni seviyorum", "生日祝福", "情书", "道歉信", "表白", "送给你",
    ),
    "文章与指南": (
        "article", "guide", "how to", "how-to", "explainer", "manual", "history", "overview",
        "faq", "frequently asked questions", "recipe", "travel guide", "recurso didáctico",
        "руководство", "история", "指南", "说明", "文章", "介绍", "攻略", "使用方法", "伦理守则", "code of ethics", "הקוד האתי",
    ),
    "产品与宣传页": (
        "landing page", "product page", "pricing", "waitlist", "launch", "marketing",
        "campaign", "產品頁", "宣傳頁", "產品介紹", "服務介紹", "定價", "品牌故事", "产品页",
        "宣传页", "产品介绍", "服务介绍", "定价", "品牌故事",
    ),
}

TEST_TITLE_PATTERN = re.compile(r"^(?:t|test(?:\s+(?:page|share|report|spec|specification|kit))?|untitled html|probe|hello world)$", re.IGNORECASE)

LIBRARY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("React", ("react",)), ("Vue", ("vue",)), ("Angular", ("angular",)),
    ("Svelte", ("svelte",)), ("Alpine.js", ("alpine",)), ("jQuery", ("jquery",)),
    ("Chart.js", ("chart.js",)), ("ECharts", ("echarts",)), ("Plotly", ("plotly",)),
    ("D3", ("d3.", "d3js")), ("Three.js", ("three.js", "three.min.js")),
    ("p5.js", ("p5.js",)), ("Leaflet", ("leaflet",)), ("Mapbox", ("mapbox",)),
    ("Bootstrap", ("bootstrap",)), ("Tailwind", ("tailwind",)), ("HTMX", ("htmx",)),
)


def load_snapshot(path: Path) -> tuple[dict, list[dict]]:
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    if snapshot.get("cutoff") != "2026-09-23T15:27:28.147672Z":
        raise ValueError(f"Unexpected snapshot cutoff: {snapshot.get('cutoff')!r}")
    if snapshot.get("timezone") != "Asia/Taipei" or snapshot.get("from") != "2026-07-01":
        raise ValueError("Unexpected snapshot date range or timezone")
    rows = [dict(zip(snapshot["columns"], row)) for row in snapshot["rows"]]
    return snapshot, rows


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def ensure_public_active(rows: list[dict]) -> list[dict]:
    """Pick one newest active unlisted record for each exact content hash."""
    unique: dict[str, dict] = {}
    for row in rows:
        if row["visibility"] != "public_unlisted" or row["lifecycle_status"] != "active":
            continue
        digest = row.get("content_hash")
        if not digest:
            continue
        prior = unique.get(digest)
        if prior is None or parse_time(row["created_at"]) > parse_time(prior["created_at"]):
            unique[digest] = row
    return list(unique.values())


def fetch_one(item: tuple[str, str], content_dir: Path) -> dict:
    content_hash, slug = item
    filename = hashlib.sha256(content_hash.encode()).hexdigest() + ".html"
    target = content_dir / filename
    if target.exists() and target.stat().st_size:
        return {"content_hash": content_hash, "status": "cached", "bytes": target.stat().st_size, "file": filename}

    errors: list[str] = []
    for origin in PREVIEW_ORIGINS:
        url = f"{origin}/v/{urllib.parse.quote(slug, safe='')}/"
        for attempt in range(3):
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
            try:
                with urllib.request.urlopen(req, timeout=18) as response:
                    final_host = urllib.parse.urlparse(response.geturl()).hostname
                    if final_host not in {"sharehtml.zhenjia.dev", "share-html.zhenjiazhou0127.workers.dev"}:
                        return {"content_hash": content_hash, "status": "rejected_redirect", "bytes": 0, "error": "unexpected redirect host"}
                    status = response.status
                    raw = response.read(1_100_000)
                if status == 200 and raw:
                    target.write_bytes(raw)
                    return {"content_hash": content_hash, "status": "ok", "http_status": status, "bytes": len(raw), "file": filename}
                errors.append(f"{origin}: HTTP {status}, {len(raw)} bytes")
                break
            except urllib.error.HTTPError as exc:
                errors.append(f"{origin}: HTTP {exc.code}")
                if exc.code in (403, 404, 410):
                    break
                if attempt < 2:
                    time.sleep(0.5 * (2 ** attempt))
            except Exception as exc:  # network errors are recorded, not escalated into parsing
                errors.append(f"{origin}: {type(exc).__name__}")
                if attempt < 2:
                    time.sleep(0.5 * (2 ** attempt))
        if errors and any("HTTP 403" in e or "HTTP 404" in e or "HTTP 410" in e for e in errors[-1:]):
            continue
    return {"content_hash": content_hash, "status": "failed", "bytes": 0, "error": "; ".join(errors[-6:])}


def fetch_all(rows: list[dict], content_dir: Path, log_path: Path, workers: int) -> list[dict]:
    content_dir.mkdir(parents=True, exist_ok=True)
    items = [(row["content_hash"], row["slug"]) for row in ensure_public_active(rows)]
    results: list[dict] = []
    print(f"Fetching {len(items)} unique active public artifacts with concurrency={workers}; raw HTML stays in {content_dir}", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_one, item, content_dir): item for item in items}
        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                results.append(future.result())
            except Exception as exc:
                content_hash, _slug = futures[future]
                results.append({"content_hash": content_hash, "status": "failed", "bytes": 0, "error": type(exc).__name__})
            if i % 100 == 0 or i == len(items):
                counts = Counter(r["status"] for r in results)
                print(f"Fetch progress {i}/{len(items)}: {dict(counts)}", flush=True)
                log_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    log_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return results


class ArtifactParser(html.parser.HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lang = ""
        self.title_parts: list[str] = []
        self.meta_title: list[str] = []
        self.description: list[str] = []
        self.headings: list[str] = []
        self.text_parts: list[str] = []
        self.script_text: list[str] = []
        self.script_sources: list[str] = []
        self.counts: Counter = Counter()
        self.stack: list[str] = []
        self.current_heading: list[str] | None = None
        self.in_title = False
        self.in_script = False
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        attr = {str(k).lower(): (v or "") for k, v in attrs}
        if tag == "html" and attr.get("lang"):
            self.lang = attr["lang"].strip().lower()
        if tag == "meta":
            key = (attr.get("name") or attr.get("property") or "").lower()
            if key in {"description", "og:description", "twitter:description"} and attr.get("content"):
                self.description.append(attr["content"])
            if key in {"og:title", "twitter:title"} and attr.get("content"):
                self.meta_title.append(attr["content"])
        if tag == "title":
            self.in_title = True
        if tag == "script":
            self.in_script = True
            if attr.get("src"):
                self.script_sources.append(attr["src"].lower())
        if tag in {"h1", "h2", "h3"}:
            self.current_heading = []
        if tag in {"script", "style", "noscript", "template", "svg"}:
            self.skip_depth += 1
        self.stack.append(tag)
        self.counts[tag] += 1
        if tag not in self.VOID:
            return

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self.in_title = False
        if tag == "script":
            self.in_script = False
        if tag in {"h1", "h2", "h3"} and self.current_heading is not None:
            heading = " ".join(self.current_heading)
            if heading.strip():
                self.headings.append(heading)
            self.current_heading = None
        if tag in {"script", "style", "noscript", "template", "svg"}:
            self.skip_depth = max(0, self.skip_depth - 1)
        if tag in self.stack:
            index = len(self.stack) - 1 - self.stack[::-1].index(tag)
            del self.stack[index:]

    def handle_data(self, data: str) -> None:
        text = re.sub(r"\s+", " ", data).strip()
        if not text:
            return
        if self.in_title:
            self.title_parts.append(text)
        if self.current_heading is not None:
            self.current_heading.append(text)
        if self.in_script:
            self.script_text.append(text)
        elif self.skip_depth == 0:
            self.text_parts.append(text)

    def summary(self) -> dict:
        title = " ".join(self.title_parts).strip() or " ".join(self.meta_title).strip()
        text = " ".join(self.text_parts)
        text = re.sub(r"\s+", " ", text)
        scripts = " ".join(self.script_sources + self.script_text).lower()
        primary_text = " ".join([title, " ".join(self.description), " ".join(self.headings)]).lower()
        body_text = text[:14000].lower()
        # Title/meta/headings carry more semantic weight; body text contributes
        # only a small bounded score so incidental code or boilerplate does not
        # classify an artifact by itself.
        primary_scores = {
            name: sum(3 for key in keys if key.lower() in primary_text)
            for name, keys in CATEGORY_RULES.items()
        }
        scores = {
            name: primary_scores[name] + sum(min(2, body_text.count(key.lower())) for key in keys)
            for name, keys in CATEGORY_RULES.items()
        }
        ranked = sorted(scores.items(), key=lambda item: (item[1], primary_scores[item[0]]), reverse=True)
        best, best_score = ranked[0] if ranked else ("未分类", 0)
        next_score, next_primary = (ranked[1][1], primary_scores[ranked[1][0]]) if len(ranked) > 1 else (0, 0)
        primary_best = primary_scores.get(best, 0)
        dominant_title = title or (self.headings[0] if self.headings else "")
        if TEST_TITLE_PATTERN.fullmatch(dominant_title.strip()) and len(text) <= 180:
            category, match_strength = "测试与占位", "strong"
        elif best_score < 3 or (best_score == next_score and primary_best == next_primary):
            category, match_strength = "未分类", "weak"
        elif primary_best >= 6 and best_score >= next_score + 2:
            category, match_strength = best, "strong"
        elif primary_best >= 3 or best_score >= next_score + 2:
            category, match_strength = best, "moderate"
        else:
            category, match_strength = best, "weak"
        declared = re.split(r"[-_]", self.lang, maxsplit=1)[0] if self.lang else ""
        if not re.fullmatch(r"[a-z]{2,3}", declared):
            declared = ""
        if declared:
            language = declared
            language_basis = "html-lang"
        else:
            counts = Counter()
            for char in text:
                code = ord(char)
                if 0x3040 <= code <= 0x30FF: counts["kana"] += 1
                elif 0xAC00 <= code <= 0xD7AF: counts["hangul"] += 1
                elif 0x4E00 <= code <= 0x9FFF: counts["han"] += 1
                elif 0x0400 <= code <= 0x052F: counts["cyrillic"] += 1
                elif 0x0590 <= code <= 0x05FF: counts["hebrew"] += 1
                elif 0x0600 <= code <= 0x06FF: counts["arabic"] += 1
                elif 0x0900 <= code <= 0x097F: counts["devanagari"] += 1
            language = max(counts, key=counts.get) if counts and max(counts.values()) >= 12 else "latin/other"
            language_basis = "script-cue" if language != "latin/other" else "fallback"
        libraries = []
        for name, needles in LIBRARY_RULES:
            if any(needle in scripts for needle in needles):
                libraries.append(name)
        interactive = bool(self.counts["form"] or self.counts["button"] or self.counts["input"] or self.counts["select"] or self.counts["textarea"] or self.counts["canvas"] or self.counts["onClick"] or self.script_text)
        return {
            "title": title,
            "description": " ".join(self.description),
            "headings": self.headings,
            "visible_text": text,
            "category": category,
            "rule_match_strength": match_strength,
            "language": language,
            "language_basis": language_basis,
            "counts": {name: self.counts[name] for name in ("form", "input", "select", "textarea", "button", "a", "canvas", "svg", "video", "audio", "iframe", "script")},
            "script_sources": self.script_sources,
            "inline_script": bool(self.script_text),
            "libraries": libraries,
            "interactive_cue": interactive,
        }


def parse_artifact(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8", errors="replace")
    edge_script_blocks = 0
    def strip_known_edge_script(match: re.Match[str]) -> str:
        nonlocal edge_script_blocks
        block = match.group(0).lower()
        if "static.cloudflareinsights.com/beacon.min.js" in block or (
            "cdn-cgi/challenge-platform/scripts/jsd/main.js" in block and "__cf$cv$params" in block
        ):
            edge_script_blocks += 1
            return ""
        return match.group(0)
    # Cloudflare may append analytics and challenge-loader scripts to preview
    # responses. Drop only those exact recognizable script blocks before
    # parsing; they are not part of the uploaded artifact and are never run.
    raw = re.sub(r"<script\b[^>]*>.*?</script\s*>", strip_known_edge_script, raw, flags=re.IGNORECASE | re.DOTALL)
    parser = ArtifactParser()
    parser.feed(raw)
    result = parser.summary()
    result["edge_script_blocks_removed"] = edge_script_blocks
    return result


def title_fingerprint(title: str) -> str:
    value = title.lower()
    value = re.sub(r"\b(20\d{2}[-/.年]?)\d{0,2}([-/月.]\d{1,2})?([-/日])?\b", " # ", value)
    value = re.sub(r"\bv?\d+(?:\.\d+)*\b", " # ", value)
    value = re.sub(r"[\W_]+", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def percentile(values: list[int], q: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int((len(ordered) - 1) * q)))]


def load_edge_traffic(path: Path) -> dict | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or len(data) < 6:
        raise ValueError("Unexpected traffic aggregate shape")
    daily_rows = data[0]["results"]
    base_classes = {"human", "unverified_bot", "verified_bot"}
    daily_base: dict[str, int] = defaultdict(int)
    daily_ai: dict[str, int] = defaultdict(int)
    for row in daily_rows:
        if row["visitor_class"] in base_classes:
            daily_base[row["day"]] += int(row["requests"])
        elif row["visitor_class"] == "ai_crawler":
            daily_ai[row["day"]] += int(row["requests"])
    window_specs = (
        ("2026-06-03", "2026-06-05"),
        ("2026-06-06", "2026-07-18"),
        ("2026-07-19", "2026-09-22"),
        ("2026-08-24", "2026-09-22"),
    )
    windows = []
    for start_text, end_text in window_specs:
        start, end = dt.date.fromisoformat(start_text), dt.date.fromisoformat(end_text)
        calendar_days = (end - start).days + 1
        included_days = [day for day in daily_base if start <= dt.date.fromisoformat(day) <= end]
        windows.append({
            "start": start_text, "end": end_text,
            "calendar_days": calendar_days, "host_days_with_data": len(included_days),
            "base_observations": sum(daily_base[day] for day in included_days),
            "legacy_ai_subset": sum(value for day, value in daily_ai.items() if start <= dt.date.fromisoformat(day) <= end),
        })
    all_days = sorted(daily_base)
    base_total = sum(daily_base.values())
    ai_total = sum(daily_ai.values())
    routes = data[3]["results"]
    allowlisted_routes = {"/", "/robots.txt", "/sitemap.xml", "/llms.txt", "/.well-known/agent-card.json", "/auth.md", "/mcp"}
    route_base = Counter()
    for row in routes:
        if row["path"] in allowlisted_routes and row.get("visitor_class") in base_classes:
            route_base[row["path"]] += int(row["observations"])
    bots = sorted(data[2]["results"], key=lambda item: int(item["observations"]), reverse=True)
    statuses = {str(row["status"]): int(row["observations"]) for row in data[5]["results"]}
    return {
        "host": "sharehtml.zhenjia.dev",
        "first_day": all_days[0] if all_days else None, "last_day": all_days[-1] if all_days else None,
        "calendar_days_in_span": ((dt.date.fromisoformat(all_days[-1]) - dt.date.fromisoformat(all_days[0])).days + 1) if all_days else 0,
        "host_days_with_data": len(all_days), "missing_host_days": ["2026-08-25"],
        "base_observations": base_total,
        "base_classes": {
            "unmatched_or_legacy_human_label": sum(int(row["requests"]) for row in daily_rows if row["visitor_class"] == "human"),
            "unverified_bot_heuristic": sum(int(row["requests"]) for row in daily_rows if row["visitor_class"] == "unverified_bot"),
            "verified_bot": sum(int(row["requests"]) for row in daily_rows if row["visitor_class"] == "verified_bot"),
        },
        "legacy_ai_user_agent_subset_overlapping": ai_total,
        "windows": windows,
        "route_observations_base_classes": dict(route_base),
        "top_named_user_agents": [{"name": row["bot_name"], "observations": int(row["observations"])} for row in bots[:6]],
        "status_observations": statuses,
        "collection_note": "Stored Cloudflare analytics observations; not sampling-weighted traffic or unique visitors. Cloudflare zone excludes direct workers.dev MCP origin calls.",
    }


def load_edge_country(country_path: Path, monthly_path: Path, traffic_path: Path) -> dict | None:
    if not country_path.exists():
        return None
    base_classes = ("human", "unverified_bot", "verified_bot")
    def read_results(path):
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(payload, list) and all(part.get("success") is True for part in payload)
        return [row for part in payload for row in part["results"]]
    def aggregate(records):
        grouped = defaultdict(Counter)
        for row in records:
            code, kind, count = row["country"], row["visitor_class"], row["observations"]
            # Non-country buckets such as T1 remain in the unknown-country
            # denominator rather than being dropped or published as countries.
            code = code if isinstance(code, str) and re.fullmatch(r"[A-Z]{2}", code) and code != "XX" else "ZZ"
            assert kind in (*base_classes, "ai_crawler")
            assert isinstance(count, int) and count >= 0
            grouped[code][kind] += count
        countries = []
        for code, counts in grouped.items():
            classes = {key: counts[key] for key in base_classes}
            countries.append({"country": code, "base_observations": sum(classes.values()), "classes": classes,
                              "ai_subset_overlapping": counts["ai_crawler"]})
        countries.sort(key=lambda row: (-row["base_observations"], row["country"]))
        return {"base_observations": sum(row["base_observations"] for row in countries),
                "ai_subset_overlapping": sum(row["ai_subset_overlapping"] for row in countries), "countries": countries}
    raw = read_results(country_path)
    total = aggregate(raw)
    # The historical export contains several unrelated query results; only its
    # first result is daily traffic. Never mix path/bot/status totals into it.
    daily = json.loads(traffic_path.read_text(encoding="utf-8"))[0]["results"]
    def expected(records):
        counts = Counter()
        for row in records:
            counts[row["visitor_class"]] += int(row["requests"])
        return counts
    def validate(actual, counts):
        assert actual["base_observations"] == sum(counts[k] for k in base_classes)
        assert actual["ai_subset_overlapping"] == counts["ai_crawler"]
        for kind in base_classes:
            assert sum(row["classes"][kind] for row in actual["countries"]) == counts[kind]
    validate(total, expected(daily))
    monthly = {}
    if monthly_path.exists():
        monthly_raw = read_results(monthly_path)
        months = sorted({row["day"][:7] for row in daily})
        assert {row["month"] for row in monthly_raw} == set(months)
        for month in months:
            monthly[month] = aggregate([row for row in monthly_raw if row["month"] == month])
            validate(monthly[month], expected([row for row in daily if row["day"].startswith(month)]))
        assert sum(value["base_observations"] for value in monthly.values()) == total["base_observations"]
        assert sum(value["ai_subset_overlapping"] for value in monthly.values()) == total["ai_subset_overlapping"]
        for country in total["countries"]:
            parts = [row for value in monthly.values() for row in value["countries"] if row["country"] == country["country"]]
            assert sum(row["base_observations"] for row in parts) == country["base_observations"]
            assert sum(row["ai_subset_overlapping"] for row in parts) == country["ai_subset_overlapping"]
            for kind in base_classes:
                assert sum(row["classes"][kind] for row in parts) == country["classes"][kind]
    return {"from": min(row["day"] for row in daily), "to": max(row["day"] for row in daily), "timezone": "UTC",
            "known_country_code_count": sum(row["country"] != "ZZ" for row in total["countries"]),
            **total, "monthly": monthly, "note": "Request network country, not user residence or nationality. Unweighted stored observations; human is legacy unmatched fallback; AI subset overlaps base classes."}


def build_report_charts(snapshot: dict, rows: list[dict], contents: dict, traffic_path: Path) -> dict:
    """Connected snapshot outcomes, not an acquisition/conversion funnel."""
    tz = ZoneInfo(snapshot["timezone"])
    start = dt.date.fromisoformat(snapshot["from"])
    end = parse_time(snapshot["cutoff"]).astimezone(tz).date()
    source_keys = ("api", "mcp", "direct", "other", "unknown")
    def source(row):
        value = row.get("source")
        return value if value in source_keys[:3] else "other" if value else "unknown"
    grouped = defaultdict(Counter)
    for row in rows:
        day = parse_time(row["created_at"]).astimezone(tz).date().isoformat()
        assert start.isoformat() <= day <= end.isoformat()
        grouped[day][source(row)] += 1
    daily = []
    for offset in range((end - start).days + 1):
        day = start + dt.timedelta(days=offset)
        counts = {key: grouped[day.isoformat()][key] for key in source_keys}
        daily.append({"date": day.isoformat(), "records": sum(counts.values()), "sources": counts,
                      "partial_day": day == end})
        window = daily[-7:]
        daily[-1].update(trailing_7_day_mean=round(sum(r["records"] for r in window) / 7, 4) if len(window) == 7 else None,
                         trailing_observed_days=len(window))
        assert sum(counts.values()) == daily[-1]["records"]
    weeks = {}
    for row in daily:
        day = dt.date.fromisoformat(row["date"])
        monday = day - dt.timedelta(days=day.weekday())
        bucket = weeks.setdefault(monday.isoformat(), {"week_start": monday.isoformat(), "week_end": (monday + dt.timedelta(days=6)).isoformat(), "records": 0, "observed_days": 0, "complete_days": 0, "sources": {key: 0 for key in source_keys}})
        bucket["records"] += row["records"]
        bucket["observed_days"] += 1
        bucket["complete_days"] += not row["partial_day"]
        for key in source_keys:
            bucket["sources"][key] += row["sources"][key]
    assert sum(r["records"] for r in daily) == sum(r["records"] for r in weeks.values()) == len(rows)
    for week in weeks.values():
        assert sum(week["sources"].values()) == week["records"]
        week["records_per_observed_day"] = round(week["records"] / week["observed_days"], 4)

    active = [r for r in rows if r["lifecycle_status"] == "active"]
    public = [r for r in active if r["visibility"] == "public_unlisted"]
    def category(row):
        return contents.get(row.get("content_hash"), {}).get("category", "未分类")
    category_counts = Counter(category(r) for r in public)
    top = [key for key, count in sorted(category_counts.items(), key=lambda item: (-item[1], item[0])) if key != "未分类"][:6]
    paths = Counter()
    for row in public:
        cat = category(row)
        label = cat if cat in top or cat == "未分类" else "其他用途"
        paths[(source(row), label, "preview_recorded" if (row.get("views") or 0) > 0 else "no_preview_recorded")] += 1
    source_category = Counter()
    category_preview = Counter()
    for (src, cat, preview), count in paths.items():
        source_category[(src, cat)] += count
        category_preview[(cat, preview)] += count
    nodes = [{"id": "source:" + key, "stage": "source", "label": key} for key in source_keys]
    nodes += [{"id": "category:" + key, "stage": "category", "label": key} for key in top + ["其他用途", "未分类"]]
    nodes += [{"id": "preview:" + key, "stage": "preview", "label": key} for key in ("preview_recorded", "no_preview_recorded")]
    links = [{"source": "source:" + src, "target": "category:" + cat, "value": count} for (src, cat), count in sorted(source_category.items())]
    links += [{"source": "category:" + cat, "target": "preview:" + preview, "value": count} for (cat, preview), count in sorted(category_preview.items())]
    assert sum(source_category.values()) == sum(category_preview.values()) == len(public) == 2640
    for cat in top + ["其他用途", "未分类"]:
        assert sum(n for (_, c), n in source_category.items() if c == cat) == sum(n for (c, _), n in category_preview.items() if c == cat)
    active_viewed = sum((r.get("views") or 0) > 0 for r in active)
    assert len(rows) >= len(active) >= active_viewed >= 0

    edge_daily = []
    if traffic_path.exists():
        raw = json.loads(traffic_path.read_text())[0]["results"]
        by_day = defaultdict(Counter)
        for row in raw:
            by_day[row["day"]][row["visitor_class"]] += int(row["requests"])
        first, last = min(by_day), max(by_day)
        day = dt.date.fromisoformat(first)
        while day.isoformat() <= last:
            key = day.isoformat()
            counts = by_day.get(key)
            edge_daily.append({"date": key, "base_observations": sum(counts.get(k, 0) for k in ("human", "verified_bot", "unverified_bot")) if counts is not None else None,
                               "classes": dict(counts) if counts is not None else None,
                               "ai_subset_overlapping": counts.get("ai_crawler", 0) if counts is not None else None})
            day += dt.timedelta(days=1)
        assert [r["date"] for r in edge_daily if r["base_observations"] is None] == ["2026-08-25"]
        assert sum(r["base_observations"] or 0 for r in edge_daily) == 70340

    code = [
        ("2026-05-26T11:53:45+08:00", "84ec3d1", "seo_discovery_metadata", ["seo", "discovery"]),
        ("2026-05-26T14:27:48+08:00", "6fd9fbe", "readonly_webmcp_remote_mcp", ["webmcp", "remote_mcp"]),
        ("2026-05-26T14:33:55+08:00", "8b30184", "sitemap_homepage_only", ["seo"]),
        ("2026-06-06T02:58:46+08:00", "52753a0", "create_share_tools_and_structured_homepage", ["seo", "discovery", "webmcp", "remote_mcp"]),
        ("2026-07-19T10:14:41+08:00", "2029c4a", "private_sharing_product_pages_discovery", ["product", "seo", "discovery", "webmcp"]),
        ("2026-07-19T10:32:59+08:00", "8f1d741", "remote_mcp_machine_origin", ["remote_mcp"]),
        ("2026-07-19T12:43:30+08:00", "1c4c6f4", "registry_identity_change", ["remote_mcp"]),
    ]
    milestones = [{"type": "code_change", "at": at, "commit": commit, "key": key, "tracks": tracks, "deployment_mapped": False} for at, commit, key, tracks in code]
    milestones.append({"type": "deployment_observed", "at": "2026-07-19T10:15:43.710140+08:00", "end": "2026-07-19T12:44:31.622302+08:00", "key": "production_deployment_window", "deployment_mapped": False})
    for date, basis, key in [("2026-06-03", "UTC", "edge_collection_start"), ("2026-07-01", "Asia/Taipei", "creation_window_start"), ("2026-07-21", "Asia/Taipei", "first_nonempty_source"), ("2026-08-10", "Asia/Taipei", "first_mcp_label"), ("2026-08-25", "UTC", "edge_missing_day"), ("2026-09-22", "UTC", "last_edge_day")]:
        milestones.append({"type": "measurement", "date": date, "timezone": basis, "key": key})
    milestones.append({"type": "measurement", "at": snapshot["cutoff"], "key": "frozen_snapshot_cutoff"})
    return {"schema_version": 1, "creation_timezone": snapshot["timezone"], "edge_timezone": "UTC", "source_groups": list(source_keys),
            "creation_daily": daily, "creation_weekly": list(weeks.values()),
            "source_purpose_preview_flow": {"population": len(public), "scope": "active_public_share_records", "top_categories": top, "nodes": nodes, "links": links,
                "paths": [{"source": src, "category": cat, "preview": preview, "records": count} for (src, cat, preview), count in sorted(paths.items())],
                "note": "Self-reported source to inferred purpose to cumulative preview outcome; same records, not acquisition conversion or unique people."},
            "snapshot_outcome_funnel": {"scope": "all_snapshot_records", "stages": [{"key": "created_records", "records": len(rows)}, {"key": "active_at_cutoff", "records": len(active)}, {"key": "active_with_preview_at_cutoff", "records": active_viewed}],
                "note": "Nested states at cutoff, not chronological conversion; previews can precede current lifecycle state."},
            "edge_daily": edge_daily, "milestones": milestones}


def build_aggregates(snapshot: dict, rows: list[dict], content_dir: Path, fetch_log: Path, traffic_path: Path) -> dict:
    tz = ZoneInfo(snapshot["timezone"])
    def local_date(row: dict) -> dt.date:
        return parse_time(row["created_at"]).astimezone(tz).date()

    start = dt.date(2026, 7, 1)
    cutoff = parse_time(snapshot["cutoff"]).astimezone(tz)
    cutoff_day = cutoff.date()
    public = [r for r in rows if r["visibility"] == "public_unlisted"]
    private = [r for r in rows if r["visibility"] == "private_link"]
    active_public = [r for r in public if r["lifecycle_status"] == "active"]
    hashes_all_public = Counter(r["content_hash"] for r in public if r.get("content_hash"))
    hashes_active_public = Counter(r["content_hash"] for r in active_public if r.get("content_hash"))
    created_events = sum(r.get("created_events") or 0 for r in rows)
    created_rows = sum(bool(r.get("created_events")) for r in rows)
    month_names = ("2026-07", "2026-08", "2026-09")
    monthly: dict[str, dict] = {}
    for month in month_names:
        subset = [r for r in rows if local_date(r).strftime("%Y-%m") == month]
        pubs = [r for r in subset if r["visibility"] == "public_unlisted"]
        privs = [r for r in subset if r["visibility"] == "private_link"]
        days = 31 if month in ("2026-07", "2026-08") else cutoff_day.day
        monthly[month] = {
            "records": len(subset), "public_unlisted": len(pubs), "private_link": len(privs),
            "active": sum(r["lifecycle_status"] == "active" for r in subset),
            "created_events": sum(r.get("created_events") or 0 for r in subset),
            "days_in_observation": days, "records_per_day": round(len(subset) / days, 2),
            "private_share_rate": round(len(privs) / len(subset), 4) if subset else 0,
            "view_requests_asof": sum(r.get("views") or 0 for r in subset),
            "records_with_views": sum((r.get("views") or 0) > 0 for r in subset),
        }
    daily_counter = Counter(local_date(r).isoformat() for r in rows)
    daily = []
    day = start
    while day <= cutoff_day:
        daily.append({"date": day.isoformat(), "records": daily_counter[day.isoformat()]})
        day += dt.timedelta(days=1)
    equal_windows = []
    for month in (7, 8, 9):
        window_start = dt.date(2026, month, 1)
        window_end = dt.date(2026, month, 23)
        subset = [r for r in rows if window_start <= local_date(r) <= window_end]
        equal_windows.append({"window": f"2026-{month:02d}-01—23", "records": len(subset), "per_day": round(len(subset) / 23, 2)})

    source_counts = Counter(r.get("source") or "(null)" for r in rows)
    source_month: dict[str, dict[str, int]] = {}
    for month in month_names:
        subset = [r for r in rows if local_date(r).strftime("%Y-%m") == month]
        source_month[month] = dict(Counter(r.get("source") or "(null)" for r in subset))

    views = [r.get("views") or 0 for r in rows]
    status_counts = Counter(r["lifecycle_status"] for r in rows)
    event_status = Counter((r["lifecycle_status"], r.get("created_events") or 0) for r in rows)
    repeated_groups = [n for n in hashes_all_public.values() if n > 1]
    repeated_exact_rows = sum(repeated_groups)
    exact_duplicates = {
        "unique_hashes_all_public": len(hashes_all_public),
        "unique_hashes_active_public": len(hashes_active_public),
        "repeated_hash_groups": len(repeated_groups),
        "rows_in_repeated_groups": repeated_exact_rows,
        "extra_rows_over_unique": sum(n - 1 for n in repeated_groups),
        "histogram": dict(sorted(Counter(map(str, repeated_groups)).items(), key=lambda x: int(x[0]))),
    }

    contents: dict[str, dict] = {}
    fetched_log: list[dict] = []
    if fetch_log.exists():
        try:
            fetched_log = json.loads(fetch_log.read_text(encoding="utf-8"))
        except Exception:
            fetched_log = []
    file_by_hash = {r.get("content_hash"): r for r in fetched_log if r.get("file") and r.get("status") in {"ok", "cached"}}
    for digest, meta in file_by_hash.items():
        path = content_dir / meta["file"]
        if path.exists():
            contents[digest] = parse_artifact(path)

    category_hashes = Counter(a["category"] for a in contents.values())
    category_confidence = Counter((a["category"], a["rule_match_strength"]) for a in contents.values())
    # Inherit unique-document classification to each active public share record
    # for the record-by-self-reported-source matrix; duplicates stay visible.
    category_source: dict[str, Counter] = defaultdict(Counter)
    category_source_month: dict[str, dict[str, Counter]] = defaultdict(lambda: defaultdict(Counter))
    category_rows: Counter = Counter()
    category_rows_month: dict[str, Counter] = defaultdict(Counter)
    category_unique_month: dict[str, Counter] = defaultdict(Counter)
    category_month_hashes: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    first_active_month_by_hash: dict[str, str] = {}
    for row in active_public:
        digest = row.get("content_hash")
        if not digest:
            continue
        month = local_date(row).strftime("%Y-%m")
        if digest not in first_active_month_by_hash or month < first_active_month_by_hash[digest]:
            first_active_month_by_hash[digest] = month
    # Classify only active public links: those are the records whose exact
    # content hash was fetched and parsed. Inactive public rows stay in the
    # frozen population/status totals, not this content/source matrix.
    for row in active_public:
        digest = row.get("content_hash")
        artifact = contents.get(digest)
        category = artifact["category"] if artifact else "未分类"
        source = row.get("source") or "(null)"
        month = local_date(row).strftime("%Y-%m")
        category_source[category][source] += 1
        category_rows[category] += 1
        category_rows_month[month][category] += 1
        category_source_month[month][category][source] += 1
        if digest:
            category_month_hashes[month][category].add(digest)
    for digest, artifact in contents.items():
        month = first_active_month_by_hash.get(digest)
        if month:
            category_unique_month[month][artifact["category"]] += 1

    language_unique = Counter(a["language"] for a in contents.values())
    language_basis = Counter(a["language_basis"] for a in contents.values())
    feature_totals = Counter()
    feature_presence = Counter()
    library_totals = Counter()
    edge_script_blocks_removed = sum(a.get("edge_script_blocks_removed", 0) for a in contents.values())
    for artifact in contents.values():
        if artifact["interactive_cue"]:
            feature_totals["interactive_cue"] += 1
        if artifact["inline_script"]:
            feature_totals["inline_script"] += 1
        for key, value in artifact["counts"].items():
            feature_totals[key] += value
            if value > 0:
                feature_presence[key] += 1
        for name in artifact["libraries"]:
            library_totals[name] += 1
    title_fingerprints = [title_fingerprint(r.get("title") or "") for r in public]
    empty_title_fingerprints = sum(not value for value in title_fingerprints)
    normalized_titles = Counter(value for value in title_fingerprints if value)
    title_repeats = [n for n in normalized_titles.values() if n > 1]

    fetch_counts = Counter(r.get("status") for r in fetched_log)
    fetched_bytes = sum(r.get("bytes", 0) or 0 for r in fetched_log)
    return {
        "metadata": {"cutoff": snapshot["cutoff"], "timezone": snapshot["timezone"], "from": snapshot["from"], "through_local": cutoff.isoformat()},
        "population": {
            "records": len(rows), "public_unlisted": len(public), "private_link": len(private),
            "public_share_rate": round(len(public) / len(rows), 4), "private_share_rate": round(len(private) / len(rows), 4),
            "active": status_counts["active"], "status": dict(status_counts),
            "created_events_sum": created_events, "records_with_created_event": created_rows,
            "records_without_created_event": len(rows) - created_rows,
            "created_event_coverage": round(created_rows / len(rows), 4), "status_x_created_events": {f"{status}|{event}": count for (status, event), count in event_status.items()},
        },
        "monthly": monthly,
        "equal_23_day_windows": equal_windows,
        "daily": daily,
        "source": {"counts": dict(source_counts), "by_month": source_month},
        "views_asof_snapshot": {
            "requests": sum(views), "records_with_one_or_more": sum(v > 0 for v in views),
            "record_share_with_one_or_more": round(sum(v > 0 for v in views) / len(rows), 4),
            "percentiles": {f"p{q}": percentile(views, q / 100) for q in (50, 75, 90, 95, 99)},
            "max": max(views, default=0),
            "distribution": {"0": sum(v == 0 for v in views), "1": sum(v == 1 for v in views), "2-4": sum(2 <= v <= 4 for v in views), "5-19": sum(5 <= v <= 19 for v in views), "20-99": sum(20 <= v <= 99 for v in views), "100+": sum(v >= 100 for v in views)},
            "by_creation_month": {m: {"requests": monthly[m]["view_requests_asof"], "records_with_views": monthly[m]["records_with_views"]} for m in month_names},
        },
        "exact_duplicates_public": exact_duplicates,
        "title_pattern_repeats_public": {
            "scope_public_share_records": len(public),
            "empty_fingerprints_excluded": empty_title_fingerprints,
            "normalized_unique_patterns": len(normalized_titles),
            "patterns_repeated_2plus": len(title_repeats),
            "records_in_repeated_patterns": sum(title_repeats),
            "largest_pattern_size": max(normalized_titles.values(), default=0),
            "top5_pattern_records": sum(n for _k, n in normalized_titles.most_common(5)),
        },
        "artifact_fetch": {
            "unique_active_public_targets": len(ensure_public_active(rows)),
            "attempt_results": len(fetched_log), "status_counts": dict(fetch_counts),
            "parsed_documents": len(contents), "downloaded_bytes": fetched_bytes,
            "raw_directory": str(content_dir),
            "user_agent": USER_AGENT,
        },
        "artifact_classification": {
            "unique_documents": len(contents), "by_category_unique": dict(category_hashes),
            "category_rule_match_strength": {f"{cat}|{strength}": count for (cat, strength), count in category_confidence.items()},
            "by_category_public_share_records": dict(category_rows),
            "by_category_unique_by_creation_month": {month: dict(counter) for month, counter in category_unique_month.items()},
            "by_category_unique_in_month": {month: {category: len(hashes) for category, hashes in categories.items()} for month, categories in category_month_hashes.items()},
            "by_category_public_share_records_by_month": {month: dict(counter) for month, counter in category_rows_month.items()},
            "category_by_self_reported_source_records": {category: dict(counter) for category, counter in category_source.items()},
            "category_by_source_records_by_month": {month: {category: dict(counter) for category, counter in categories.items()} for month, categories in category_source_month.items()},
            "languages_unique": dict(language_unique), "language_basis_unique": dict(language_basis),
            "feature_counts_unique": dict(feature_totals), "library_document_counts": dict(library_totals),
            "feature_document_presence_unique": dict(feature_presence),
            "known_edge_script_blocks_removed": edge_script_blocks_removed,
            "rule_set": {name: list(words) for name, words in CATEGORY_RULES.items()},
        },
        "edge_traffic": load_edge_traffic(traffic_path),
        "report_charts": build_report_charts(snapshot, rows, contents, traffic_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--content-dir", type=Path, default=DEFAULT_CONTENT)
    parser.add_argument("--fetch-log", type=Path, default=DEFAULT_FETCH_LOG)
    parser.add_argument("--traffic", type=Path, default=DEFAULT_TRAFFIC)
    parser.add_argument("--country", type=Path, default=DEFAULT_COUNTRY)
    parser.add_argument("--country-monthly", type=Path, default=DEFAULT_COUNTRY_MONTHLY)
    parser.add_argument("--output", type=Path, default=DEFAULT_AGGREGATES)
    parser.add_argument("--fetch", action="store_true", help="Fetch active public unique HTML using bounded HTTP GET requests")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.workers <= 4:
        parser.error("--workers must be between 1 and 4")
    snapshot, rows = load_snapshot(args.snapshot)
    if len(rows) != 2797:
        raise ValueError(f"Expected frozen population of 2797 rows, found {len(rows)}")
    if args.fetch:
        fetch_all(rows, args.content_dir, args.fetch_log, args.workers)
    result = build_aggregates(snapshot, rows, args.content_dir, args.fetch_log, args.traffic)
    result["edge_country"] = load_edge_country(args.country, args.country_monthly, args.traffic)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "rows": result["population"]["records"],
        "created_events": result["population"]["created_events_sum"],
        "monthly": result["monthly"],
        "fetch": result["artifact_fetch"],
        "categories": result["artifact_classification"]["by_category_unique"],
        "output": str(args.output),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
