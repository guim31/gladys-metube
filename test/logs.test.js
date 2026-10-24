// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only (a download finished or failed goes to debug, like any reading). A
// normal reading writes nothing, a failure that repeats is logged once, and
// its end once; one line per action of the user. Never the password, never
// the link added (it may carry a token).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMetube, createWorld, defaultMetube } from './helpers/world.js';

/** Capture the lines of the SDK logger at LOG_LEVEL=info. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('connected, version 2026.10.23')),
    'the start is logged',
  );
  logs.clear();
  for (let i = 0; i < 5; i += 1) {
    // Progress moves, downloads end: nothing to tell at info.
    w.metube.queue[0].percent = 70 + i;
    w.metube.finished(`Video ${i}`);
    w.clock.advance(30_000);
    await w.hub.pollAll();
  }
  assert.deepEqual(logs.texts(), []);
});

test('a download finished or failed is one line at debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  logs.clear();
  w.metube.finished('Fresh one');
  w.metube.fail(w.metube.queued('Blocked one'));
  await w.hub.pollAll();
  const news = logs.texts().filter((text) => /MeTube: (finished|failed)/.test(text));
  assert.equal(news.length, 2, logs.texts().join('\n'));
  assert.match(news[0], /\[DEBUG\].*finished "Fresh one"/);
  assert.match(news[1], /\[DEBUG\].*failed "Blocked one"/);
});

test('a link added is one line at info, with the host only', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  await w.fake.sceneAction('add_url', { url: 'https://archive.org/details/x?token=s3cr3t' });
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /Download added to MeTube \(archive\.org, quality best\)/);
  assert.ok(!logs.texts().join('\n').includes('s3cr3t'));
});

test('a link refused by MeTube is logged with its host only', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  const link = 'https://example.org/watch?token=s3cr3t';
  w.metube.refusals.set(link, `ERROR: [generic] '${link}' is not a valid URL`);
  const ack = await w.fake.sceneAction('add_url', { url: link });
  assert.equal(ack.success, false);
  assert.match(logs.texts().join('\n'), /refused a link of example\.org/);
  assert.ok(!logs.texts().join('\n').includes('s3cr3t'));
});

test('a server that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.metube.down = true;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(30_000);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.metube.down = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /connection restored/);
});

test('a refused password is logged once, never the password', async (t) => {
  const logs = captureLogs(t);
  const metube = defaultMetube({ auth: { username: 'admin', password: 'right' } });
  const w = await world(t, {
    metube,
    config: { url: '192.0.2.20', username: 'admin', password: 'wrong-pass-42' },
  });
  for (let i = 0; i < 5; i += 1) {
    await w.hub.pollAll();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /refused/);
  assert.ok(!logs.texts().join('\n').includes('wrong-pass-42'), 'never the password');
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.metube.finished(`Video ${i}`);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused/);
});

test('LOG_LEVEL=debug shows each reading problem; never the password', async (t) => {
  const logs = captureLogs(t, 'debug');
  const metube = new FakeMetube({ auth: { username: 'admin', password: 'secret-77' } });
  const w = await world(t, {
    metube,
    config: { url: '192.0.2.20', username: 'admin', password: 'secret-77' },
  });
  w.metube.down = true;
  await w.hub.pollAll();
  await w.hub.pollAll();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  assert.ok(!text.includes('secret-77'), 'never the password');
  assert.ok(!text.includes(Buffer.from('admin:secret-77').toString('base64')), 'nor its header');
});
