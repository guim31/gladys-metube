// -----------------------------------------------------------------------------
// The hub against the fake MeTube: what each reading publishes, the scene
// events (once, and never for what was there before), a restart, the limits
// per reading, MeTube down, a reverse proxy, the URL_PREFIX, the container's
// own timer, the scene action and "Test the connection".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { HUB_TIMINGS } from '../src/hub.js';
import {
  CONFIG,
  FakeMetube,
  METUBE_URL,
  createWorld,
  defaultMetube,
  serverDevice,
  serverFeature,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const state = (w, key) => w.fake.lastState(serverFeature(w.gladys, key));
const posts = (w, path) =>
  w.metube.requests
    .filter((request) => request.method === 'POST' && request.path === path)
    .map((request) => JSON.parse(request.body));

test('the first reading publishes the figures and announces nothing', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.discoveredDevices.length, 1);
  assert.equal(w.fake.discoveredDevices[0].name, 'MeTube 192.0.2.20:8081');
  assert.equal(w.fake.discoveredDevices[0].should_poll, false);
  assert.equal(state(w, 'online'), 1);
  assert.equal(state(w, 'running'), 1);
  assert.equal(state(w, 'waiting'), 0);
  assert.equal(state(w, 'finished'), 2);
  assert.equal(state(w, 'failed'), 1);
  assert.equal(state(w, 'progress'), 64);
  assert.equal(state(w, 'speed'), 8.18);
  assert.equal(state(w, 'current'), 'Sintel');
  assert.equal(state(w, 'last_finished'), 'Big Buck Bunny');
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(w.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
});

test('the real histories of MeTube 2026.10.23 read as expected', async (t) => {
  const { fixture } = await import('./helpers/fakeMetube.js');
  const { parseHistory } = await import('../src/metube/client.js');
  const waiting = parseHistory(fixture('history-pending-errors'));
  assert.equal(waiting.running.length, 0);
  assert.deepEqual(
    waiting.waiting.map((item) => [item.title, item.status, item.url]),
    [['Popeye for President', 'pending', 'https://archive.org/details/Popeye_forPresident']],
  );
  assert.deepEqual(
    waiting.done.map((item) => [item.status, item.error]),
    [
      ['error', "ERROR: [generic] 'x' is not a valid URL"],
      ['error', 'Could not resolve host "example.invalid"'],
    ],
  );
  const preparing = parseHistory(fixture('history-preparing'));
  assert.deepEqual(
    preparing.running.map((item) => item.status),
    ['preparing'],
  );
  const downloading = parseHistory(fixture('history-downloading')).running[0];
  assert.equal(downloading.status, 'downloading');
  assert.equal(Math.floor(downloading.percent), 64);
  assert.equal(downloading.speed, 8578280.1112141);
  const finished = parseHistory(fixture('history-finished')).done[0];
  assert.deepEqual(
    [finished.status, finished.filename, finished.size],
    ['finished', 'Popeye for President.ogv', 26138707],
  );
  assert.ok(finished.at > Date.parse('2026-10-01') && finished.at < Date.parse('2027-01-01'));
  t.diagnostic('fixtures parsed');
});

test('a download finished fires download_completed once, with its details', async (t) => {
  const w = await world(t);
  w.metube.finish(w.metube.queue[0], { size: 52_428_800, filename: 'Sintel.webm' });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, 'download_completed').map((event) => event.data),
    [
      {
        title: 'Sintel',
        url: 'https://archive.org/details/Sintel',
        filename: 'Sintel.webm',
        size_mb: 50,
      },
    ],
  );
  assert.equal(state(w, 'running'), 0);
  assert.equal(state(w, 'progress'), 0);
  assert.equal(state(w, 'speed'), 0);
  assert.equal(state(w, 'current'), 'Nothing downloading');
  assert.equal(state(w, 'last_finished'), 'Sintel');
  assert.equal(state(w, 'finished'), 3);
});

test('a download failed fires download_failed once, with the message of yt-dlp', async (t) => {
  const w = await world(t);
  w.metube.fail(w.metube.queue[0], 'ERROR: [youtube] abc: Video unavailable');
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, 'download_failed').map((event) => event.data),
    [
      {
        title: 'Sintel',
        url: 'https://archive.org/details/Sintel',
        error: 'ERROR: [youtube] abc: Video unavailable',
      },
    ],
  );
  assert.equal(state(w, 'failed'), 2);
  assert.deepEqual(events(w, 'download_completed'), []);
});

test('a restart announces nothing twice; what ended meanwhile is announced', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const metube = first.metube;
  metube.finish(metube.queue[0]);
  const w = await world(t, { metube, dataDir: first.dataDir });
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.key, event.data.title]),
    [['download_completed', 'Sintel']],
  );
  const again = await world(t, { metube, dataDir: first.dataDir });
  assert.deepEqual(again.fake.sceneEvents, []);
});

test('the same link downloaded again is announced again', async (t) => {
  const w = await world(t);
  const popeye = w.metube.done[0];
  w.metube.finish(w.metube.record(popeye.title, { url: popeye.url }));
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, 'download_completed').map((event) => event.data.title),
    ['Popeye for President'],
  );
  assert.equal(state(w, 'finished'), 2, 'MeTube keeps one entry per link');
});

test('a download cleared from the history is neither announced nor counted', async (t) => {
  const w = await world(t);
  w.metube.done = w.metube.done.filter((item) => item.status !== 'error');
  await w.hub.pollAll();
  assert.equal(state(w, 'failed'), 0);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('at most 10 events of a kind per reading, the latest ones', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 14; i += 1) {
    w.metube.finished(`Video ${i}`);
  }
  await w.hub.pollAll();
  const titles = events(w, 'download_completed').map((event) => event.data.title);
  assert.equal(titles.length, HUB_TIMINGS.maxEventsPerRead);
  assert.equal(titles[0], 'Video 4');
  assert.equal(titles.at(-1), 'Video 13');
});

test('waiting downloads: queued for a slot and waiting for Start', async (t) => {
  const w = await world(t);
  w.metube.queued('Elephants Dream');
  w.metube.waitingStart('Tears of Steel');
  await w.hub.pollAll();
  assert.equal(state(w, 'running'), 1);
  assert.equal(state(w, 'waiting'), 2);
});

test('MeTube down: offline, unreachable, the counts are not republished as fresh', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  w.metube.down = true;
  await w.hub.pollAll();
  assert.equal(state(w, 'online'), 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  assert.equal(w.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  w.clock.advance(13 * 60 * 60_000);
  await w.hub.pollAll();
  const published = w.fake.states.slice(before);
  assert.ok(
    published.every((s) => s.device_feature_external_id === serverFeature(w.gladys, 'online')),
    'only online while down',
  );
  w.metube.down = false;
  w.metube.finish(w.metube.queue[0]);
  await w.hub.pollAll();
  assert.equal(state(w, 'online'), 1);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(events(w, 'download_completed').length, 1, 'what ended while down');
});

test('a reverse proxy: the basic authentication is sent, a refusal explained', async (t) => {
  const metube = defaultMetube({ auth: { username: 'admin', password: 'right' } });
  const ok = await world(t, {
    metube,
    config: { url: '192.0.2.20', username: 'admin', password: 'right' },
  });
  assert.equal(ok.fake.connectionStatus.connected, true);
  assert.equal(
    metube.requests.at(-1).headers.authorization,
    `Basic ${Buffer.from('admin:right').toString('base64')}`,
  );
  const wrong = await world(t, {
    metube: defaultMetube({ auth: { username: 'admin', password: 'right' } }),
    config: { url: '192.0.2.20', username: 'admin', password: 'wrong' },
  });
  assert.equal(wrong.fake.connectionStatus.connected, false);
  assert.match(wrong.fake.connectionStatus.message.en, /refused or missing/);
});

test('the URL_PREFIX of MeTube is kept in every request', async (t) => {
  const metube = defaultMetube();
  const w = await world(t, {
    metube,
    servers: { [`${METUBE_URL}/metube`]: metube },
    config: { url: 'http://192.0.2.20:8081/metube/', language: 'en' },
  });
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.ok(w.network.calls.every((call) => call.url.startsWith(`${METUBE_URL}/metube/`)));
  assert.equal(w.fake.discoveredDevices[0].params[0].value, `${METUBE_URL}/metube`);
});

test('a MeTube without /version (older) still works', async (t) => {
  const w = await world(t, { metube: defaultMetube({ version: null }) });
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.equal(state(w, 'running'), 1);
});

test('an address that is not MeTube is told apart', async (t) => {
  const metube = new FakeMetube();
  metube.handle = () => ({ status: 200, headers: {}, body: '<html>router</html>' });
  const w = await world(t, { metube });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /No MeTube/);
});

test('no address: no device, a message under the integration name', async (t) => {
  const w = await world(t, { config: { url: '' } });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Enter the address/);
  const invalid = await world(t, { config: { url: 'ftp://192.0.2.20' } });
  assert.match(invalid.fake.connectionStatus.message.en, /not valid/);
});

test('another server: its history is not news', async (t) => {
  const w = await world(t);
  const other = defaultMetube();
  other.finished('Something else');
  w.network.servers['http://192.0.2.21:8081'] = other;
  await w.fake.configUpdated({ ...CONFIG, url: '192.0.2.21' });
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(state(w, 'finished'), 3);
});

test('adding the device in Gladys republishes every state and refreshes the widget', async (t) => {
  const w = await world(t);
  const device = w.fake.discoveredDevices[0];
  assert.equal(device.external_id, serverDevice(w.gladys));
  const before = w.fake.states.length;
  await w.fake.deviceCreated(device);
  assert.equal(w.fake.states.length - before, device.features.length);
  assert.ok(w.fake.widgetRefreshes.includes('downloads'));
});

test('an unchanged value is republished every 12 hours (heartbeat)', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed: nothing sent');
  w.clock.advance(HUB_TIMINGS.heartbeatMs);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length - before, 9);
});

test('the container reads MeTube on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  const reads = () => w.metube.requests.filter((r) => r.path === '/history').length;
  assert.equal(reads(), 1);
  w.metube.finish(w.metube.queue[0]);
  t.mock.timers.tick(30_000);
  await w.hub.polling;
  assert.equal(reads(), 2);
  assert.equal(events(w, 'download_completed').length, 1);
  t.mock.timers.tick(30_000);
  await w.hub.polling;
  assert.equal(reads(), 3);
});

test('the scene action adds the link in the quality chosen, started at once', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('add_url', {
    url: ' https://archive.org/details/Popeye_forPresident ',
    quality: '720',
  });
  assert.equal(ack.success, true, ack.error);
  const audio = await w.fake.sceneAction('add_url', {
    url: 'https://archive.org/details/Big_Buck_Bunny',
    quality: 'audio',
  });
  assert.equal(audio.success, true, audio.error);
  const fallback = await w.fake.sceneAction('add_url', { url: 'https://archive.org/details/x' });
  assert.equal(fallback.success, true, fallback.error);
  assert.deepEqual(posts(w, '/add'), [
    {
      url: 'https://archive.org/details/Popeye_forPresident',
      format: 'any',
      quality: '720',
      auto_start: true,
    },
    {
      url: 'https://archive.org/details/Big_Buck_Bunny',
      format: 'mp3',
      quality: 'best',
      auto_start: true,
    },
    { url: 'https://archive.org/details/x', format: 'any', quality: 'best', auto_start: true },
  ]);
  assert.equal(state(w, 'running') + state(w, 'waiting'), 4, 'read again after adding');
});

test('the scene action refuses a bad link, and explains a refusal of MeTube', async (t) => {
  const w = await world(t, { config: { ...CONFIG, language: 'fr' } });
  const bad = await w.fake.sceneAction('add_url', { url: 'not a link' });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Saisissez l'adresse d'une vidéo/);
  assert.deepEqual(posts(w, '/add'), []);
  w.metube.refusals.set('https://example.invalid/x', 'Could not resolve host "example.invalid"');
  const refused = await w.fake.sceneAction('add_url', { url: 'https://example.invalid/x' });
  assert.equal(refused.success, false);
  assert.equal(refused.error, 'MeTube a refusé le lien : Could not resolve host "example.invalid"');
  // MeTube lists the refused link as failed: the trigger fires.
  assert.equal(events(w, 'download_failed').length, 1);
  w.metube.down = true;
  const down = await w.fake.sceneAction('add_url', { url: 'https://archive.org/details/x' });
  assert.equal(down.success, false);
  assert.match(down.error, /MeTube ne répond pas/);
  const none = await world(t, { config: { url: '', language: 'fr' } });
  const ack = await none.fake.sceneAction('add_url', { url: 'https://archive.org/details/x' });
  assert.match(ack.error, /Saisissez l'adresse de votre serveur MeTube/);
});

test('"Test the connection" reports the versions and the figures', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    'OK, MeTube 2026.10.23 (yt-dlp 2026.10.21), 1 in progress, 0 waiting, 2 finished, 1 in error',
  );
  assert.equal(
    ack.data.message.fr,
    'OK, MeTube 2026.10.23 (yt-dlp 2026.10.21), 1 en cours, 0 en attente, 2 terminé(s), 1 en erreur',
  );
  w.metube.down = true;
  const down = await w.fake.action('test_connection', {});
  assert.match(down.data.message.en, /does not answer/);
});
