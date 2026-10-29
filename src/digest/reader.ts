import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

type JobState = {
  row: DigestRow;
  firstTime: number;
  lastTime: number;
  errorTime: number;
};

function isNight(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isNight(value.slice(0, 10))
    && Number.isFinite(Date.parse(value));
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'at' in value && isTimestamp(value.at)
    && 'job' in value && typeof value.job === 'string' && value.job.trim().length > 0
    && 'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && 'owner' in value && (typeof value.owner === 'string' || value.owner === null)
    && (!('error' in value) || typeof value.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) throw new RangeError('Night must be a calendar-valid YYYY-MM-DD date');

  const counts = { ok: 0, retry: 0, fail: 0 };
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { night, found: false, rows: [], counts, invalidLines: 0 };
    }
    throw error;
  }

  const jobs = new Map<string, JobState>();
  let invalidLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      invalidLines += 1;
      continue;
    }
    if (!isRunEvent(event)) {
      invalidLines += 1;
      continue;
    }

    counts[event.status] += 1;
    const time = Date.parse(event.at);
    const state = jobs.get(event.job);
    if (!state) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
          hasFailure: event.status === 'fail',
        },
        firstTime: time,
        lastTime: time,
        errorTime: event.error === undefined ? -Infinity : time,
      });
      continue;
    }

    const row = state.row;
    row.runs += 1;
    row.retries += event.status === 'retry' ? 1 : 0;
    row.hasFailure ||= event.status === 'fail';
    if (time <= state.firstTime) {
      row.firstAt = event.at;
      state.firstTime = time;
    }
    if (time >= state.lastTime) {
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
      state.lastTime = time;
    }
    if (event.error !== undefined && time >= state.errorTime) {
      row.lastError = event.error;
      state.errorTime = time;
    }
  }

  const rows = [...jobs.values()].map(({ row }) => row)
    .sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return { night, found: true, rows, counts, invalidLines };
};