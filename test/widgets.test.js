// -----------------------------------------------------------------------------
// The `downloads` widget: content valid for the core (budget, vocabulary), in
// every language, the queue and the last downloads, its two buttons (the
// form that adds a link, Start), and its messages.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FakeMetube, createWorld } from './helpers/world.js';
import { doneItem, queueRow } from '../src/widgets.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const get = async (w, language = 'en') => {
  const ack = await w.fake.widgetGet('downloads', { settings: {}, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], JSON.stringify(ack.data));
  return ack.data.content.components;
};

const buttons = (components) => components.filter((c) => c.type === 'button');

test('the widget shows the figures, the queue and the last downloads, in every language', async (t) => {
  const w = await world(t);
  w.metube.queued('x'.repeat(80));
  w.metube.waitingStart('Tears of Steel');
  await w.hub.pollAll();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const components = await get(w, language);
    assert.ok(components.length <= 8);
    assert.ok(components.filter((c) => c.type === 'text').length <= 2);
    assert.deepEqual(
      components.filter((c) => c.type === 'value').map((c) => c.value),
      [1, 2, 1],
    );
    const status = components.find((c) => c.type === 'status');
    assert.equal(status.items.length, 3);
    assert.equal(status.items[0].label, 'Sintel');
    assert.match(status.items[0].value, /^64 % · 8[.,]2 M[Bo]\/s$/);
    assert.equal(status.items[1].label.length, 40);
    const list = components.find((c) => c.type === 'card-list');
    assert.deepEqual(
      list.items.map((item) => item.title),
      ['Big Buck Bunny', 'example.invalid', 'Popeye for President'],
    );
    assert.equal(list.items[1].badge.color, 'danger');
    assert.deepEqual(
      buttons(components).map((b) => b.action.key),
      ['add', 'start_pending'],
    );
  }
  const fr = await get(w, 'fr');
  assert.equal(fr.find((c) => c.type === 'status').items[2].value, 'Attend Démarrer');
  assert.equal(buttons(fr)[0].label, 'Ajouter une vidéo');
});

test('the Add button opens a form that adds the link to MeTube', async (t) => {
  const w = await world(t);
  const [add] = buttons(await get(w));
  assert.deepEqual(
    add.action.fields.map((field) => [field.key, field.type, field.required]),
    [
      ['url', 'string', true],
      ['quality', 'select', false],
    ],
  );
  const ack = await w.fake.widgetAction(
    'downloads',
    'add',
    {},
    {
      values: { url: 'https://archive.org/details/Popeye_forPresident', quality: '480' },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.en, 'Added to MeTube.');
  const add2 = w.metube.requests.find((r) => r.path === '/add');
  assert.deepEqual(JSON.parse(add2.body), {
    url: 'https://archive.org/details/Popeye_forPresident',
    format: 'any',
    quality: '480',
    auto_start: true,
  });
});

test('the Start button starts the downloads waiting for Start, and only then shows', async (t) => {
  const w = await world(t);
  assert.deepEqual(
    buttons(await get(w)).map((b) => b.action.key),
    ['add'],
  );
  const item = w.metube.waitingStart('Tears of Steel');
  await w.hub.pollAll();
  const ack = await w.fake.widgetAction('downloads', 'start_pending', {}, {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Téléchargements en attente lancés.');
  const start = w.metube.requests.find((r) => r.path === '/start');
  assert.deepEqual(JSON.parse(start.body), { ids: [item.url] });
  assert.equal(item.status, 'queued');
  const again = await w.fake.widgetAction('downloads', 'start_pending', {}, {});
  assert.equal(again.data.message.en, 'No download waits for Start.');
});

test('nothing downloaded yet: a sentence instead of the list', async (t) => {
  const w = await world(t, { metube: new FakeMetube() });
  const components = await get(w, 'de');
  assert.ok(components.some((c) => c.text === 'Noch nichts heruntergeladen.'));
  assert.equal(
    components.find((c) => c.type === 'status'),
    undefined,
  );
});

test('no server, or a server down: a message instead of figures', async (t) => {
  const empty = await world(t, { config: {} });
  assert.match((await get(empty))[0].text, /address of your MeTube server/);
  const w = await world(t);
  w.metube.down = true;
  await w.hub.pollAll();
  const components = await get(w, 'fr');
  assert.equal(components[0].items[0].value, 'Hors ligne');
});

test('rows without speed, file or size stay valid', () => {
  assert.deepEqual(
    queueRow({ title: 'A', status: 'downloading', percent: null, speed: null }, 'en'),
    {
      label: 'A',
      value: '0 %',
      icon: 'download',
      color: 'primary',
    },
  );
  assert.equal(queueRow({ title: 'A', status: 'weird' }, 'es').value, 'Preparando');
  assert.deepEqual(doneItem({ title: 'B', status: 'finished', size: null, filename: '' }, 'en'), {
    title: 'B',
  });
});
