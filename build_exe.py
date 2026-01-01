"""Helper script to package the inventory CLI into an executable via PyInstaller."""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "PyInstaller 빌드를 자동화합니다. Windows에서 실행하면 inventory_cli.exe를, "
            "macOS/Linux에서는 각 플랫폼 실행파일을 dist/ 폴더에 생성합니다."
        )
    )
    parser.add_argument(
        "--name",
        default="inventory_cli",
        help="생성될 실행 파일 이름 (확장자는 PyInstaller가 자동으로 붙입니다)",
    )
    parser.add_argument(
        "--onedir",
        action="store_true",
        help="다중 파일(onedir) 모드로 빌드합니다",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="기존 build/ 와 dist/ 폴더를 제거한 뒤 빌드",
    )
    parser.add_argument(
        "--target",
        choices=["cli", "gui"],
        default="cli",
        help="CLI(inventory.py) 또는 GUI(inventory_gui.py) 중 어떤 진입점을 빌드할지 선택",
    )
    return parser.parse_args()


def ensure_pyinstaller() -> None:
    if shutil.which("pyinstaller"):
        return
    raise SystemExit(
        "pyinstaller 명령을 찾을 수 없습니다. 'pip install pyinstaller' 로 설치한 뒤 다시 실행하세요."
    )


def build_executable(entry: str, name: str, mode: str, clean: bool, windowed: bool) -> None:
    ensure_pyinstaller()

    if clean:
        for folder in (Path("build"), Path("dist")):
            if folder.exists():
                shutil.rmtree(folder)

    data_file = Path("inventory_data.json")
    datas: list[str] = []
    if data_file.exists():
        sep = ";" if os.name == "nt" else ":"
        datas = ["--add-data", f"{data_file}{sep}."]

    mode_flag = "--onedir" if mode == "onedir" else "--onefile"

    cmd = [
        "pyinstaller",
        entry,
        mode_flag,
        "--name",
        name,
        "--noconfirm",
    ] + datas
    if windowed:
        cmd.append("--windowed")

    print("실행 명령:", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    args = parse_args()
    mode = "onedir" if args.onedir else "onefile"
    entry = "inventory_gui.py" if args.target == "gui" else "inventory.py"
    windowed = args.target == "gui"
    build_executable(entry, args.name, mode, args.clean, windowed)


if __name__ == "__main__":
    main()
