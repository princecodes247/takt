#!/usr/bin/env python3
"""
Downloads and installs UprightPianoKW (CC0, FreePats)
into assets/samples/upright-piano-kw/<midi_note>_v<vel>.flac.
"""

import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

UPRIGHT_URL = (
    "https://freepats.zenvoid.org/Piano/UprightPianoKW/"
    "UprightPianoKW-SFZ+FLAC-20220221.7z"
)

LAYER_TO_VEL = {
    "L": 45,
    "H": 110,
}

NOTE_PC = {
    "C": 0,
    "C#": 1,
    "Db": 1,
    "D": 2,
    "D#": 3,
    "Eb": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "Gb": 6,
    "G": 7,
    "G#": 8,
    "Ab": 8,
    "A": 9,
    "A#": 10,
    "Bb": 10,
    "B": 11,
}

FILENAME_RE = re.compile(r"^([A-G][#b]?)(-?\d+)v([LH])\.(flac|wav|ogg)$", re.IGNORECASE)


def note_name_to_midi(name: str, octave: int) -> int:
    return (octave + 1) * 12 + NOTE_PC[name]


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "assets" / "samples" / "upright-piano-kw"
    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="upright_kw_") as tmp:
        archive_path = Path(tmp) / "upright.7z"
        extract_dir = Path(tmp) / "extracted"
        extract_dir.mkdir()

        print(f"Downloading UprightPianoKW from {UPRIGHT_URL} ...")
        urllib.request.urlretrieve(UPRIGHT_URL, archive_path)

        print("Extracting archive...")
        subprocess.run(
            ["/usr/bin/tar", "-xf", str(archive_path), "-C", str(extract_dir)],
            check=True,
        )

        copied = 0
        for root, _, files in os.walk(extract_dir):
            for fname in files:
                m = FILENAME_RE.match(fname)
                if not m:
                    continue
                note_str, oct_str, layer_key, ext = m.groups()
                midi_note = note_name_to_midi(note_str, int(oct_str))
                if not (21 <= midi_note <= 108):
                    continue
                vel = LAYER_TO_VEL[layer_key.upper()]
                src = Path(root) / fname
                dest = out_dir / f"{midi_note}_v{vel}.{ext.lower()}"
                shutil.copy2(src, dest)
                copied += 1

        print(f"Installed {copied} FLAC samples into {out_dir}")


if __name__ == "__main__":
    main()

