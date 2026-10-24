import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseServerUrl } from '../src/config.js';

test('the address: a bare host gets the port of MeTube, a copied URL keeps its prefix', () => {
  assert.equal(parseServerUrl('192.0.2.20'), 'http://192.0.2.20:8081');
  assert.equal(parseServerUrl(' 192.0.2.20:9000 '), 'http://192.0.2.20:9000');
  assert.equal(parseServerUrl('http://metube.local:8081/'), 'http://metube.local:8081');
  assert.equal(parseServerUrl('https://example.org/metube/'), 'https://example.org/metube');
  assert.equal(parseServerUrl('http://192.0.2.20:8081/?x=1#top'), 'http://192.0.2.20:8081');
  assert.equal(
    parseServerUrl('http://192.0.2.20:8081/metube/history'),
    'http://192.0.2.20:8081/metube',
  );
  assert.equal(parseServerUrl('http://user:pass@192.0.2.20'), null, 'no credentials in the URL');
  assert.equal(parseServerUrl('ftp://192.0.2.20'), null);
  assert.equal(parseServerUrl(''), null);
  assert.equal(parseServerUrl(42), null);
});

test('normalization: defaults, numbers as strings, unknown values', () => {
  const config = normalizeConfig({});
  assert.equal(config.url, null);
  assert.equal(config.invalidUrl, false);
  assert.equal(config.username, '');
  assert.equal(config.password, '');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.language, 'fr');
  const typed = normalizeConfig({
    url: 'http://[bad',
    poll_interval: 10,
    language: 'it',
    username: '  admin  ',
    password: ' spaced ',
  });
  assert.equal(typed.invalidUrl, true);
  assert.equal(typed.pollIntervalMs, 10_000);
  assert.equal(typed.language, 'fr');
  assert.equal(typed.username, 'admin');
  assert.equal(typed.password, ' spaced ', 'a password is kept as typed');
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 30_000);
});
