#!/usr/bin/env python3
"""
Downloads and installs FM-Piano1 (FreePats)
into assets/samples/fm-piano1/<midi_note>_v<vel>.flac.
"""

import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

FM_PIANO_URL = (
    "https://github.com/freepats/fm-piano1/releases/download/"
    "2019-09-16/FM-Piano1-SFZ+FLAC-20190916.7z"
)

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

FILENAME_RE = re.compile(r"^([A-G][#b]?)(-?\d+)v(\d+)\.(flac|wav|ogg)$", re.IGNORECASE)


def note_name_to_midi(name: str, octave: int) -> int:
    return (octave + 1) * 12 + NOTE_PC[name]


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "assets" / "samples" / "fm-piano1"
    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="fm_piano1_") as tmp:
        archive_path = Path(tmp) / "fm_piano1.7z"
        extract_dir = Path(tmp) / "extracted"
        extract_dir.mkdir()

        print(f"Downloading FM-Piano1 from {FM_PIANO_URL} ...")
        urllib.request.urlretrieve(FM_PIANO_URL, archive_path)

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
                note_str, oct_str, vel_str, ext = m.groups()
                midi_note = note_name_to_midi(note_str, int(oct_str))
                vel = max(1, min(127, int(vel_str)))
                if not (21 <= midi_note <= 108):
                    continue
                src = Path(root) / fname
                dest = out_dir / f"{midi_note}_v{vel}.{ext.lower()}"
                shutil.copy2(src, dest)
                copied += 1

        print(f"Installed {copied} FLAC samples into {out_dir}")


if __name__ == "__main__":
    main()

