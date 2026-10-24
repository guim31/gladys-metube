// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake MeTube on a fake
// network, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs unless `timers: true`: the
// tests read MeTube with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeMetube, createNetwork } from './fakeMetube.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/Paris';

export const METUBE_URL = 'http://192.0.2.20:8081';

/** A manual clock, the day of the real captures (local time, Europe/Paris). */
export function createClock(start = Date.parse('2026-10-24T10:00:00+02:00')) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = { url: '192.0.2.20', language: 'en' };

/** A MeTube with a history: two finished downloads, one failed, one running. */
export function defaultMetube(options) {
  const metube = new FakeMetube(options);
  metube.finished('Popeye for President');
  metube.fail(
    metube.record('example.invalid', { url: 'https://example.invalid/nothing' }),
    'Could not resolve host "example.invalid"',
  );
  metube.finished('Big Buck Bunny');
  metube.downloading('Sintel', { percent: 64.18141494145063, speed: 8578280.1112141 });
  return metube;
}

/**
 * @param {object} [options]
 * @param {FakeMetube} [options.metube]
 * @param {object} [options.config] raw integration config
 */
export async function createWorld({
  clock = createClock(),
  metube = defaultMetube(),
  servers,
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-metube-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(servers ?? { [METUBE_URL]: metube });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, metube, app, hub: app.hub, clock, dataDir };
}

export const serverDevice = (gladys) => gladys.externalIds('server', 'main').device;
export const serverFeature = (gladys, key) => gladys.externalIds('server', 'main').feature(key);

export { FakeMetube };
