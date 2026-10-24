// -----------------------------------------------------------------------------
// An in-memory MeTube on a fake network, for the tests: the four routes the
// integration uses (/version, /history, /add, /start), with the records of
// a real MeTube 2026.10.23 as the shape of every download (see
// test/fixtures/metube/), an optional URL_PREFIX and an optional basic
// authentication in front of it (a reverse proxy).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/metube/2026.10.23/${name}.json`, import.meta.url), 'utf8'),
  );

// A real record (the finished download of a real reading), the template of
// every download of the fake.
const TEMPLATE = fixture('history-finished').done.find((item) => item.status === 'finished');

let sequence = 0;

export class FakeMetube {
  /**
   * @param {object} [options]
   * @param {string|null} [options.version] null: a MeTube without /version
   * @param {{ username: string, password: string }} [options.auth] reverse proxy
   */
  constructor({ version = '2026.10.23', auth = null } = {}) {
    this.version = version;
    this.auth = auth;
    this.queue = [];
    this.done = [];
    this.pending = [];
    this.requests = [];
    this.down = false;
    /** URL → error message: /add answers `status: error` for it. */
    this.refusals = new Map();
  }

  /** A download record, the shape of a real one. */
  record(title, { url, status = 'queued', ...extra } = {}) {
    sequence += 1;
    const id = title.replace(/\W+/g, '_');
    return {
      ...structuredClone(TEMPLATE),
      id,
      title,
      url: url ?? `https://archive.org/details/${id}`,
      status,
      percent: null,
      speed: null,
      eta: null,
      size: null,
      msg: null,
      error: null,
      filename: undefined,
      // Nanoseconds, as time.time_ns().
      timestamp: TEMPLATE.timestamp + sequence * 1_000_000_000,
      ...extra,
    };
  }

  /** A download running, at `percent`. */
  downloading(title, { percent = 50, speed = 2 * 1024 * 1024, ...extra } = {}) {
    const item = this.record(title, { status: 'downloading', percent, speed, eta: 10, ...extra });
    this.queue.push(item);
    return item;
  }

  /** A download waiting in the queue for a slot. */
  queued(title, extra = {}) {
    const item = this.record(title, { status: 'queued', ...extra });
    this.queue.push(item);
    return item;
  }

  /** A download added without auto start (waits for "Start"). */
  waitingStart(title, extra = {}) {
    const item = this.record(title, { status: 'pending', ...extra });
    this.pending.push(item);
    return item;
  }

  /** The download ends well: out of the queue, at the end of `done`. */
  finish(item, { size = 26_138_707, filename = `${item.title}.mp4` } = {}) {
    this.queue = this.queue.filter((other) => other !== item);
    this.done = this.done.filter((other) => other.url !== item.url);
    Object.assign(item, {
      status: 'finished',
      percent: 100,
      speed: null,
      eta: null,
      size,
      filename,
    });
    this.done.push(item);
    return item;
  }

  /** The download fails, with the message of yt-dlp. */
  fail(item, message = 'ERROR: [generic] Unable to download webpage: HTTP Error 404: Not Found') {
    this.queue = this.queue.filter((other) => other !== item);
    this.done = this.done.filter((other) => other.url !== item.url);
    Object.assign(item, { status: 'error', msg: message, error: message, percent: null });
    this.done.push(item);
    return item;
  }

  /** A finished download straight in the history. */
  finished(title, extra = {}) {
    return this.finish(this.record(title, extra), extra);
  }

  /** The HTTP handler: `{ status, headers, body }`. */
  handle(path, { method = 'GET', headers = {}, body } = {}) {
    this.requests.push({ method, path, headers, body });
    const json = (value, status = 200) => ({
      status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (this.auth) {
      const expected = `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`;
      if (headers.authorization !== expected) {
        return { status: 401, headers: {}, body: '401 Authorization Required' };
      }
    }
    if (method === 'GET' && path === '/version' && this.version) {
      return json({ 'yt-dlp': '2026.10.21', version: this.version });
    }
    if (method === 'GET' && path === '/history') {
      return json({ done: this.done, queue: this.queue, pending: this.pending });
    }
    if (method === 'POST' && path === '/add') {
      const post = JSON.parse(body);
      if (!post.url || !post.quality) {
        return { status: 400, headers: {}, body: "400: missing 'url'" };
      }
      const refusal = this.refusals.get(post.url);
      const item = this.record(post.url.replace(/^https?:\/\/[^/]+\//, '') || post.url, {
        url: post.url,
        quality: post.quality,
        format: post.format,
      });
      if (refusal) {
        this.fail(item, refusal);
        return json({ status: 'error', msg: refusal });
      }
      if (post.auto_start === false) {
        item.status = 'pending';
        this.pending.push(item);
      } else {
        this.queue.push(item);
      }
      return json({ status: 'ok' });
    }
    if (method === 'POST' && path === '/start') {
      const { ids } = JSON.parse(body);
      for (const url of ids) {
        const item = this.pending.find((other) => other.url === url);
        if (item) {
          this.pending = this.pending.filter((other) => other !== item);
          item.status = 'queued';
          this.queue.push(item);
        }
      }
      return json({ status: 'ok' });
    }
    return { status: 404, headers: {}, body: '404: Not Found' };
  }
}

/**
 * A fake network: `{ [baseUrl]: FakeMetube }`. Any other address, or a
 * MeTube marked `down`, refuses the connection.
 */
export function createNetwork(servers) {
  const calls = [];
  return {
    calls,
    servers,
    async request(url, options = {}) {
      calls.push({ url, ...options });
      for (const [base, server] of Object.entries(servers)) {
        if (url.startsWith(`${base}/`) && !server.down) {
          return server.handle(url.slice(base.length), options);
        }
      }
      const error = new Error(`connect ECONNREFUSED ${url}`);
      error.code = 'ECONNREFUSED';
      throw error;
    },
  };
}

export { fixture };
