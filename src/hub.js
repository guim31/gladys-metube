// -----------------------------------------------------------------------------
// The hub: reads the history of MeTube on a timer of the container (the
// interval chosen in the configuration), publishes the states of the server
// device when they change, fires the scene events, and runs the commands of
// the scene action, of the widget and of "Test the connection".
//
// Gladys never polls this device (should_poll: false): the scene events must
// fire even when the device was not added, and a device created without
// should_poll is never polled by Gladys 5.2 anyway.
//
// Scene events, from the `done` list of MeTube (finished and failed
// downloads, in the order they ended):
//   - download_completed: a finished download not seen before;
//   - download_failed: a failed download not seen before (a bad link added
//     from MeTube or from Gladys lands there at once).
// The downloads seen are kept under /data, so a restart announces nothing
// twice; the first reading of a server announces nothing.
// No webhook nor Socket.IO: the sandbox has no inbound port, and the history
// read every few seconds tells the same.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  DEFAULT_QUALITY,
  ERROR_KINDS,
  MetubeClient,
  QUALITY_KEYS,
  RejectedError,
  isFailed,
} from './metube/client.js';
import { FEATURE_KEYS, buildServer, featureValues, serverIds } from './devices.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, IDLE_TEXT, REPORT_TEXT, pick } from './texts.js';

const logger = createLogger({ name: 'metube-hub' });

export const WIDGET_KEY = 'downloads';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  COMPLETED: 'download_completed',
  FAILED: 'download_failed',
});

export const HUB_TIMINGS = {
  // At most this many events of each kind per reading (the newest ones).
  maxEventsPerRead: 10,
  // Republish an unchanged value this often (Gladys flags a value older than 48 h).
  heartbeatMs: 12 * 60 * 60_000,
};

// Downloads remembered as seen; beyond, the older ones of MeTube's history
// are taken as seen too (see `floor`).
export const MAX_KNOWN = 5000;

const MB = 1024 * 1024;

export class CommandError extends Error {}

export class MetubeHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/metube/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    this.server = this.emptyServer();
    this.error = null;
    this.devicesKey = null;
    /** Last value published per feature external id: { value, at }. */
    this.published = new Map();
    this.transport = null;
    this.connection = null;
    this.saved = this.emptySaved(null);
    this.pollTimer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  emptyServer() {
    return { reachable: null, version: null, ytdlp: null, history: null };
  }

  emptySaved(url) {
    return { url, primed: false, known: [], floor: null };
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  /** The problem `key` is gone: the next occurrence is logged again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      url: typeof saved.url === 'string' ? saved.url : null,
      primed: saved.primed === true,
      known: Array.isArray(saved.known)
        ? saved.known.filter((key) => typeof key === 'string').slice(0, MAX_KNOWN)
        : [],
      floor: Number.isFinite(saved.floor) ? saved.floor : null,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.transport = null;
    this.connection = null;
    this.devicesKey = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const signature = JSON.stringify([config.url, config.username, config.password]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client = config.url
        ? new MetubeClient({
            url: config.url,
            username: config.username,
            password: config.password,
            request: this.request,
          })
        : null;
      this.error = null;
      this.server = this.emptyServer();
      if (config.url && this.saved.url !== config.url) {
        // Another server: its history is not news.
        this.saved = this.emptySaved(config.url);
        this.store.save(this.saved);
      }
    }
    this.devicesKey = null; // the language may have changed
    try {
      await this.refresh();
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Poll failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Devices ---------------------------------------------------------------

  devices() {
    return this.client ? [buildServer(this.gladys, this.config)] : [];
  }

  /** Publish the device when it changed (name, language). */
  async publishDevices({ force = false } = {}) {
    const devices = this.devices();
    const key = JSON.stringify(devices);
    if (!force && key === this.devicesKey) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesKey = key;
      this.resolved('discovery');
    } catch (err) {
      this.problem('discovery', `Devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read MeTube, publish the device again. */
  async rediscover() {
    await this.refresh();
    await this.publishDevices({ force: true });
  }

  /** The user added the device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!this.client || device.external_id !== serverIds(this.gladys).device) {
      return;
    }
    await this.publishStates({ force: true });
    this.transport = null;
    await this.publishTransport();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading MeTube --------------------------------------------------------

  /** Read MeTube and apply what changed. Concurrent calls share the read. */
  pollAll() {
    this.polling ??= this.readAll().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  /** A reading that starts after this call (after a command, fresh figures). */
  async refresh() {
    if (this.polling) {
      await this.polling.catch(() => {});
    }
    return this.pollAll();
  }

  /** Gladys asks for a refresh (onPoll): read MeTube now. */
  async pollDevice(device) {
    if (this.client && device.external_id === serverIds(this.gladys).device) {
      await this.pollAll();
    }
  }

  async readAll() {
    if (!this.client) {
      await this.publishDevices();
      await this.publishConnectionStatus();
      return;
    }
    const client = this.client;
    const before = this.widgetView();
    try {
      // The version once per connection: it only changes with a restart of MeTube.
      const version = this.server.reachable ? null : await client.version();
      const history = await client.history();
      if (client !== this.client) {
        return; // reconfigured meanwhile
      }
      await this.applyHistory(client, history, version);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      if (client !== this.client) {
        return;
      }
      this.applyFailure(err);
    }
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransport();
    await this.publishConnectionStatus();
    if (this.widgetView() !== before) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async applyHistory(client, history, version) {
    const previous = this.server;
    if (this.error) {
      logger.info(`MeTube ${this.config.url}: connection restored`);
    } else if (previous.reachable === null) {
      logger.info(
        `MeTube ${this.config.url}: connected, version ${version?.version ?? 'unknown'}, ` +
          `yt-dlp ${version?.ytdlp ?? 'unknown'}`,
      );
    }
    this.error = null;
    this.server = {
      reachable: true,
      version: version ? version.version : previous.version,
      ytdlp: version ? version.ytdlp : previous.ytdlp,
      history,
    };

    const saved = this.saved;
    const known = new Set(saved.known);
    // Oldest first: the order they ended in.
    const fresh = saved.primed
      ? [...history.done]
          .reverse()
          .filter(
            (item) =>
              !known.has(item.key) && (saved.floor === null || (item.at ?? 0) >= saved.floor),
          )
      : [];

    const kept = history.done.slice(0, MAX_KNOWN);
    const changed =
      !saved.primed ||
      fresh.length > 0 ||
      kept.length !== saved.known.length ||
      kept.some((item, index) => item.key !== saved.known[index]);
    if (changed) {
      saved.primed = true;
      saved.known = kept.map((item) => item.key);
      saved.floor = history.done.length > MAX_KNOWN ? (kept.at(-1).at ?? null) : null;
      // On disk before the events: a crash in between announces nothing twice.
      this.store.save(saved);
      await this.store.flush();
    }
    if (client !== this.client) {
      return;
    }

    const max = this.timings.maxEventsPerRead;
    const completed = fresh.filter((item) => !isFailed(item)).slice(-max);
    const failed = fresh.filter(isFailed).slice(-max);
    for (const item of completed) {
      logger.debug(`MeTube: finished "${item.title}"`);
      await this.fire(TRIGGERS.COMPLETED, {
        title: item.title,
        url: item.url,
        filename: item.filename,
        size_mb: item.size === null ? 0 : Math.round((item.size / MB) * 10) / 10,
      });
    }
    for (const item of failed) {
      logger.debug(`MeTube: failed "${item.title}"`);
      await this.fire(TRIGGERS.FAILED, {
        title: item.title,
        url: item.url,
        error: item.error.slice(0, 1000),
      });
    }
  }

  applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.server = { ...this.server, reachable: false };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`MeTube ${this.config.url}: ${err.message}`);
    } else {
      logger.debug(`MeTube ${this.config.url}: ${err.message} (again)`);
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Figures ------------------------------------------------------------------

  /** Counts of the last reading, null before it or while MeTube is down. */
  counts() {
    const history = this.server.reachable ? this.server.history : null;
    if (!history) {
      return null;
    }
    const failed = history.done.filter(isFailed).length;
    return {
      running: history.running.length,
      waiting: history.waiting.length,
      finished: history.done.length - failed,
      failed,
    };
  }

  /** The download shown as "current": the oldest one running. */
  current() {
    return this.server.history?.running.at(-1) ?? null;
  }

  /** Total speed of the downloads running, bytes per second. */
  speed() {
    return (this.server.history?.running ?? []).reduce((sum, item) => sum + (item.speed ?? 0), 0);
  }

  /** The finished and failed downloads, last ended first. */
  done() {
    return this.server.history?.done ?? [];
  }

  /** What the widget shows: a change asks Gladys to reload it. */
  widgetView() {
    const history = this.server.reachable ? this.server.history : null;
    return JSON.stringify([
      this.server.reachable,
      this.error?.kind ?? null,
      history && [
        history.running.map((item) => [
          item.key,
          item.status,
          Math.floor((item.percent ?? 0) / 10),
        ]),
        history.waiting.map((item) => item.key),
        history.done.slice(0, 10).map((item) => item.key),
        this.counts(),
      ],
    ]);
  }

  // --- Publishing to Gladys --------------------------------------------------

  snapshot() {
    if (!this.server.reachable) {
      return { reachable: this.server.reachable };
    }
    const current = this.current();
    const last = this.done().find((item) => !isFailed(item));
    return {
      reachable: true,
      counts: this.counts(),
      progress: current?.percent ?? 0,
      speed: this.speed(),
      current: current ? current.title.slice(0, 250) : pick(IDLE_TEXT, this.config.language),
      last: last ? last.title.slice(0, 250) : null,
    };
  }

  async publishStates({ force = false } = {}) {
    if (!this.client) {
      return;
    }
    const now = this.now();
    const down = this.server.reachable === false;
    const states = [];
    for (const { key, externalId, value, text } of featureValues(
      serverIds(this.gladys),
      this.snapshot(),
    )) {
      if (value === null) {
        continue;
      }
      const last = this.published.get(externalId);
      // While MeTube is down, its last counts are not republished as fresh.
      const stale = down && key !== FEATURE_KEYS.ONLINE;
      const fresh =
        last && last.value === value && (stale || now - last.at < this.timings.heartbeatMs);
      if (!force && fresh) {
        continue;
      }
      states.push(
        text
          ? { device_feature_external_id: externalId, text: String(value) }
          : { device_feature_external_id: externalId, state: value },
      );
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishStates(states);
      for (const state of states) {
        this.published.set(state.device_feature_external_id, {
          value: state.text ?? state.state,
          at: now,
        });
      }
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async publishTransport() {
    if (!this.client || this.server.reachable === null) {
      return;
    }
    const value = this.server.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    if (this.transport === value) {
      return;
    }
    try {
      await this.gladys.publishTransports([
        { external_id: serverIds(this.gladys).device, transport: value },
      ]);
      this.transport = value;
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.invalidUrl ? CONNECTION_TEXT.invalid : CONNECTION_TEXT.noServer,
      };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands ----------------------------------------------------------------

  /** A command error in `language`: no server, MeTube down, link refused. */
  commandError(err, language) {
    if (err instanceof RejectedError) {
      return new CommandError(`${pick(ACTION_TEXT.rejected, language)}${err.message}`);
    }
    if (err.kind) {
      return new CommandError(pick(ERROR_TEXT[err.kind], language));
    }
    return err;
  }

  ensureServer(language = this.config?.language) {
    if (!this.client) {
      throw new CommandError(pick(ACTION_TEXT.noServer, language));
    }
  }

  /**
   * Add a link to the queue of MeTube, started at once.
   * @param {unknown} url typed by the user
   * @param {unknown} quality one of QUALITY_KEYS
   * @param {string} [language] of the error messages
   */
  async addUrl(url, quality, language = this.config?.language) {
    this.ensureServer(language);
    const link = typeof url === 'string' ? url.trim() : '';
    let parsed = null;
    try {
      parsed = new URL(link);
    } catch {
      // checked below
    }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || link.length > 2000) {
      throw new CommandError(pick(ACTION_TEXT.badUrl, language));
    }
    const choice = QUALITY_KEYS.includes(String(quality)) ? String(quality) : DEFAULT_QUALITY;
    try {
      await this.client.add(link, choice);
    } catch (err) {
      if (err instanceof RejectedError) {
        logger.info(`MeTube refused a link of ${parsed.host}: ${err.message}`);
        // MeTube lists the refused link as failed: download_failed fires now.
        await this.refresh().catch(() => {});
      }
      throw this.commandError(err, language);
    }
    // The host only: a link may carry a token.
    logger.info(`Download added to MeTube (${parsed.host}, quality ${choice})`);
    await this.refresh().catch(() => {});
  }

  /** Start the downloads added in MeTube without auto start; resolves a toast. */
  async startPending(language = this.config?.language) {
    this.ensureServer(language);
    await this.refresh();
    if (this.error) {
      throw new CommandError(pick(ERROR_TEXT[this.error.kind], language));
    }
    const urls = (this.server.history?.waiting ?? [])
      .filter((item) => item.status === 'pending' && item.url)
      .map((item) => item.url);
    if (urls.length === 0) {
      return ACTION_TEXT.nothingToStart;
    }
    try {
      await this.client.start(urls);
    } catch (err) {
      throw this.commandError(err, language);
    }
    logger.info(`MeTube: ${urls.length} waiting download(s) started`);
    await this.refresh().catch(() => {});
    return ACTION_TEXT.started;
  }

  /** "Test the connection": read MeTube now, one report. */
  async testConnection() {
    if (this.client && this.server.reachable) {
      // Read the version again: MeTube may have been updated.
      this.server = { ...this.server, reachable: null };
    }
    await this.refresh();
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!this.client || this.error) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const counts = this.counts();
      const version = [
        this.server.version,
        this.server.ytdlp ? `(yt-dlp ${this.server.ytdlp})` : null,
      ]
        .filter(Boolean)
        .join(' ');
      message[language] = [
        text.ok(version),
        text.running(counts.running),
        text.waiting(counts.waiting),
        text.finished(counts.finished),
        ...(counts.failed ? [text.failed(counts.failed)] : []),
      ].join(', ');
    }
    return message;
  }
}

export { ERROR_KINDS };
