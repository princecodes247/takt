const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

interface ChordTemplate {
  suffix: string;
  intervals: number[];
  priority: number;
}

const CHORD_TEMPLATES: ChordTemplate[] = [
  { suffix: "", intervals: [0, 4, 7], priority: 10 },
  { suffix: "m", intervals: [0, 3, 7], priority: 10 },
  { suffix: "sus4", intervals: [0, 5, 7], priority: 8 },
  { suffix: "sus2", intervals: [0, 2, 7], priority: 8 },
  { suffix: "dim", intervals: [0, 3, 6], priority: 7 },
  { suffix: "aug", intervals: [0, 4, 8], priority: 7 },
  { suffix: "5", intervals: [0, 7], priority: 6 },
  { suffix: "maj7", intervals: [0, 4, 7, 11], priority: 9 },
  { suffix: "7", intervals: [0, 4, 7, 10], priority: 9 },
  { suffix: "m7", intervals: [0, 3, 7, 10], priority: 9 },
  { suffix: "m7b5", intervals: [0, 3, 6, 10], priority: 7 },
  { suffix: "dim7", intervals: [0, 3, 6, 9], priority: 7 },
  { suffix: "mMaj7", intervals: [0, 3, 7, 11], priority: 6 },
  { suffix: "7sus4", intervals: [0, 5, 7, 10], priority: 7 },
  { suffix: "6", intervals: [0, 4, 7, 9], priority: 7 },
  { suffix: "m6", intervals: [0, 3, 7, 9], priority: 7 },
  { suffix: "add9", intervals: [0, 2, 4, 7], priority: 8 },
  { suffix: "madd9", intervals: [0, 2, 3, 7], priority: 8 },
  { suffix: "maj9", intervals: [0, 2, 4, 7, 11], priority: 8 },
  { suffix: "9", intervals: [0, 2, 4, 7, 10], priority: 8 },
  { suffix: "m9", intervals: [0, 2, 3, 7, 10], priority: 8 },
];

export function detectChord(midiNotes: Iterable<number>): string | null {
  const sorted = Array.from(new Set(midiNotes)).sort((a, b) => a - b);
  if (sorted.length < 2) return null;

  const bassPc = sorted[0] % 12;
  const pcs = Array.from(new Set(sorted.map((n) => n % 12)));
  if (pcs.length < 2) return null;

  let bestName: string | null = null;
  let bestScore = -Infinity;

  for (const root of pcs) {
    const rel = new Set(pcs.map((pc) => (pc - root + 12) % 12));

    for (const tpl of CHORD_TEMPLATES) {
      if (tpl.intervals.length > rel.size) continue;
      const allPresent = tpl.intervals.every((iv) => rel.has(iv));
      if (!allPresent) continue;

      const extra = rel.size - tpl.intervals.length;
      if (extra > 1) continue;

      let score = tpl.priority * 10 - extra * 25;
      if (root === bassPc) score += 12;
      if (tpl.intervals.length === rel.size) score += 15;

      if (score > bestScore) {
        bestScore = score;
        const rootName = NOTE_NAMES[root];
        const slash = root !== bassPc ? `/${NOTE_NAMES[bassPc]}` : "";
        bestName = `${rootName}${tpl.suffix}${slash}`;
      }
    }
  }

  return bestName;
}

