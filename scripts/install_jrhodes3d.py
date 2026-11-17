#!/usr/bin/env python3
"""
Downloads and installs jRhodes3d (Jeff Learman, 1977 Fender Rhodes Stage 73)
into assets/samples/jrhodes3d-stereo and assets/samples/jrhodes3d-tremolo.
"""

import os
import re
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

JRHODES_URL = (
    "https://github.com/sfzinstruments/jlearman.jRhodes3d/archive/refs/heads/master.zip"
)

LAYER_TO_VEL = {
    1: 25,
    2: 50,
    3: 75,
    4: 100,
    5: 122,
}

# Matches e.g. A_060__C4_3.flac, A_060__C4_3-ST.flac, A_060__C4_3-SV.flac
FILENAME_RE = re.compile(
    r"^[A-Z]+_(\d{3})__[A-G][#b]?-?\d+_(\d+)(?:-[A-Z]+)?\.flac$",
    re.IGNORECASE,
)

VARIANTS = {
    "jRhodes3d-st": ("jrhodes3d-stereo", "jRhodes 3D Stereo"),
    "jRhodes3d-sv": ("jrhodes3d-tremolo", "jRhodes 3D Tremolo"),
}


def install_from_zip(zip_path: Path, samples_root: Path) -> None:
    counts = {folder: 0 for folder, _ in VARIANTS.values()}
    for folder, display_name in VARIANTS.values():
        out_dir = samples_root / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "meta.txt").write_text(
            f"name={display_name}\ncategory=Electric Pianos\n",
            encoding="utf-8",
        )

    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            parts = Path(info.filename).parts
            if len(parts) < 3:
                continue
            variant_dir = parts[-2]
            if variant_dir not in VARIANTS:
                continue
            m = FILENAME_RE.match(parts[-1])
            if not m:
                continue
            midi_note = int(m.group(1))
            layer = int(m.group(2))
            if not (21 <= midi_note <= 108) or layer not in LAYER_TO_VEL:
                continue

            folder, _ = VARIANTS[variant_dir]
            vel = LAYER_TO_VEL[layer]
            dest = samples_root / folder / f"{midi_note}_v{vel}.flac"
            with zf.open(info, "r") as src, open(dest, "wb") as dst:
                shutil.copyfileobj(src, dst)
            counts[folder] += 1

    for folder, count in counts.items():
        print(f"Installed {count} FLAC samples into {samples_root / folder}")


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    samples_root = repo_root / "assets" / "samples"
    cached_zip = Path("/tmp/jrhodes3d.zip")

    if cached_zip.exists():
        install_from_zip(cached_zip, samples_root)
        cached_zip.unlink()
        return

    with tempfile.TemporaryDirectory(prefix="jrhodes3d_") as tmp:
        zip_path = Path(tmp) / "jrhodes3d.zip"
        print(f"Downloading jRhodes3d from {JRHODES_URL} ...")
        urllib.request.urlretrieve(JRHODES_URL, zip_path)
        install_from_zip(zip_path, samples_root)


if __name__ == "__main__":
    main()
