#!/usr/bin/env python3
"""
Downloads a balanced 4-velocity-layer subset of the open-source
Salamander Grand Piano (CC-BY 3.0, Alexander Holm / FreePats)
into assets/samples/salamander-grand/<midi_note>_v<vel>.ogg.
"""

import os
import re
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

SALAMANDER_URL = (
    "https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/"
    "SalamanderGrandPiano-SFZ+FLAC-V3+20200602.tar.gz"
)

# Map Salamander's 16 layers (v1..v16) to a compact 4-layer MIDI velocity set
LAYER_TO_VEL = {
    2: 30,
    6: 65,
    11: 95,
    16: 122,
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

FILENAME_RE = re.compile(r"^([A-G][#b]?)(-?\d+)v(\d+)\.(flac|wav|ogg)$", re.IGNORECASE)


def note_name_to_midi(name: str, octave: int) -> int:
    pc = NOTE_PC[name]
    return (octave + 1) * 12 + pc


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "assets" / "samples" / "salamander-grand"
    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="salamander_") as tmp:
        archive_path = Path(tmp) / "salamander.tar.gz"
        print(f"Downloading Salamander Grand Piano from {SALAMANDER_URL} ...")
        urllib.request.urlretrieve(SALAMANDER_URL, archive_path)

        print("Extracting 4-velocity-layer FLAC subset...")
        copied = 0
        with tarfile.open(archive_path, mode="r:gz") as tf:
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                basename = os.path.basename(member.name)
                m = FILENAME_RE.match(basename)
                if not m:
                    continue
                note_str, oct_str, layer_str, ext = m.groups()
                layer = int(layer_str)
                if layer not in LAYER_TO_VEL:
                    continue
                midi_note = note_name_to_midi(note_str, int(oct_str))
                if not (21 <= midi_note <= 108):
                    continue
                vel = LAYER_TO_VEL[layer]
                dest = out_dir / f"{midi_note}_v{vel}.{ext.lower()}"
                src_file = tf.extractfile(member)
                if src_file is None:
                    continue
                with open(dest, "wb") as dst_file:
                    shutil.copyfileobj(src_file, dst_file)
                copied += 1

        print(f"Installed {copied} samples into {out_dir}")


if __name__ == "__main__":
    main()

