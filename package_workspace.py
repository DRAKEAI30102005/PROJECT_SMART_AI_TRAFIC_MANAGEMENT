from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "build",
    "__pycache__",
    ".vscode",
    ".idea",
}

EXCLUDE_FILES = {
    ".DS_Store",
    "thumbs.db",
}


def should_exclude(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    parts = set(rel.parts)
    if parts & EXCLUDE_DIRS:
        return True
    if path.name in EXCLUDE_FILES:
        return True
    return False


def create_zip(root: Path, output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_dir():
                continue
            if should_exclude(path, root):
                continue
            archive.write(path, path.relative_to(root))
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Package the current workspace into a zip archive.")
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional output zip path. Defaults to Desktop or workspace root.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(__file__).resolve().parent

    if args.output:
        output_path = args.output.expanduser().resolve()
    else:
        desktop = Path.home() / "Desktop"
        if desktop.exists():
            output_path = desktop / f"{root.name}.zip"
        else:
            output_path = root / f"{root.name}.zip"

    output_file = create_zip(root, output_path)
    print(f"Workspace packaged successfully: {output_file}")


if __name__ == "__main__":
    main()
