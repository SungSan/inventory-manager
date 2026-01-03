"""Inventory management CLI.

기능 개요:
- 입고/출고 기록 시 아티스트, 품목, 로케이션, 수량, 시각 저장
- 현재 재고 및 월별 기초재고 추적
- 일/월/연/품목/아티스트별 검색 및 요약
- 월 전환 시 직전 재고를 기초재고로 자동 설정
- 검색 결과를 엑셀(xlsx)로 내보내기
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import shutil
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional


def _default_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home()))
        return base / "InventoryCLI"
    return Path.home() / ".inventory_cli"


def _resolve_data_file() -> Path:
    env_override = os.environ.get("INVENTORY_DATA_FILE")
    if env_override:
        return Path(env_override)

    if not getattr(sys, "frozen", False):
        script_location = Path(__file__).resolve().parent / "inventory_data.json"
        return script_location

    data_dir = _default_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "inventory_data.json"


DATA_FILE = _resolve_data_file()


@dataclass
class Transaction:
    type: str  # "in" or "out"
    artist: str
    item: str
    option: str
    location: str
    quantity: int
    timestamp: datetime
    category: str = "album"
    actor: str = ""
    description: str = ""
    event: bool = False
    event_id: str = ""
    event_open: bool = False

    @property
    def period(self) -> str:
        return self.timestamp.strftime("%Y-%m")

    @property
    def day(self) -> str:
        return self.timestamp.date().isoformat()

    @property
    def year(self) -> str:
        return self.timestamp.strftime("%Y")

    def to_dict(self) -> Dict[str, str]:
        return {
            "type": self.type,
            "artist": self.artist,
            "item": self.item,
            "category": self.category,
            "option": self.option,
            "location": self.location,
            "quantity": self.quantity,
            "timestamp": self.timestamp.isoformat(),
            "actor": self.actor,
            "period": self.period,
            "day": self.day,
            "year": self.year,
            "description": self.description,
            "event": self.event,
            "event_id": self.event_id,
            "event_open": self.event_open,
        }


def load_data() -> Dict:
    def _empty() -> Dict:
        return {
            "current_period": None,
            "periods": {},
            "stock": {},
            "history": [],
            "item_metadata": {},
            "last_updated": None,
            "activity_log": [],
        }

    if not DATA_FILE.exists():
        return _empty()

    try:
        with DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:  # pragma: no cover - startup recovery
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = DATA_FILE.with_suffix(f".corrupt_{timestamp}.json")
        try:
            shutil.move(DATA_FILE, backup_path)
        except Exception:
            backup_path = None
        fresh = _empty()
        fresh["last_updated"] = datetime.now().isoformat()
        fresh["last_load_error"] = {
            "error": repr(exc),
            "corrupt_backup": str(backup_path) if backup_path else None,
            "recovered_at": fresh["last_updated"],
        }
        return fresh

    _ensure_new_schema(data)
    data.setdefault("last_updated", None)
    return data


def save_data(data: Dict, *, update_timestamp: bool = True) -> None:
    if update_timestamp:
        data["last_updated"] = datetime.now().isoformat()
    _write_backup(data)
    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def backup_data(data: Dict) -> None:
    """Public wrapper to trigger a backup without modifying data contents."""

    _write_backup(data, force=True)


def backup_data_with_label(data: Dict, label: str, *, keep: int = 10) -> Path:
    """Persist a timestamped backup with a descriptive label.

    This is useful for storing special snapshots (e.g. before Google sync).
    """

    return _write_backup(data, label=label, keep=keep, force=True)


def restore_backup(path: str) -> Dict:
    """Load a backup JSON file and persist it as the active dataset.

    Missing top-level keys are initialized so older backups remain compatible
    after program updates.
    """

    backup_path = Path(path)
    if not backup_path.exists():
        raise FileNotFoundError(f"백업 파일을 찾을 수 없습니다: {backup_path}")
    with backup_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    data.setdefault("current_period", None)
    data.setdefault("periods", {})
    data.setdefault("stock", {})
    data.setdefault("history", [])
    data.setdefault("item_metadata", {})
    data.setdefault("last_updated", None)
    _ensure_new_schema(data)

    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return data


_LAST_BACKUP_MONO = 0.0
_LAST_BACKUP_PATH: Optional[Path] = None


def _write_backup(data: Dict, *, label: Optional[str] = None, keep: int = 10, force: bool = False) -> Path:
    """Persist a timestamped backup alongside the primary data file.

    The backup keeps recent revisions so schema-compatible files remain
    available even after program updates.
    """

    backup_dir = DATA_FILE.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    global _LAST_BACKUP_MONO, _LAST_BACKUP_PATH
    now = time.monotonic()
    if not force and _LAST_BACKUP_PATH is not None and now - _LAST_BACKUP_MONO < 120:
        return _LAST_BACKUP_PATH

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    label_part = f"_{label}" if label else ""
    backup_path = backup_dir / f"{DATA_FILE.stem}{label_part}_{timestamp}.json"
    with backup_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    pattern = f"{DATA_FILE.stem}{label_part}_*.json"
    backups = sorted(backup_dir.glob(pattern))
    for old in backups[:-keep]:
        old.unlink(missing_ok=True)

    _LAST_BACKUP_MONO = now
    _LAST_BACKUP_PATH = backup_path
    return backup_path


def normalize_item(value: str) -> str:
    return value.strip()


def normalize_location(value: str) -> str:
    return value.strip()


def normalize_category(value: Optional[str]) -> str:
    if not value:
        return "album"
    cleaned = value.strip().lower()
    if cleaned in {"md", "md/굿즈", "merch", "굿즈"}:
        return "md"
    if cleaned in {"album", "앨범"}:
        return "album"
    return cleaned or "album"


def ensure_period(data: Dict, period: str) -> None:
    _ensure_new_schema(data)
    current = data.get("current_period")
    periods = data.setdefault("periods", {})
    if period in periods:
        return
    if current and period < current:
        # 과거 월은 이미 확정된 기초재고를 덮어쓰지 않도록 현재 월을 유지한다.
        return
    if current == period:
        return
    stock_snapshot = deepcopy(data.get("stock", {}))
    periods[period] = {
        "opening_stock": stock_snapshot,
        "created_at": datetime.now().isoformat(),
    }
    data["current_period"] = period


def _option_key(option: str) -> str:
    return option or ""


def _ensure_new_schema(data: Dict) -> None:
    """Upgrade legacy stock layouts that lacked option separation.

    Older data stored stock as {item: {location: qty}}. We now store
    {item: {option: {location: qty}}} so 동일한 품목의 서로 다른 옵션이
    합산되지 않는다. This upgrader wraps legacy location maps under the
    empty-string option key.
    """

    stock = data.get("stock")
    if not isinstance(stock, dict):
        data["stock"] = {}
        return
    changed = False
    for item, value in list(stock.items()):
        if not isinstance(value, dict):
            stock[item] = {"": {}}
            changed = True
            continue
        if value and all(isinstance(qty, int) for qty in value.values()):
            stock[item] = {"": value}
            changed = True
    if changed:
        data["stock"] = stock

    metadata = data.setdefault("item_metadata", {})
    for info in metadata.values():
        if not isinstance(info, dict):
            continue
        if not isinstance(info.get("last_audit"), dict):
            info["last_audit"] = {}

    for period_info in data.get("periods", {}).values():
        opening = period_info.get("opening_stock")
        if not isinstance(opening, dict):
            period_info["opening_stock"] = {}
            continue
        migrated = False
        for item, value in list(opening.items()):
            if value and all(isinstance(qty, int) for qty in value.values()):
                opening[item] = {"": value}
                migrated = True
        if migrated:
            period_info["opening_stock"] = opening

    history = data.get("history", [])
    for entry in history:
        entry.setdefault("event", False)
        entry.setdefault("event_id", "")
        entry.setdefault("event_open", False)
        entry.setdefault("category", "album")

    for _item, info in data.get("item_metadata", {}).items():
        if isinstance(info, dict) and not info.get("category"):
            info["category"] = "album"


def update_stock(data: Dict, item: str, option: str, location: str, quantity: int) -> None:
    data.setdefault("stock", {})
    _ensure_new_schema(data)
    option_map = data["stock"].setdefault(item, {})
    locations = option_map.setdefault(_option_key(option), {})
    locations[location] = locations.get(location, 0) + quantity


def record_transaction(data: Dict, transaction: Transaction, *, allow_negative: bool = False) -> None:
    ensure_period(data, transaction.period)
    _ensure_new_schema(data)
    metadata = data.setdefault("item_metadata", {})
    info = metadata.setdefault(transaction.item, {})
    existing_artist = info.get("artist")
    if existing_artist and existing_artist != transaction.artist:
        raise ValueError(
            f"이미 '{transaction.item}' 은(는) {existing_artist}로 등록되어 있습니다. 동일한 아티스트만 사용할 수 있습니다."
        )
    info["artist"] = transaction.artist
    info["category"] = normalize_category(transaction.category)
    if transaction.option:
        info["option"] = transaction.option
    if transaction.type == "out":
        option_key = _option_key(transaction.option)
        available = (
            data.get("stock", {})
            .get(transaction.item, {})
            .get(option_key, {})
            .get(transaction.location, 0)
        )
        if available < transaction.quantity and not allow_negative:
            raise ValueError(
                f"재고 부족: {transaction.item}({transaction.location}) 현재 {available}개, 요청 {transaction.quantity}개"
            )
        update_stock(data, transaction.item, transaction.option, transaction.location, -transaction.quantity)
    else:
        update_stock(data, transaction.item, transaction.option, transaction.location, transaction.quantity)
    entry = transaction.to_dict()
    data.setdefault("history", []).append(entry)


def iter_history(data: Dict) -> Iterable[Dict]:
    return data.get("history", [])


def filter_history(
    history: Iterable[Dict],
    *,
    day: Optional[str] = None,
    month: Optional[str] = None,
    year: Optional[str] = None,
    artist: Optional[str] = None,
    start_day: Optional[str] = None,
    end_day: Optional[str] = None,
) -> List[Dict]:
    filtered = []
    start = datetime.fromisoformat(start_day).date() if start_day else None
    end = datetime.fromisoformat(end_day).date() if end_day else None
    for entry in history:
        entry_day_str = entry.get("day")
        if start or end:
            if not entry_day_str:
                continue
            try:
                entry_day = datetime.fromisoformat(entry_day_str).date()
            except ValueError:
                continue
            if start and entry_day < start:
                continue
            if end and entry_day > end:
                continue
        if day and entry.get("day") != day:
            continue
        if month and entry.get("period") != month:
            continue
        if year and entry.get("year") != year:
            continue
        if artist and entry.get("artist") != artist:
            continue
        filtered.append(entry)
    return filtered


def summarize(entries: Iterable[Dict]) -> Dict[str, Dict[str, Dict[str, int]]]:
    summary: Dict[str, Dict[str, Dict[str, int]]] = {}
    for entry in entries:
        item = entry["item"]
        option = _option_key(entry.get("option", ""))
        location = entry["location"]
        sign = 1 if entry["type"] == "in" else -1
        option_map = summary.setdefault(item, {})
        locations = option_map.setdefault(option, {})
        locations[location] = locations.get(location, 0) + sign * entry["quantity"]
    return summary


def format_stock_table(
    stock: Dict[str, Dict[str, Dict[str, int]]], *, metadata: Optional[Dict[str, Dict[str, str]]] = None, include_artist: bool = True
) -> str:
    rows = []
    for item in sorted(stock):
        for option in sorted(stock[item]):
            for location in sorted(stock[item][option]):
                artist = None
                if metadata:
                    artist = metadata.get(item, {}).get("artist")
                rows.append((artist, item, option or "-", location, stock[item][option][location]))
    if not rows:
        return "(데이터 없음)"
    item_width = max(len(r[1]) for r in rows)
    opt_width = max(len(r[2]) for r in rows)
    loc_width = max(len(r[3]) for r in rows)
    if include_artist:
        artist_width = max(len(r[0] or "-") for r in rows)
        header = f"{'아티스트':<{artist_width}}  {'품목':<{item_width}}  {'옵션':<{opt_width}}  {'로케이션':<{loc_width}}  수량"
    else:
        artist_width = 0
        header = f"{'품목':<{item_width}}  {'옵션':<{opt_width}}  {'로케이션':<{loc_width}}  수량"
    lines = [header]
    for artist, item, option, location, qty in rows:
        if include_artist:
            lines.append(
                f"{(artist or '-'):<{artist_width}}  {item:<{item_width}}  {option:<{opt_width}}  {location:<{loc_width}}  {qty}"
            )
        else:
            lines.append(f"{item:<{item_width}}  {option:<{opt_width}}  {location:<{loc_width}}  {qty}")
    return "\n".join(lines)


def filter_stock_by_artist(
    stock: Dict[str, Dict[str, Dict[str, int]]], metadata: Dict[str, Dict[str, str]], artist: str
) -> Dict[str, Dict[str, Dict[str, int]]]:
    filtered: Dict[str, Dict[str, Dict[str, int]]] = {}
    for item, options in stock.items():
        if metadata.get(item, {}).get("artist") != artist:
            continue
        filtered[item] = options
    return filtered


def summarize_stock_by_artist(stock: Dict[str, Dict[str, Dict[str, int]]], metadata: Dict[str, Dict[str, str]]) -> Dict[str, int]:
    summary: Dict[str, int] = {}
    for item, options in stock.items():
        artist = metadata.get(item, {}).get("artist", "미분류")
        summary.setdefault(artist, 0)
        for locations in options.values():
            summary[artist] += sum(locations.values())
    return summary


def format_artist_summary(summary: Dict[str, int]) -> str:
    if not summary:
        return "(데이터 없음)"
    width = max(len(name) for name in summary)
    lines = [f"{'아티스트':<{width}}  수량"]
    for artist in sorted(summary):
        lines.append(f"{artist:<{width}}  {summary[artist]}")
    return "\n".join(lines)


def determine_artist(data: Dict, item: str, provided: Optional[str]) -> str:
    metadata = data.setdefault("item_metadata", {})
    info = metadata.get(item)
    if provided:
        artist = provided.strip()
        if not artist:
            raise ValueError("아티스트명을 입력해 주세요.")
        if info and info.get("artist") not in (None, artist):
            raise ValueError(
                f"이미 '{item}' 은(는) {info['artist']}로 등록되어 있습니다. 동일한 아티스트만 사용할 수 있습니다."
            )
        metadata.setdefault(item, {})["artist"] = artist
        return artist
    if info and info.get("artist"):
        return info["artist"]
    raise ValueError("아티스트를 찾을 수 없습니다. --artist 옵션으로 아티스트명을 지정해 주세요.")


def determine_category(data: Dict, item: str, provided: Optional[str]) -> str:
    metadata = data.setdefault("item_metadata", {})
    info = metadata.get(item, {})
    if provided:
        category = normalize_category(provided)
        info.setdefault("category", category)
        return category
    if info.get("category"):
        return normalize_category(info["category"])
    category = "album"
    info["category"] = category
    return category


def export_to_xlsx(entries: List[Dict], path: str, *, include_summary: bool) -> None:
    try:
        from openpyxl import Workbook
    except ImportError as exc:
        raise RuntimeError("openpyxl 모듈이 필요합니다. 'pip install openpyxl' 로 설치해 주세요.") from exc

    wb = Workbook()
    ws = wb.active
    ws.title = "Transactions"
    headers = [
        "타입",
        "아티스트",
        "품목",
        "구분",
        "옵션",
        "로케이션",
        "수량",
        "기록시각",
        "일자",
        "월",
        "연",
        "상세내용",
        "작성자",
    ]
    ws.append(headers)
    for entry in entries:
        ws.append(
            [
                entry.get("type"),
                entry.get("artist"),
                entry.get("item"),
                entry.get("category", ""),
                entry.get("option", ""),
                entry.get("location"),
                entry.get("quantity"),
                entry.get("timestamp"),
                entry.get("day"),
                entry.get("period"),
                entry.get("year"),
                entry.get("description", ""),
                entry.get("actor", ""),
            ]
        )
    if include_summary:
        ws2 = wb.create_sheet("Summary")
        ws2.append(["품목", "로케이션", "수량"])
        summary = summarize(entries)
        for item, locations in summary.items():
            for location, qty in locations.items():
                ws2.append([item, location, qty])
    wb.save(path)
    print(f"엑셀 파일로 저장했습니다: {path}")


def handle_receive(args: argparse.Namespace) -> None:
    data = load_data()
    item = normalize_item(args.item)
    artist = determine_artist(data, item, args.artist)
    category = determine_category(data, item, getattr(args, "category", None))
    transaction = Transaction(
        type="in",
        artist=artist,
        item=item,
        category=category,
        option=args.option or "",
        location=normalize_location(args.location),
        quantity=args.quantity,
        timestamp=args.timestamp or datetime.now(),
        description=args.description or "",
    )
    record_transaction(data, transaction)
    save_data(data)
    print("입고 완료. 현재 재고:")
    print(format_stock_table(data.get("stock", {}), metadata=data.get("item_metadata", {})))


def handle_dispatch(args: argparse.Namespace) -> None:
    data = load_data()
    item = normalize_item(args.item)
    artist = determine_artist(data, item, args.artist)
    category = determine_category(data, item, getattr(args, "category", None))
    transaction = Transaction(
        type="out",
        artist=artist,
        item=item,
        category=category,
        option=args.option or "",
        location=normalize_location(args.location),
        quantity=args.quantity,
        timestamp=args.timestamp or datetime.now(),
        description=args.description or "",
    )
    record_transaction(data, transaction)
    save_data(data)
    print("출고 완료. 현재 재고:")
    print(format_stock_table(data.get("stock", {}), metadata=data.get("item_metadata", {})))


def handle_stock(args: argparse.Namespace) -> None:
    data = load_data()
    metadata = data.get("item_metadata", {})
    stock = data.get("stock", {})
    if args.artist:
        stock = filter_stock_by_artist(stock, metadata, args.artist)
    print("현재 재고")
    print(format_stock_table(stock, metadata=metadata, include_artist=not args.artist))
    if args.group_by_artist:
        print("\n아티스트별 합계")
        print(format_artist_summary(summarize_stock_by_artist(stock, metadata)))
    if args.opening:
        period = data.get("current_period")
        if not period:
            print("\n현재 월 정보가 없습니다.")
        else:
            opening = data.get("periods", {}).get(period, {}).get("opening_stock", {})
            print(f"\n{period} 기초재고")
            print(format_stock_table(opening, metadata=metadata))


def handle_search(args: argparse.Namespace) -> None:
    data = load_data()
    if not any([args.day, args.month, args.year, args.start_day, args.end_day]):
        print("검색 조건을 하나 이상 지정해 주세요 (--day/--month/--year 또는 --start-day/--end-day).")
        return
    entries = filter_history(
        iter_history(data),
        day=args.day,
        month=args.month,
        year=args.year,
        artist=args.artist,
        start_day=args.start_day,
        end_day=args.end_day,
    )
    if not entries:
        print("조건에 해당하는 데이터가 없습니다.")
        return
    lines = []
    for entry in entries:
        sign = "+" if entry["type"] == "in" else "-"
        option = entry.get("option")
        option_part = f" | {option}" if option else ""
        lines.append(
            f"{entry['timestamp']} | {entry['item']}{option_part} | {entry['location']} | {sign}{entry['quantity']}"
        )
    print("\n".join(lines))
    if args.summary:
        print("\n요약")
        print(format_stock_table(summarize(entries), metadata=data.get("item_metadata", {})))
    if args.export_xlsx:
        export_to_xlsx(entries, args.export_xlsx, include_summary=args.summary)


def handle_start_period(args: argparse.Namespace) -> None:
    period = args.month or datetime.now().strftime("%Y-%m")
    data = load_data()
    ensure_period(data, period)
    save_data(data)
    print(f"현재 월을 {period}로 설정했습니다.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="재고 관리 프로그램")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("--item", required=True, help="품목명")
        subparser.add_argument("--artist", help="아티스트명")
        subparser.add_argument("--category", help="구분 (album/md). 생략 시 앨범")
        subparser.add_argument("--option", help="옵션/버전")
        subparser.add_argument("--location", required=True, help="로케이션 위치")
        subparser.add_argument("--quantity", type=int, required=True, help="수량")
        subparser.add_argument(
            "--timestamp",
            type=lambda value: datetime.fromisoformat(value),
            help="ISO8601 형식의 기록 시간 (예: 2023-08-01T09:00)",
        )
        subparser.add_argument("--description", help="상세 내용")

    receive = sub.add_parser("receive", help="입고 기록")
    add_common(receive)
    receive.set_defaults(func=handle_receive)

    dispatch = sub.add_parser("dispatch", help="출고 기록")
    add_common(dispatch)
    dispatch.set_defaults(func=handle_dispatch)

    stock = sub.add_parser("stock", help="현재 재고 확인")
    stock.add_argument("--artist", help="특정 아티스트만 필터링")
    stock.add_argument("--opening", action="store_true", help="기초재고 표시")
    stock.add_argument("--group-by-artist", action="store_true", help="아티스트별 합계 표시")
    stock.set_defaults(func=handle_stock)

    search = sub.add_parser("search", help="기간별 입출고 조회")
    group = search.add_mutually_exclusive_group(required=False)
    group.add_argument("--day", help="YYYY-MM-DD")
    group.add_argument("--month", help="YYYY-MM")
    group.add_argument("--year", help="YYYY")
    search.add_argument("--start-day", help="YYYY-MM-DD 시작일")
    search.add_argument("--end-day", help="YYYY-MM-DD 종료일")
    search.add_argument("--summary", action="store_true", help="품목/로케이션별 합계")
    search.add_argument("--artist", help="특정 아티스트만 필터링")
    search.add_argument("--export-xlsx", help="검색 결과를 엑셀 파일로 저장")
    search.set_defaults(func=handle_search)

    period = sub.add_parser("start-period", help="새 월 시작")
    period.add_argument("--month", help="YYYY-MM 형식. 생략 시 현재 날짜 기준")
    period.set_defaults(func=handle_start_period)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
