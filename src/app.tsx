import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { DigestResult } from './digest/types.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { DigestPage } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');
    try {
      const result = readNight(config.runsDir, night);
      if (!result.found) return c.json({ error: 'digest not found' }, 404);
      return c.json(result);
    } catch (error: unknown) {
      if (error instanceof RangeError) return c.json({ error: 'digest not found' }, 404);
      throw error;
    }
  });

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.get('/digest/:night', (c) => {
    let digest: DigestResult;
    try {
      digest = readNight(config.runsDir, c.req.param('night'));
    } catch (error) {
      if (error instanceof RangeError) {
        return c.html(<Layout title="digest" lane={lane()}><p class="mute">invalid night</p></Layout>, 404);
      }
      throw error;
    }
    if (!digest.found) {
      return c.html(<Layout title="digest" lane={lane()}><p class="mute">no run log for this night</p></Layout>, 404);
    }
    return c.html(
      <Layout title="digest" lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });

  return app;
}
