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
