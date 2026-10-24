// -----------------------------------------------------------------------------
// MeTube client (HTTP API of the web interface, port 8081 by default).
//
//   GET  /version  { version, "yt-dlp" }  (absent from old versions: optional)
//   GET  /history  { queue, done, pending }: the downloads in progress or
//                  waiting for a slot, the finished and failed ones, and the
//                  ones added without auto start (waiting for "Start")
//   POST /add      { url, quality, format, auto_start } → { status, msg }
//   POST /start    { ids } → { status }
//
// /add is sent in the historical schema (`format` + `quality`): MeTube still
// accepts it (_migrate_legacy_request) and the versions before the
// `download_type` schema only know it.
//
// MeTube has no authentication of its own; a reverse proxy in front of it may
// ask for a user name and a password: they go in the Authorization header,
// never in the URL, never in the logs. No Origin header is sent, so the
// cross-origin guard of MeTube lets the requests through, as for curl.
//
// No Socket.IO: the history read on a timer gives the same picture with no
// extra dependency, and a download lasts longer than the refresh interval.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // user name or password refused or missing (401, 403)
  NOT_METUBE: 'not_metube', // something answers, not MeTube
  REDIRECT: 'redirect', // the address redirects (HTTP to HTTPS, a login page)
  HTTP: 'http', // any other HTTP error
});

// Queue statuses that wait (a free slot, a live that has not started, the
// "Start" button); every other status of the queue is a download running.
const WAITING_STATUSES = new Set(['queued', 'scheduled', 'pending']);

// Download qualities offered by the scene action and the widget form (keys
// permanent once published), in the historical schema of /add.
export const QUALITIES = Object.freeze({
  best: { format: 'any', quality: 'best' },
  1080: { format: 'any', quality: '1080' },
  720: { format: 'any', quality: '720' },
  480: { format: 'any', quality: '480' },
  audio: { format: 'mp3', quality: 'best' },
});
export const QUALITY_KEYS = ['best', '1080', '720', '480', 'audio'];
export const DEFAULT_QUALITY = 'best';

export class MetubeError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'MetubeError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** MeTube refused a download (/add answered `status: error`). */
export class RejectedError extends Error {}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * One download of the history, normalized. `key` tells two downloads of the
 * same video apart (MeTube's `id` is the video id, or its URL).
 */
export function parseItem(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = text(raw.id) || text(raw.url);
  if (!id) {
    return null;
  }
  // `timestamp` is in nanoseconds (time.time_ns() when the download was added).
  const at = number(raw.timestamp) === null ? null : Math.round(raw.timestamp / 1e6);
  return {
    key: `${id}|${at ?? ''}`,
    id,
    title: text(raw.title) || id,
    url: text(raw.url),
    status: text(raw.status) || 'pending',
    percent: number(raw.percent),
    speed: number(raw.speed),
    eta: number(raw.eta),
    size: number(raw.size),
    filename: text(raw.filename),
    error: text(raw.msg) || text(raw.error),
    type: text(raw.download_type) || null,
    at,
  };
}

/**
 * The history of MeTube: `running` (in the queue, downloading) and `waiting`
 * (in the queue for a slot, or added without auto start), newest added first;
 * `done` (finished and failed), last ended first: MeTube lists them in the
 * order they ended, while their `timestamp` is the time they were added.
 * @returns {{ running: object[], waiting: object[], done: object[] } | null}
 */
export function parseHistory(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.queue) || !Array.isArray(raw.done)) {
    return null;
  }
  const parse = (items) => (Array.isArray(items) ? items : []).map(parseItem).filter(Boolean);
  const newest = (items) => parse(items).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const queue = newest(raw.queue);
  return {
    running: queue.filter((item) => !WAITING_STATUSES.has(item.status)),
    waiting: [...queue.filter((item) => WAITING_STATUSES.has(item.status)), ...newest(raw.pending)],
    done: parse(raw.done).reverse(),
  };
}

export const isFailed = (item) => item.status === 'error';

export class MetubeClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, with the URL_PREFIX if any
   * @param {string} [options.username] empty when nothing asks for a password
   * @param {string} [options.password]
   * @param {Function} [options.request] HTTP seam (src/metube/http.js)
   */
  constructor({ url, username = '', password = '', request = httpRequest }) {
    this.url = url;
    this.authorization = username
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : null;
    this.request = request;
  }

  /** One request; resolves with the parsed JSON answer (undefined when not JSON). */
  async call(path, { method = 'GET', body } = {}) {
    let answer;
    try {
      answer = await this.request(`${this.url}${path}`, {
        method,
        headers: this.authorization ? { authorization: this.authorization } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new MetubeError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      throw new MetubeError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }
    const { status } = answer;
    if (status === 401 || status === 403) {
      throw new MetubeError(
        ERROR_KINDS.AUTH,
        this.authorization
          ? 'User name or password refused'
          : 'A password is asked (reverse proxy): a user name and a password are needed',
        { status },
      );
    }
    if (status >= 300 && status < 400) {
      throw new MetubeError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new MetubeError(ERROR_KINDS.NOT_METUBE, `${path}: no MeTube at this address`, {
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw new MetubeError(ERROR_KINDS.HTTP, `${path} answered HTTP ${status}`, { status });
    }
    try {
      return JSON.parse(answer.body);
    } catch {
      return undefined;
    }
  }

  /** The version of MeTube and of yt-dlp, `null` each when unknown. */
  async version() {
    try {
      const data = await this.call('/version');
      return {
        version: text(data?.version) || null,
        ytdlp: text(data?.['yt-dlp']) || null,
      };
    } catch (err) {
      if (err.kind === ERROR_KINDS.NOT_METUBE) {
        return { version: null, ytdlp: null }; // MeTube before /version
      }
      throw err;
    }
  }

  async history() {
    const history = parseHistory(await this.call('/history'));
    if (!history) {
      throw new MetubeError(ERROR_KINDS.NOT_METUBE, '/history is not the history of MeTube');
    }
    return history;
  }

  /**
   * Add a video (or a playlist) to the queue, started at once.
   * @param {string} url
   * @param {string} quality one of QUALITY_KEYS
   */
  async add(url, quality = DEFAULT_QUALITY) {
    const choice = QUALITIES[quality] ?? QUALITIES[DEFAULT_QUALITY];
    const answer = await this.call('/add', {
      method: 'POST',
      body: { url, ...choice, auto_start: true },
    });
    if (answer?.status !== 'ok') {
      // "ERROR: [generic] 'x' is not a valid URL": the yt-dlp prefix is noise.
      const message = text(answer?.msg).replace(/^ERROR:\s*/, '') || 'refused';
      throw new RejectedError(message.slice(0, 300));
    }
  }

  /** Start the downloads added without auto start. */
  async start(ids) {
    const answer = await this.call('/start', { method: 'POST', body: { ids } });
    if (answer?.status !== 'ok') {
      throw new RejectedError(text(answer?.msg).slice(0, 300) || 'refused');
    }
  }
}
