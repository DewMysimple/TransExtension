#!/usr/bin/env python3
"""检查 TransExtension 根级工程记忆并重建工作日志索引。

只使用 Python 标准库。默认记忆根目录是本文件上两级的 `wiki_memory/` 目录。

用法：
    python wiki_memory/工具/memory_lint.py check
    python wiki_memory/工具/memory_lint.py index
    python wiki_memory/工具/memory_lint.py --root <记忆目录> check
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Iterable


ALLOWED_TYPES = {"state", "decision", "knowledge", "log", "moc"}
ALLOWED_STATUSES = {"active", "proposed", "deprecated", "superseded", "archived"}
ALLOWED_KINDS = {
    "feature",
    "ui",
    "bug",
    "discussion",
    "test",
    "maintenance",
    "architecture",
    "process",
    "module",
    "operations",
}
ALLOWED_LOG_KINDS = {"feature", "ui", "bug", "discussion", "test", "maintenance"}
ALLOWED_IMPORTANCE = {"high", "medium", "low"}
ALLOWED_PROJECTS = {"trans-extension", "figma-zh-ui", "github-zh-ui"}
PLUGIN_PROJECTS = {"figma-zh-ui", "github-zh-ui"}
REQUIRED_FIELDS = {
    "type",
    "status",
    "kind",
    "importance",
    "updated",
    "topic",
    "project",
    "affected_projects",
    "source_logs",
    "supersedes",
}
MANAGED_DIRS = {"当前状态", "决策", "知识", "日志"}
ROOT_CONTEXT_FILES = {"README.md", "AGENTS.md", "llm-wiki.md"}
INDEX_PATH = Path("日志") / "MOC_工作日志.md"
TOPIC_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass
class Page:
    path: Path
    fields: dict[str, object] = field(default_factory=dict)
    body: str = ""

    @property
    def rel(self) -> str:
        return self.path.as_posix()

    @property
    def page_type(self) -> str:
        return str(self.fields.get("type", ""))

    @property
    def status(self) -> str:
        return str(self.fields.get("status", ""))

    @property
    def topic(self) -> str:
        return str(self.fields.get("topic", "")).strip()

    @property
    def project(self) -> str:
        return str(self.fields.get("project", "")).strip()


def is_managed(path: Path) -> bool:
    return bool(path.parts) and path.parts[0] in MANAGED_DIRS


def parse_scalar(raw: str) -> object:
    value = raw.strip()
    if not value:
        return ""
    if value in {"null", "Null", "NULL", "~"}:
        return None
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    if value.startswith("[") and value.endswith("]"):
        return [str(parse_scalar(item)) for item in value[1:-1].split(",") if item.strip()]
    return value


def parse_frontmatter(text: str) -> tuple[dict[str, object], str, bool]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text, False

    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}, text, False

    fields: dict[str, object] = {}
    current_list: str | None = None
    for line in lines[1:end]:
        if re.match(r"^\s*-\s+", line) and current_list:
            item = re.sub(r"^\s*-\s+", "", line)
            existing = fields.setdefault(current_list, [])
            if isinstance(existing, list):
                existing.append(parse_scalar(item))
            continue

        match = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$", line)
        if not match:
            continue
        key, raw = match.groups()
        if raw.strip() == "":
            fields[key] = []
            current_list = key
        else:
            fields[key] = parse_scalar(raw)
            current_list = None

    body = "\n".join(lines[end + 1 :])
    return fields, body, True


def context_paths(root: Path) -> list[Path]:
    paths = [root / name for name in sorted(ROOT_CONTEXT_FILES) if (root / name).is_file()]
    for dirname in sorted(MANAGED_DIRS):
        managed_root = root / dirname
        if managed_root.is_dir():
            paths.extend(sorted(managed_root.rglob("*.md")))
    return paths


def load_pages(root: Path) -> list[Page]:
    pages: list[Page] = []
    for path in context_paths(root):
        fields, body, _ = parse_frontmatter(path.read_text(encoding="utf-8"))
        pages.append(Page(path.relative_to(root), fields, body))
    return pages


def strip_code(text: str) -> str:
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    return re.sub(r"`[^`\n]*`", "", text)


def wiki_target(raw: str) -> str:
    # Obsidian aliases use ``|``; Markdown tables escape that separator as ``\|``.
    return raw.replace(r"\|", "|").split("|", 1)[0].strip()


def links_in(text: str) -> Iterable[str]:
    text = strip_code(text)
    for match in re.finditer(r"\[\[([^\]]+)\]\]", text):
        target = wiki_target(match.group(1))
        if target and not target.startswith("http") and not target.endswith("/"):
            file_target = target.split("#", 1)[0].replace("\\", "/")
            if file_target:
                yield file_target

    for match in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", text):
        target = match.group(1).strip().strip("<>")
        if (
            target
            and not target.startswith("#")
            and not re.match(r"^(?:https?|mailto):", target)
            and not target.endswith("/")
        ):
            target = target.split("#", 1)[0].replace("\\", "/")
            if target and not target.startswith(("/", "./", "../")):
                target = f"./{target}"
            if target:
                yield target


def source_log_links(page: Page) -> Iterable[str]:
    values = page.fields.get("source_logs", [])
    if not isinstance(values, list):
        return
    for value in values:
        match = re.fullmatch(r"\[\[([^\]]+)\]\]", str(value).strip())
        if match:
            yield wiki_target(match.group(1)).split("#", 1)[0].replace("\\", "/")


def supersedes_links(page: Page) -> Iterable[str]:
    value = page.fields.get("supersedes")
    if not isinstance(value, str):
        return
    match = re.fullmatch(r"\[\[([^\]]+)\]\]", value.strip())
    if match:
        yield wiki_target(match.group(1)).split("#", 1)[0].replace("\\", "/")


def all_page_links(page: Page) -> Iterable[str]:
    yield from links_in(page.body)
    yield from source_log_links(page)
    yield from supersedes_links(page)


def resolve_link(source: Path, target: str) -> Path | None:
    if not target:
        return None
    candidate = Path(target)
    if not target.endswith(".md"):
        candidate = candidate.with_suffix(".md")
    if target.startswith("/"):
        return candidate
    if target.startswith(("当前状态/", "决策/", "知识/", "日志/", "模板/")):
        return candidate
    if target.startswith(("./", "../")):
        return source.parent / candidate
    return candidate


def canonical_relative(root: Path, source: Path, target: str) -> Path | None:
    resolved = resolve_link(source, target)
    if resolved is None:
        return None
    absolute = (root / resolved).resolve()
    try:
        return absolute.relative_to(root.resolve())
    except ValueError:
        return None


def canonical_absolute(root: Path, source: Path, target: str) -> Path | None:
    resolved = resolve_link(source, target)
    if resolved is None:
        return None
    return (root / resolved).resolve()


def is_inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def display_title(page: Page) -> str:
    for line in page.body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return page.path.stem


def list_field(page: Page, name: str, errors: list[str]) -> list[str]:
    value = page.fields.get(name)
    if not isinstance(value, list):
        errors.append(f"{page.rel}: frontmatter field '{name}' must be a list")
        return []
    return [str(item).strip() for item in value]


def validate_metadata(page: Page, errors: list[str]) -> None:
    if not is_managed(page.path):
        return

    missing = sorted(REQUIRED_FIELDS - page.fields.keys())
    if missing:
        errors.append(f"{page.rel}: missing frontmatter fields: {', '.join(missing)}")

    if page.page_type not in ALLOWED_TYPES:
        errors.append(f"{page.rel}: invalid type '{page.page_type}'")
    if page.status not in ALLOWED_STATUSES:
        errors.append(f"{page.rel}: invalid status '{page.status}'")

    kind = str(page.fields.get("kind", ""))
    if kind not in ALLOWED_KINDS:
        errors.append(f"{page.rel}: invalid kind '{kind}'")
    if page.page_type == "log" and kind not in ALLOWED_LOG_KINDS:
        errors.append(f"{page.rel}: log kind must be one of {', '.join(sorted(ALLOWED_LOG_KINDS))}")
    if page.page_type == "log" and page.status != "archived":
        errors.append(f"{page.rel}: completed work logs must use status 'archived'")

    expected_type: str | None = None
    if page.path.parts[0] == "当前状态":
        expected_type = "state"
    elif page.path.parts[0] == "决策":
        expected_type = "knowledge" if page.path.name == "README.md" else "decision"
    elif page.path.parts[0] == "知识":
        expected_type = "knowledge"
    elif page.path.parts[0] == "日志":
        if page.path == INDEX_PATH:
            expected_type = "moc"
        elif page.path.name == "README.md":
            expected_type = "knowledge"
        else:
            expected_type = "log"
    if expected_type and page.page_type != expected_type:
        errors.append(
            f"{page.rel}: pages in this location must use type '{expected_type}', got '{page.page_type}'"
        )
    if page.path == INDEX_PATH and page.status != "active":
        errors.append(f"{page.rel}: work-log MOC must use status 'active'")

    importance = str(page.fields.get("importance", ""))
    if importance not in ALLOWED_IMPORTANCE:
        errors.append(f"{page.rel}: invalid importance '{importance}'")

    updated = str(page.fields.get("updated", ""))
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", updated):
            raise ValueError
        date.fromisoformat(updated)
    except ValueError:
        errors.append(f"{page.rel}: updated must use a real YYYY-MM-DD date")

    if not TOPIC_PATTERN.fullmatch(page.topic):
        errors.append(f"{page.rel}: topic must be stable kebab-case, got '{page.topic}'")

    if page.project not in ALLOWED_PROJECTS:
        errors.append(f"{page.rel}: invalid project '{page.project}'")

    affected = list_field(page, "affected_projects", errors)
    unknown = sorted(set(affected) - ALLOWED_PROJECTS)
    if unknown:
        errors.append(f"{page.rel}: invalid affected_projects: {', '.join(unknown)}")
    if len(affected) != len(set(affected)):
        errors.append(f"{page.rel}: affected_projects contains duplicates")
    if page.project in affected:
        errors.append(f"{page.rel}: affected_projects must not repeat primary project '{page.project}'")
    if page.project in PLUGIN_PROJECTS and affected:
        errors.append(f"{page.rel}: plugin-primary pages must use an empty affected_projects list")
    if "trans-extension" in affected:
        errors.append(f"{page.rel}: trans-extension cannot appear in affected_projects")

    sources = list_field(page, "source_logs", errors)
    if page.page_type in {"state", "decision", "knowledge"} and page.status == "active" and not sources:
        errors.append(f"{page.rel}: active long-term pages require at least one source_logs entry")
    for source in sources:
        if not re.fullmatch(r"\[\[日志/[^\]]+\]\]", source):
            errors.append(f"{page.rel}: invalid source_logs entry '{source}'")

    supersedes = page.fields.get("supersedes")
    if supersedes is not None:
        if not isinstance(supersedes, str) or not re.fullmatch(r"\[\[[^\]]+\]\]", supersedes.strip()):
            errors.append(f"{page.rel}: supersedes must be null or one wiki page link")

    if page.page_type == "log" and page.path.name not in {"README.md", "MOC_工作日志.md"}:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}-.+\.md", page.path.name):
            errors.append(f"{page.rel}: work log filename must be YYYY-MM-DD-title.md")
        if page.path.parent != Path("日志"):
            errors.append(f"{page.rel}: work logs must be stored directly in the 日志 directory")


def validate_pages(root: Path, pages: list[Page]) -> list[str]:
    errors: list[str] = []
    page_by_path = {page.rel: page for page in pages}

    for page in pages:
        validate_metadata(page, errors)
        for target in all_page_links(page):
            absolute = canonical_absolute(root, page.path, target)
            if absolute is None or not is_inside(absolute, root.parent):
                errors.append(f"{page.rel}: link escapes repository or is invalid '{target}'")
                continue
            if not absolute.is_file():
                errors.append(f"{page.rel}: broken link '{target}'")

        for target in supersedes_links(page):
            relative = canonical_relative(root, page.path, target)
            if relative is None:
                continue
            previous = page_by_path.get(relative.as_posix())
            if previous is None:
                errors.append(f"{page.rel}: supersedes target must be a managed memory page")
                continue
            if previous.page_type != page.page_type:
                errors.append(
                    f"{page.rel}: supersedes target must have the same type, got '{previous.page_type}'"
                )
            if previous.project != page.project:
                errors.append(
                    f"{page.rel}: supersedes target must have the same project, got '{previous.project}'"
                )
            if page.status == "active" and previous.status not in {"superseded", "deprecated"}:
                errors.append(
                    f"{page.rel}: active replacement requires target status superseded or deprecated"
                )

        for target in source_log_links(page):
            relative = canonical_relative(root, page.path, target)
            source_page = page_by_path.get(relative.as_posix()) if relative is not None else None
            if (
                relative is None
                or ".." in Path(target).parts
                or not relative.parts
                or relative.parts[0] != "日志"
                or source_page is None
                or source_page.page_type != "log"
            ):
                errors.append(f"{page.rel}: source_logs must point to a managed work-log page")

    active_topics: dict[tuple[str, str, str], list[str]] = {}
    for page in pages:
        if page.status == "active" and page.topic and page.page_type in {"state", "decision"}:
            active_topics.setdefault((page.page_type, page.project, page.topic), []).append(page.rel)
    for (page_type, project, topic), paths in active_topics.items():
        if len(paths) > 1:
            errors.append(
                f"multiple active {page_type} pages for project '{project}' and topic '{topic}': "
                + ", ".join(paths)
            )

    decision_numbers: dict[str, list[str]] = {}
    for page in pages:
        match = re.match(r"ADR-(\d+)-", page.path.name)
        if match:
            decision_numbers.setdefault(match.group(1), []).append(page.rel)
    for number, paths in decision_numbers.items():
        if len(paths) > 1:
            errors.append(f"duplicate decision number ADR-{number}: {', '.join(paths)}")

    mocs = [page.rel for page in pages if page.page_type == "moc"]
    if mocs != [INDEX_PATH.as_posix()]:
        errors.append(f"exactly one work-log MOC is allowed at {INDEX_PATH.as_posix()}; found: {', '.join(mocs) or 'none'}")
    else:
        expected_logs = sorted(page.rel for page in log_pages(pages))
        moc_page = page_by_path[INDEX_PATH.as_posix()]
        indexed_logs: list[str] = []
        for target in links_in(moc_page.body):
            relative = canonical_relative(root, moc_page.path, target)
            if relative is not None and relative.as_posix() in expected_logs:
                indexed_logs.append(relative.as_posix())
        if sorted(indexed_logs) != expected_logs:
            errors.append(
                "work-log MOC is stale; run 'python wiki_memory/工具/memory_lint.py index' before check"
            )
        ordered_logs = sorted(log_pages(pages), key=log_sort_key, reverse=True)
        expected_rows = [render_log_row(page) for page in ordered_logs]
        actual_rows = [
            line
            for line in moc_page.body.splitlines()
            if re.match(r"^\| \d{4}-\d{2}-\d{2} \|", line)
        ]
        latest = max(
            (str(page.fields.get("updated", "")) for page in ordered_logs),
            default=date.today().isoformat(),
        )
        if actual_rows != expected_rows or str(moc_page.fields.get("updated", "")) != latest:
            errors.append(
                "work-log MOC rows or update date are stale; run 'python wiki_memory/工具/memory_lint.py index' before check"
            )

    incoming: dict[str, int] = {
        page.rel: 0
        for page in pages
        if is_managed(page.path)
    }
    for page in pages:
        for target in all_page_links(page):
            relative = canonical_relative(root, page.path, target)
            if relative is None:
                continue
            normalized = relative.as_posix()
            if normalized in incoming and normalized != page.rel:
                incoming[normalized] += 1
    for page in pages:
        if (
            is_managed(page.path)
            and page.page_type in {"state", "decision", "knowledge", "log"}
            and incoming[page.rel] == 0
        ):
            errors.append(f"orphan page: {page.rel}")

    return errors


def log_pages(pages: list[Page]) -> list[Page]:
    return [
        page
        for page in pages
        if page.page_type == "log" and page.path.parts[0] == "日志"
    ]


def log_sort_key(page: Page) -> tuple[str, str, int, str]:
    stem = page.path.stem
    match = re.search(r"-(\d{2})$", stem)
    base = stem[: match.start()] if match else stem
    sequence = int(match.group(1)) if match else 1
    return str(page.fields.get("updated", "")), base, sequence, page.rel


def render_log_row(page: Page) -> str:
    kind = str(page.fields.get("kind", "-"))
    status = page.status or "-"
    topic = page.topic or "-"
    project = page.project or "-"
    affected_value = page.fields.get("affected_projects", [])
    affected = (
        ", ".join(str(item) for item in affected_value)
        if isinstance(affected_value, list)
        else "-"
    )
    affected = affected or "-"
    title = display_title(page).replace("|", "\\|")
    goal = "-"
    for line in page.body.splitlines():
        if re.match(r"^[-*] `?目标`?：", line) or re.match(r"^[-*] (目标|本轮目标)：", line):
            goal = line.split("：", 1)[1].strip().replace("|", "\\|")
            break
    link = f"[[日志/{page.path.name}\\|{title}]]"
    return (
        f"| {page.fields.get('updated', '-')} | {project} | {affected} | {kind} | "
        f"{goal} | {status} | {topic} | {link} |"
    )


def index_logs(root: Path, pages: list[Page]) -> Path:
    logs = sorted(
        log_pages(pages),
        key=log_sort_key,
        reverse=True,
    )
    latest = max((str(page.fields.get("updated", "")) for page in logs), default=date.today().isoformat())
    lines = [
        "---",
        "type: moc",
        "status: active",
        "kind: process",
        "importance: high",
        f"updated: {latest}",
        "topic: trans-extension-work-log-index",
        "project: trans-extension",
        "affected_projects: [figma-zh-ui, github-zh-ui]",
        "source_logs: []",
        "supersedes: null",
        "---",
        "",
        "# 工作日志 MOC",
        "",
        "> 全仓唯一工作日志索引，按日期倒序；通过项目和影响项目区分根治理与两个插件。",
        "",
        "| 日期 | 项目 | 影响项目 | 类型 | 目标 | 页面状态 | 主题 | 日志 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    if not logs:
        lines.append("| - | - | - | - | 暂无记录 | - | - | - |")
    else:
        lines.extend(render_log_row(page) for page in logs)

    lines.extend(
        [
            "",
            "## 使用方式",
            "",
            "- 由 `python wiki_memory/工具/memory_lint.py index` 生成或刷新。",
            "- 查询时先阅读当前状态，再按项目、类型和关键词定位日志。",
            "- 历史日志是审计记录，不应直接覆盖当前状态。",
            "",
            "## 入口",
            "",
            "- [[README|TransExtension 总览]]",
            "- [[AGENTS|工程与记忆维护协议]]",
            "- [[日志/README|工作日志说明]]",
            "- [[当前状态/项目概览|当前项目概览]]",
            "- [[当前状态/系统架构|当前系统架构]]",
            "- [[知识/规范/工程记忆项目归属|项目归属规范]]",
            "",
        ]
    )
    output = root / INDEX_PATH
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return output


def run_check(root: Path) -> int:
    pages = load_pages(root)
    errors = validate_pages(root, pages)
    if errors:
        print(f"发现 {len(errors)} 个问题：")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"记忆体检通过：检查 {len(pages)} 个上下文页面。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "index"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        print(f"记忆根目录不存在：{root}", file=sys.stderr)
        return 2

    pages = load_pages(root)
    if args.command == "check":
        return run_check(root)

    output = index_logs(root, pages)
    print(f"已生成日志索引：{output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
