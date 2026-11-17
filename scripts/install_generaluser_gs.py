#!/usr/bin/env python3
"""
Downloads GeneralUser GS (S. Christian Collins) and extracts selected GM presets
directly from the SF2 RIFF structure into assets/samples/<voice-id>/<note>.wav.
"""

import argparse
import re
import struct
import urllib.request
import wave
from pathlib import Path

GENERALUSER_URL = (
    "https://github.com/mrbumpy409/GeneralUser-GS/raw/main/GeneralUser-GS.sf2"
)

DEFAULT_PRESETS = {
    (0, 16): "gs-drawbar-organ",
    (0, 24): "gs-nylon-guitar",
    (0, 48): "gs-strings",
    (0, 52): "gs-choir-aahs",
    (0, 61): "gs-brass",
    (0, 89): "gs-warm-pad",
}


def gm_category(bank: int, prog: int) -> str:
    if bank == 128:
        return "GS · Drums"
    if prog <= 7:
        return "GS · Piano"
    if prog <= 15:
        return "GS · Chromatic"
    if prog <= 23:
        return "GS · Organ"
    if prog <= 31:
        return "GS · Guitar"
    if prog <= 39:
        return "GS · Bass"
    if prog <= 47:
        return "GS · Strings"
    if prog <= 55:
        return "GS · Ensemble"
    if prog <= 63:
        return "GS · Brass"
    if prog <= 79:
        return "GS · Reed & Pipe"
    if prog <= 87:
        return "GS · Synth Lead"
    if prog <= 95:
        return "GS · Synth Pad"
    if prog <= 119:
        return "GS · Ethnic & FX"
    return "GS · SFX"


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "preset"


def read_chunks(data: bytes, start: int, end: int):
    pos = start
    while pos + 8 <= end:
        cid = data[pos : pos + 4].decode("ascii", errors="replace")
        size = struct.unpack_from("<I", data, pos + 4)[0]
        body_start = pos + 8
        body_end = min(body_start + size, end)
        yield cid, body_start, body_end
        pos = body_end + (size & 1)


def parse_sf2(data: bytes):
    if data[:4] != b"RIFF" or data[8:12] != b"sfbk":
        raise ValueError("Not a valid SF2 file")

    smpl_start = smpl_end = 0
    pdta_chunks = {}

    for cid, s, e in read_chunks(data, 12, len(data)):
        if cid == "LIST":
            ltype = data[s : s + 4].decode("ascii", errors="replace")
            if ltype == "sdta":
                for scid, ss, se in read_chunks(data, s + 4, e):
                    if scid == "smpl":
                        smpl_start, smpl_end = ss, se
            elif ltype == "pdta":
                for pcid, ps, pe in read_chunks(data, s + 4, e):
                    pdta_chunks[pcid] = (ps, pe)

    def rec_iter(name, fmt):
        ps, pe = pdta_chunks[name]
        sz = struct.calcsize(fmt)
        return [
            struct.unpack_from(fmt, data, off)
            for off in range(ps, pe - (pe - ps) % sz, sz)
        ]

    phdr = rec_iter("phdr", "<20sHHHIII")
    pbag = rec_iter("pbag", "<HH")
    pgen = rec_iter("pgen", "<HH")
    inst = rec_iter("inst", "<20sH")
    ibag = rec_iter("ibag", "<HH")
    igen = rec_iter("igen", "<HH")
    shdr = rec_iter("shdr", "<20sIIIIIBbHH")

    return {
        "data": data,
        "smpl_start": smpl_start,
        "smpl_end": smpl_end,
        "phdr": phdr,
        "pbag": pbag,
        "pgen": pgen,
        "inst": inst,
        "ibag": ibag,
        "igen": igen,
        "shdr": shdr,
    }


def extract_preset(
    sf2,
    bank: int,
    prog: int,
    out_dir: Path,
    preset_name: str | None = None,
    category: str | None = None,
) -> int:
    phdr = sf2["phdr"]
    pbag = sf2["pbag"]
    pgen = sf2["pgen"]
    inst = sf2["inst"]
    ibag = sf2["ibag"]
    igen = sf2["igen"]
    shdr = sf2["shdr"]
    data = sf2["data"]
    smpl_start = sf2["smpl_start"]

    p_idx = next(
        (
            i
            for i in range(len(phdr) - 1)
            if phdr[i][2] == bank and phdr[i][1] == prog
        ),
        None,
    )
    if p_idx is None:
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    written_notes = set()
    loop_lines = []
    pbag_start = phdr[p_idx][3]
    pbag_end = phdr[p_idx + 1][3]

    # Collect referenced instrument indices
    inst_indices = []
    for pb in range(pbag_start, pbag_end):
        g_start = pbag[pb][0]
        g_end = pbag[pb + 1][0]
        for g in range(g_start, g_end):
            op, val = pgen[g]
            if op == 41:  # instrument
                inst_indices.append(val)

    for i_idx in inst_indices:
        if i_idx >= len(inst) - 1:
            continue
        ib_start = inst[i_idx][1]
        ib_end = inst[i_idx + 1][1]

        global_root = None
        for ib in range(ib_start, ib_end):
            g_start = ibag[ib][0]
            g_end = ibag[ib + 1][0]
            sample_id = None
            root_override = None
            key_lo, key_hi = 0, 127

            for g in range(g_start, g_end):
                op, val = igen[g]
                if op == 43:  # keyRange
                    key_lo = val & 0xFF
                    key_hi = (val >> 8) & 0xFF
                elif op == 58:  # overridingRootKey
                    root_override = val
                elif op == 53:  # sampleID
                    sample_id = val

            if sample_id is None:
                if root_override is not None:
                    global_root = root_override
                continue
            if sample_id >= len(shdr) - 1:
                continue

            sh = shdr[sample_id]
            s_start, s_end, s_loop_start, s_loop_end, sample_rate, orig_pitch, _, _, _ = sh[1:]
            root_note = root_override if root_override is not None else (
                global_root if global_root is not None else orig_pitch
            )
            if not (0 <= root_note <= 127):
                root_note = max(0, min(127, (key_lo + key_hi) // 2))

            if root_note in written_notes:
                continue

            byte_start = smpl_start + s_start * 2
            byte_end = smpl_start + s_end * 2
            if byte_end <= byte_start or byte_end > sf2["smpl_end"]:
                continue

            pcm = data[byte_start:byte_end]
            wav_path = out_dir / f"{root_note}.wav"
            with wave.open(str(wav_path), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                wf.writeframes(pcm)
            written_notes.add(root_note)

            if s_loop_start >= s_start and s_loop_end > s_loop_start + 32 and s_loop_end <= s_end:
                loop_lines.append(
                    f"{root_note} {s_loop_start - s_start} {s_loop_end - s_start}\n"
                )

    if loop_lines:
        (out_dir / "loops.txt").write_text("".join(loop_lines), encoding="utf-8")

    if written_notes and (preset_name or category):
        meta_lines = []
        if preset_name:
            meta_lines.append(f"name={preset_name}\n")
        if category:
            meta_lines.append(f"category={category}\n")
        (out_dir / "meta.txt").write_text("".join(meta_lines), encoding="utf-8")

    return len(written_notes)


def main() -> None:
    parser = argparse.ArgumentParser(description="Install GeneralUser GS presets into Takt")
    parser.add_argument("--list", action="store_true", help="List all presets in GeneralUser GS")
    parser.add_argument("--all", action="store_true", help="Extract all presets in GeneralUser GS")
    parser.add_argument(
        "--preset",
        action="append",
        help="Extra preset as bank:prog:folder (e.g. 0:1:gs-bright-piano)",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    sf2_dir = repo_root / "assets" / "soundfonts"
    sf2_dir.mkdir(parents=True, exist_ok=True)
    sf2_path = sf2_dir / "GeneralUser-GS.sf2"

    if not sf2_path.exists():
        print(f"Downloading GeneralUser GS from {GENERALUSER_URL} ...")
        urllib.request.urlretrieve(GENERALUSER_URL, sf2_path)

    sf2 = parse_sf2(sf2_path.read_bytes())

    if args.list:
        phdr = sf2["phdr"]
        for i in range(len(phdr) - 1):
            name = phdr[i][0].split(b"\x00", 1)[0].decode("ascii", errors="replace")
            prog, bank = phdr[i][1], phdr[i][2]
            print(f"{bank:03d}:{prog:03d}  {name}")
        return

    if args.all:
        phdr = sf2["phdr"]
        # Remove old curated gs-* folders so we don't duplicate presets
        samples_root = repo_root / "assets" / "samples"
        for old in samples_root.glob("gs-*"):
            if old.is_dir():
                for f in old.iterdir():
                    f.unlink()
                old.rmdir()

        total_presets = 0
        total_samples = 0
        for i in range(len(phdr) - 1):
            name = phdr[i][0].split(b"\x00", 1)[0].decode("ascii", errors="replace").strip()
            prog, bank = phdr[i][1], phdr[i][2]
            folder = f"gs-{bank:03d}-{prog:03d}-{slugify(name)}"
            cat = gm_category(bank, prog)
            out_dir = samples_root / folder
            count = extract_preset(sf2, bank, prog, out_dir, preset_name=name, category=cat)
            if count > 0:
                total_presets += 1
                total_samples += count
            elif out_dir.exists():
                out_dir.rmdir()
        print(f"Extracted {total_presets} presets ({total_samples} WAVs) into {samples_root}")
        return

    targets = dict(DEFAULT_PRESETS)
    if args.preset:
        for spec in args.preset:
            b, p, folder = spec.split(":", 2)
            targets[(int(b), int(p))] = folder

    for (bank, prog), folder in targets.items():
        out_dir = repo_root / "assets" / "samples" / folder
        count = extract_preset(sf2, bank, prog, out_dir, category=gm_category(bank, prog))
        print(f"Extracted {count} samples for {bank:03d}:{prog:03d} -> {out_dir}")


if __name__ == "__main__":
    main()
