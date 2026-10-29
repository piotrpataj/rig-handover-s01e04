import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { DigestCounts } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type NightSummary = {
  night: string;
  href: string;
  counts: DigestCounts;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightSummary[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Calendar-invalid names such as 2026-02-30.jsonl are skipped; other read errors still throw.
function summarizeNights(runsDir: string): NightSummary[] {
  const summaries: NightSummary[] = [];
  for (const night of nightsOnDisk(runsDir)) {
    try {
      summaries.push({ night, href: `/digest/${night}`, counts: readNight(runsDir, night).counts });
    } catch (error: unknown) {
      if (error instanceof RangeError) continue;
      throw error;
    }
  }
  return summaries;
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: summarizeNights(config.runsDir),
  };
}
