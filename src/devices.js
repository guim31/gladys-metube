// -----------------------------------------------------------------------------
// The Gladys device of a MeTube server (`server:main`): online, downloads
// running, waiting, finished and failed (MeTube's history), progress, title
// and speed of the current download, and the last download finished.
//
// Feature category/type couples come from the core table (see
// test/gladys-rules.test.js). should_poll: false: the hub reads MeTube on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';

export const DEVICE_TYPE = 'server';
export const SERVER_ID = 'main';
export const URL_PARAM = 'METUBE_URL';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  RUNNING: 'running',
  WAITING: 'waiting',
  FINISHED: 'finished',
  FAILED: 'failed',
  PROGRESS: 'progress',
  SPEED: 'speed',
  CURRENT: 'current',
  LAST: 'last_finished',
});

const K = FEATURE_KEYS;

// Feature names per language (Gladys does not tell a device integration the
// user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Online',
    [K.RUNNING]: 'Downloads in progress',
    [K.WAITING]: 'Downloads waiting',
    [K.FINISHED]: 'Downloads finished',
    [K.FAILED]: 'Downloads in error',
    [K.PROGRESS]: 'Progress of the current download',
    [K.SPEED]: 'Download speed',
    [K.CURRENT]: 'Current download',
    [K.LAST]: 'Last download finished',
  },
  fr: {
    [K.ONLINE]: 'En ligne',
    [K.RUNNING]: 'Téléchargements en cours',
    [K.WAITING]: 'Téléchargements en attente',
    [K.FINISHED]: 'Téléchargements terminés',
    [K.FAILED]: 'Téléchargements en erreur',
    [K.PROGRESS]: 'Progression du téléchargement en cours',
    [K.SPEED]: 'Vitesse de téléchargement',
    [K.CURRENT]: 'Téléchargement en cours',
    [K.LAST]: 'Dernier téléchargement terminé',
  },
  de: {
    [K.ONLINE]: 'Online',
    [K.RUNNING]: 'Laufende Downloads',
    [K.WAITING]: 'Wartende Downloads',
    [K.FINISHED]: 'Abgeschlossene Downloads',
    [K.FAILED]: 'Fehlgeschlagene Downloads',
    [K.PROGRESS]: 'Fortschritt des aktuellen Downloads',
    [K.SPEED]: 'Download-Geschwindigkeit',
    [K.CURRENT]: 'Aktueller Download',
    [K.LAST]: 'Zuletzt abgeschlossener Download',
  },
  es: {
    [K.ONLINE]: 'En línea',
    [K.RUNNING]: 'Descargas en curso',
    [K.WAITING]: 'Descargas en espera',
    [K.FINISHED]: 'Descargas terminadas',
    [K.FAILED]: 'Descargas con error',
    [K.PROGRESS]: 'Progreso de la descarga en curso',
    [K.SPEED]: 'Velocidad de descarga',
    [K.CURRENT]: 'Descarga en curso',
    [K.LAST]: 'Última descarga terminada',
  },
};

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 1_000_000;

const sensor = (category, type, extra = {}) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

const DEFINITIONS = {
  online: sensor(DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    min: 0,
    max: 1,
  }),
  counter: sensor(DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, {
    min: 0,
    max: COUNTER_MAX,
  }),
  // A percentage that moves every few seconds: no history.
  percent: sensor(DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, {
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    keep_history: false,
    min: 0,
    max: 100,
  }),
  speed: sensor(DEVICE_FEATURE_CATEGORIES.DATARATE, DEVICE_FEATURE_TYPES.DATARATE.RATE, {
    unit: DEVICE_FEATURE_UNITS.MEGABYTES_PER_SECOND,
    min: 0,
    max: 10_000,
  }),
  text: sensor(DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  }),
};

const MB = 1024 * 1024;
const capped = (value) => Math.min(COUNTER_MAX, value);

// Order = display order in Gladys. `value` reads the snapshot of the hub.
const FEATURES = [
  { key: K.ONLINE, definition: 'online', value: (s) => bit(s.reachable) },
  { key: K.RUNNING, definition: 'counter', value: (s) => s.counts && capped(s.counts.running) },
  { key: K.WAITING, definition: 'counter', value: (s) => s.counts && capped(s.counts.waiting) },
  { key: K.FINISHED, definition: 'counter', value: (s) => s.counts && capped(s.counts.finished) },
  { key: K.FAILED, definition: 'counter', value: (s) => s.counts && capped(s.counts.failed) },
  {
    key: K.PROGRESS,
    definition: 'percent',
    value: (s) => (s.counts ? Math.max(0, Math.min(100, Math.floor(s.progress ?? 0))) : null),
  },
  {
    key: K.SPEED,
    definition: 'speed',
    value: (s) => (s.counts ? Math.round(((s.speed ?? 0) / MB) * 100) / 100 : null),
  },
  { key: K.CURRENT, definition: 'text', value: (s) => s.current || null },
  { key: K.LAST, definition: 'text', value: (s) => s.last || null },
];

function bit(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return value ? 1 : 0;
}

export const serverIds = (gladys) => gladys.externalIds(DEVICE_TYPE, SERVER_ID);

/** The server device. */
export function buildServer(gladys, config) {
  const ids = serverIds(gladys);
  const names = NAMES[config.language] ?? NAMES.en;
  return {
    name: `MeTube ${hostOf(config.url)}`.slice(0, 60),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: URL_PARAM, value: config.url }],
    features: FEATURES.map(({ key, definition }) => ({
      ...DEFINITIONS[definition],
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|string|null, text: boolean }>}
 */
export function featureValues(ids, snapshot) {
  return FEATURES.map(({ key, definition, value }) => {
    const read = value(snapshot);
    return {
      key,
      externalId: ids.feature(key),
      value: read === undefined ? null : read,
      text: definition === 'text',
    };
  });
}
