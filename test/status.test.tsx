import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };
const directories: string[] = [];

function runsWith(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-status-'));
  directories.push(directory);
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(directory, name), contents);
  return directory;
}

function event(job: string, status: string, at: string): string {
  return JSON.stringify({ at, job, status, owner: 'rook' });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });

  it('links each night to its digest with event counts, not final job statuses', async () => {
    const runsDir = runsWith({
      '2026-10-28.jsonl': [
        event('a', 'retry', '2026-10-28T01:00:00+01:00'),
        event('a', 'retry', '2026-10-28T01:01:00+01:00'),
        event('a', 'ok', '2026-10-28T01:02:00+01:00'),
        event('b', 'fail', '2026-10-28T02:00:00+01:00'),
        'not json',
      ].join('\n'),
    });
    const html = await (await createApp({ ...config, runsDir }).request('/')).text();
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok 1 · retry 2 · fail 1');
  });

  it('skips calendar-invalid night files and lists nights newest first with zero counts', async () => {
    const runsDir = runsWith({
      '2026-02-30.jsonl': event('a', 'ok', '2026-02-28T01:00:00+01:00'),
      '2026-10-27.jsonl': '',
      '2026-10-28.jsonl': event('a', 'ok', '2026-10-28T01:00:00+01:00'),
    });
    const res = await createApp({ ...config, runsDir }).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('2026-02-30');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · ok 0 · retry 0 · fail 0');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
  });
});
