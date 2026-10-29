import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';
import type { ReadNight } from '../src/digest/types.js';

const night = '2026-10-28';
const directories: string[] = [];

function runsDirectory(contents?: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  directories.push(directory);
  if (contents !== undefined) writeFileSync(join(directory, `${night}.jsonl`), contents);
  return directory;
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...overrides };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('digest reader', () => {
  it('matches the complete real-night aggregation through the shared contract', () => {
    const reader: ReadNight = readNight;
    expect(reader('runs', night)).toEqual({
      night,
      found: true,
      counts: { ok: 10, retry: 4, fail: 1 },
      invalidLines: 1,
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null, hasFailure: false,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503', hasFailure: false,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held', hasFailure: false,
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded', hasFailure: true,
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null, hasFailure: false,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('reads the other real night without invalid records', () => {
    const result = readNight('runs', '2026-10-27');
    expect(result.rows).toHaveLength(4);
    expect(result.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    expect(result.invalidLines).toBe(0);
  });

  it('distinguishes a missing file from an empty file', () => {
    expect(readNight(runsDirectory(), night)).toEqual({
      night, found: false, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, invalidLines: 0,
    });
    expect(readNight(runsDirectory(''), night)).toEqual({
      night, found: true, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, invalidLines: 0,
    });
  });

  it('ignores blank lines including CRLF and whitespace', () => {
    expect(readNight(runsDirectory(' \r\n\t\n\r\n'), night)).toEqual({
      night, found: true, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, invalidLines: 0,
    });
  });

  it('uses chronological instants across offsets while retaining source timestamps and failure history', () => {
    const events = [
      event({ at: '2026-10-29T00:30:00+02:00', status: 'fail', error: 'first failure' }),
      event({ at: '2026-10-28T23:45:00Z', owner: null }),
      event({ at: '2026-10-29T01:00:00+02:00', status: 'retry', error: 'latest supplied error' }),
      event({ at: '2026-10-28T17:00:00-05:00', status: 'retry', error: 'older error' }),
    ];
    expect(readNight(runsDirectory(events.map(value => JSON.stringify(value)).join('\n')), night)).toEqual({
      night, found: true, counts: { ok: 1, retry: 2, fail: 1 }, invalidLines: 0,
      rows: [{
        job: 'job', owner: null, runs: 4, retries: 2, lastStatus: 'ok',
        lastError: 'latest supplied error', hasFailure: true,
        firstAt: '2026-10-28T17:00:00-05:00', lastAt: '2026-10-28T23:45:00Z',
      }],
    });
  });

  it('uses later lines for equal instants and retains an explicitly empty error', () => {
    const events = [
      event({ status: 'fail', error: 'failure' }),
      event({ at: '2026-10-28T22:00:00Z', owner: null, error: '' }),
      event({ at: '2026-10-28T22:00:00.000Z' }),
    ];
    expect(readNight(runsDirectory(events.map(value => JSON.stringify(value)).join('\n')), night).rows).toEqual([{
      job: 'job', owner: 'rook', runs: 3, retries: 0, lastStatus: 'ok', lastError: '', hasFailure: true,
      firstAt: '2026-10-28T22:00:00.000Z', lastAt: '2026-10-28T22:00:00.000Z',
    }]);
  });

  it('counts malformed and structurally invalid lines and continues reading', () => {
    const invalid: unknown[] = [
      null, [], 42, 'text', {},
      { at: '2026-10-28T22:00:00Z', job: 'job', status: 'ok' },
      event({ job: ' ' }), event({ job: 1 }), event({ status: 'unknown' }),
      event({ owner: false }), event({ error: null }), event({ error: 5 }),
      event({ at: '2026-02-30T22:00:00Z' }), event({ at: '2026-10-28T25:00:00Z' }),
      event({ at: '2026-10-28T22:00:00' }), event({ at: 1793224800000 }),
    ];
    const lines = [JSON.stringify(event({ job: 'before' })), '{broken', ...invalid.map(value => JSON.stringify(value)), JSON.stringify(event({ job: 'after' }))];
    const result = readNight(runsDirectory(lines.join('\n')), night);
    expect(result.invalidLines).toBe(invalid.length + 1);
    expect(result.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(result.rows.map(row => row.job)).toEqual(['after', 'before']);
  });

  it('sorts jobs in code-unit order, independent of input order or locale', () => {
    const events = ['z', 'a', 'Z', '__proto__', 'A'].map(job => event({ job }));
    const result = readNight(runsDirectory(events.map(value => JSON.stringify(value)).join('\n')), night);
    expect(result.rows.map(row => row.job)).toEqual(['A', 'Z', '__proto__', 'a', 'z']);
  });

  it.each(['../2026-10-28', '..\\2026-10-28', '/2026-10-28', 'C:\\2026-10-28', '2026-10-28/..', '2026-10-28\0', '2026-10-28.jsonl', '2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', ''])('rejects unsafe or invalid night %j', unsafeNight => {
    expect(() => readNight(runsDirectory(), unsafeNight)).toThrow(RangeError);
  });

  it('accepts leap days on leap years', () => {
    expect(readNight(runsDirectory(), '2028-02-29').found).toBe(false);
  });

  it('does not hide non-missing filesystem errors', () => {
    const directory = runsDirectory();
    mkdirSync(join(directory, `${night}.jsonl`));
    expect(() => readNight(directory, night)).toThrow();
  });
});