import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestResult } from '../src/digest/types.js';

const night = '2026-10-28';
const baseConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

const tempDirectories: string[] = [];
let previousLaneMarker: string | undefined;

function createRunsDirectory(files: Record<string, string> = {}): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  tempDirectories.push(directory);
  for (const [fileName, contents] of Object.entries(files)) {
    writeFileSync(join(directory, fileName), contents);
  }
  return directory;
}

function line(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&mdash;/g, '—')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function textFromHtml(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseDigestRows(html: string): Array<{ cells: string[]; raw: string }> {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? '';
  const body = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? table;
  return [...body.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .map((match) => {
      const raw = match[0];
      const cells = [...raw.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => textFromHtml(cell[1]));
      return { cells, raw };
    })
    .filter((row) => /<td/i.test(row.raw));
}

function findRow(rows: Array<{ cells: string[]; raw: string }>, job: string): { cells: string[]; raw: string } {
  const row = rows.find((entry) => entry.cells[0] === job);
  if (!row) throw new Error(`Missing row for ${job}`);
  return row;
}

beforeEach(() => {
  previousLaneMarker = process.env.LANE_MARKER;
});

afterEach(() => {
  if (previousLaneMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = previousLaneMarker;
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('returns 404 for a missing night file on HTML and JSON routes', async () => {
    const runsDir = createRunsDirectory();
    const app = createApp({ ...baseConfig, runsDir });

    const html = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);

    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
  });

  it('returns 200 with empty digest output for an empty night file', async () => {
    const runsDir = createRunsDirectory({ [`${night}.jsonl`]: '' });
    const app = createApp({ ...baseConfig, runsDir });

    const html = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);

    expect(html.status).toBe(200);
    expect(await html.text()).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      night,
      found: true,
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      invalidLines: 0,
    } satisfies DigestResult);
  });

  it.each(['../2026-10-28', '..\\2026-10-28', '/2026-10-28', 'C:\\2026-10-28', '2026-10-28/..', '2026-10-28\u0000', '2026-10-28.jsonl', '2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', ''])('returns 404 instead of 500 for unsafe or invalid night %j', async (unsafeNight) => {
    const runsDir = createRunsDirectory();
    const app = createApp({ ...baseConfig, runsDir });
    const encodedNight = encodeURIComponent(unsafeNight);

    const html = await app.request(`/digest/${encodedNight}`);
    const json = await app.request(`/api/digest/${encodedNight}`);

    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
  });

  it('renders and serves matching digest rows with warnings, escaping, and stable ordering', async () => {
    process.env.LANE_MARKER = 'TEST-DIGEST';
    const runsDir = createRunsDirectory({
      [`${night}.jsonl`]: [
        '',
        line({ at: '2026-10-28T23:00:00+01:00', job: 'z-job', status: 'ok', owner: 'zoe' }),
        line({ at: '2026-10-28T23:01:00+01:00', job: 'A-job', status: 'retry', owner: 'ann', error: 'temporary-1' }),
        line({ at: '2026-10-28T23:02:00+01:00', job: 'A-job', status: 'retry', owner: 'ann', error: 'temporary-2' }),
        line({ at: '2026-10-28T23:03:00+01:00', job: 'A-job', status: 'retry', owner: 'ann', error: 'temporary-3' }),
        line({ at: '2026-10-28T23:04:00+01:00', job: 'A-job', status: 'ok', owner: 'ann' }),
        line({ at: '2026-10-28T23:05:00+01:00', job: 'recover', status: 'fail', owner: 'ops', error: 'boom' }),
        line({ at: '2026-10-28T23:06:00+01:00', job: 'recover', status: 'ok', owner: 'ops' }),
        line({ at: '2026-10-28T23:07:00-05:00', job: 'ownerless', status: 'ok', owner: null }),
        '{bad json',
        line({ at: '2026-10-28T23:08:00+01:00', job: '<script>alert(1)</script>', status: 'ok', owner: '<b>o</b>', error: 'bad <img src=x onerror=1>' }),
      ].join('\n'),
    });
    const app = createApp({ ...baseConfig, runsDir });

    const htmlRes = await app.request(`/digest/${night}`);
    const jsonRes = await app.request(`/api/digest/${night}`);

    expect(htmlRes.status).toBe(200);
    expect(jsonRes.status).toBe(200);

    const html = await htmlRes.text();
    const digest = await jsonRes.json() as DigestResult;

    expect(html).toContain('TEST-DIGEST');
    expect(html).not.toMatch(/<script\b/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;o&lt;/b&gt;');

    const lower = html.toLowerCase();
    for (const label of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first time', 'last time']) {
      expect(lower).toContain(label);
    }

    expect(digest).toEqual({
      night,
      found: true,
      counts: { ok: 5, retry: 3, fail: 1 },
      invalidLines: 1,
      rows: [
        {
          job: '<script>alert(1)</script>',
          owner: '<b>o</b>',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: 'bad <img src=x onerror=1>',
          firstAt: '2026-10-28T23:08:00+01:00',
          lastAt: '2026-10-28T23:08:00+01:00',
          hasFailure: false,
        },
        {
          job: 'A-job',
          owner: 'ann',
          runs: 4,
          retries: 3,
          lastStatus: 'ok',
          lastError: 'temporary-3',
          firstAt: '2026-10-28T23:01:00+01:00',
          lastAt: '2026-10-28T23:04:00+01:00',
          hasFailure: false,
        },
        {
          job: 'ownerless',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T23:07:00-05:00',
          lastAt: '2026-10-28T23:07:00-05:00',
          hasFailure: false,
        },
        {
          job: 'recover',
          owner: 'ops',
          runs: 2,
          retries: 0,
          lastStatus: 'ok',
          lastError: 'boom',
          firstAt: '2026-10-28T23:05:00+01:00',
          lastAt: '2026-10-28T23:06:00+01:00',
          hasFailure: true,
        },
        {
          job: 'z-job',
          owner: 'zoe',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T23:00:00+01:00',
          lastAt: '2026-10-28T23:00:00+01:00',
          hasFailure: false,
        },
      ],
    } satisfies DigestResult);

    const htmlRows = parseDigestRows(html);
    const parityRows = htmlRows.map((entry) => ({
      job: entry.cells[0],
      owner: entry.cells[1],
      runs: Number(entry.cells[2]),
      retries: Number(entry.cells[3]),
      lastStatus: entry.cells[4],
      lastError: entry.cells[5],
      firstAt: entry.cells[6],
      lastAt: entry.cells[7],
    }));
    const jsonRows = digest.rows.map((row) => ({
      job: row.job,
      owner: row.owner ?? '—',
      runs: row.runs,
      retries: row.retries,
      lastStatus: row.lastStatus,
      lastError: row.lastError ?? '—',
      firstAt: row.firstAt,
      lastAt: row.lastAt,
    }));

    expect(parityRows).toEqual(jsonRows);
    expect(findRow(htmlRows, 'ownerless').cells[1]).toBe('—');
    expect(findRow(htmlRows, 'z-job').cells[5]).toBe('—');
    expect(findRow(htmlRows, 'A-job').raw).toMatch(/class="[^"]*\bwarn\b/i);
    expect(findRow(htmlRows, 'recover').raw).toMatch(/class="[^"]*\bwarn\b/i);
    expect(digest.rows.find((row) => row.job === 'ownerless')?.firstAt).toBe('2026-10-28T23:07:00-05:00');
    expect(digest.rows.find((row) => row.job === 'ownerless')?.lastAt).toBe('2026-10-28T23:07:00-05:00');
  });
});