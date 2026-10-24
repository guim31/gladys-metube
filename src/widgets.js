// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.2+): `downloads`.
//
// The use case: paste a link from the phone, and see at a glance what MeTube
// is doing. Three tiles (in progress, waiting, in error), the queue as status
// rows (title, progress and speed, or why it waits), the last downloads ended
// as a list (title, file or error), and two buttons:
//   - "Add a video": a form (link, quality) that adds it to MeTube, started
//     at once; the form of a widget button needs Gladys 5.2.0;
//   - "Start", shown only when downloads added without auto start wait for
//     the Start button of MeTube.
//
// Budget (8 components, 6 tiles, 1 status, 1 focal, 4 buttons, 2 texts):
// three tiles, one status, one list, two buttons. The figures are sent as
// values, not bound to device features, so the widget works before the
// device is added to Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS, WIDGET_KEY } from './hub.js';
import { DEFAULT_QUALITY, QUALITY_KEYS, isFailed } from './metube/client.js';
import { ACTION_TEXT, ERROR_TEXT, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  ADD: 'add',
  START: 'start_pending',
});

// Rows of the queue and of the list.
const QUEUE_ROWS = 5;
const LIST_SIZE = 5;

export const TEXT = {
  pick: {
    en: 'Enter the address of your MeTube server in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur MeTube dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines MeTube-Servers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor MeTube en la configuración de la integración.',
  },
  waitingFirst: {
    en: 'Waiting for the first reading of MeTube…',
    fr: 'En attente de la première lecture de MeTube…',
    de: 'Warte auf die erste Abfrage von MeTube…',
    es: 'Esperando la primera lectura de MeTube…',
  },
  none: {
    en: 'Nothing downloaded yet.',
    fr: 'Aucun téléchargement pour le moment.',
    de: 'Noch nichts heruntergeladen.',
    es: 'Todavía no se ha descargado nada.',
  },
  running: { en: 'In progress', fr: 'En cours', de: 'Laufend', es: 'En curso' },
  waiting: { en: 'Waiting', fr: 'En attente', de: 'Wartend', es: 'En espera' },
  failed: { en: 'In error', fr: 'En erreur', de: 'Mit Fehler', es: 'Con error' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  problem: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  // Why a download of the queue waits (MeTube statuses).
  queued: { en: 'Queued', fr: 'En file', de: 'In der Warteschlange', es: 'En cola' },
  pending: {
    en: 'Waits for Start',
    fr: 'Attend Démarrer',
    de: 'Wartet auf Start',
    es: 'Espera Iniciar',
  },
  scheduled: {
    en: 'Scheduled live',
    fr: 'Direct programmé',
    de: 'Geplanter Livestream',
    es: 'Directo programado',
  },
  preparing: { en: 'Preparing', fr: 'Préparation', de: 'Vorbereitung', es: 'Preparando' },
  add: {
    en: 'Add a video',
    fr: 'Ajouter une vidéo',
    de: 'Video hinzufügen',
    es: 'Añadir un vídeo',
  },
  start: { en: 'Start', fr: 'Démarrer', de: 'Starten', es: 'Iniciar' },
  link: { en: 'Link', fr: 'Lien', de: 'Link', es: 'Enlace' },
  linkHelp: {
    en: 'Address of a video or a playlist, from any site yt-dlp supports.',
    fr: "Adresse d'une vidéo ou d'une playlist, de tout site pris en charge par yt-dlp.",
    de: 'Adresse eines Videos oder einer Playlist, von jeder Seite, die yt-dlp unterstützt.',
    es: 'Dirección de un vídeo o de una lista, de cualquier sitio compatible con yt-dlp.',
  },
  quality: { en: 'Quality', fr: 'Qualité', de: 'Qualität', es: 'Calidad' },
};

// Labels of the qualities (keys of src/metube/client.js QUALITIES).
export const QUALITY_TEXT = {
  best: { en: 'Best video', fr: 'Meilleure vidéo', de: 'Bestes Video', es: 'Mejor vídeo' },
  1080: { en: 'Video 1080p', fr: 'Vidéo 1080p', de: 'Video 1080p', es: 'Vídeo 1080p' },
  720: { en: 'Video 720p', fr: 'Vidéo 720p', de: 'Video 720p', es: 'Vídeo 720p' },
  480: { en: 'Video 480p', fr: 'Vidéo 480p', de: 'Video 480p', es: 'Vídeo 480p' },
  audio: {
    en: 'Audio only (MP3)',
    fr: 'Audio seul (MP3)',
    de: 'Nur Audio (MP3)',
    es: 'Solo audio (MP3)',
  },
};

// Megabytes per second, as MeTube shows it.
const RATE = { en: 'MB/s', fr: 'Mo/s', de: 'MB/s', es: 'MB/s' };
const MEGA = { en: 'MB', fr: 'Mo', de: 'MB', es: 'MB' };
const MB = 1024 * 1024;

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const decimal = (value, language) =>
  value.toLocaleString(language === 'en' ? 'en-GB' : language, { maximumFractionDigits: 1 });

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: fit(t(text, language), 300) }],
  };
}

/** One status row of the queue: progress and speed, or why it waits. */
export function queueRow(item, language) {
  let value;
  if (item.status === 'downloading') {
    const parts = [`${Math.floor(item.percent ?? 0)} %`];
    if (item.speed) {
      parts.push(`${decimal(item.speed / MB, language)} ${RATE[language] ?? RATE.en}`);
    }
    value = parts.join(' · ');
  } else {
    value = t(TEXT[item.status] ?? TEXT.preparing, language);
  }
  return {
    label: fit(item.title, 40),
    value: fit(value, 40),
    icon: item.status === 'downloading' ? 'download' : 'clock',
    color: item.status === 'downloading' ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
  };
}

/** One row of the list: title, file (or error), size badge (or error badge). */
export function doneItem(item, language) {
  const failed = isFailed(item);
  const row = { title: fit(item.title || '…', 60) };
  const subtitle = failed ? item.error : item.filename;
  if (subtitle) {
    row.subtitle = fit(subtitle, 60);
  }
  if (failed) {
    row.badge = { text: t(TEXT.error, language), color: WIDGET_COLORS.DANGER };
  } else if (item.size) {
    row.badge = {
      text: fit(`${decimal(item.size / MB, language)} ${MEGA[language] ?? MEGA.en}`, 16),
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  if (failed && item.error) {
    row.description = fit(item.error, 2000);
  }
  return row;
}

/** The "Add a video" button and its form (form texts: multi-language objects). */
function addButton(language) {
  return {
    type: 'button',
    label: t(TEXT.add, language),
    icon: 'plus',
    action: {
      key: ACTIONS.ADD,
      fields: [
        {
          key: 'url',
          type: 'string',
          required: true,
          label: TEXT.link,
          description: TEXT.linkHelp,
          placeholder: { en: 'https://…', fr: 'https://…', de: 'https://…', es: 'https://…' },
        },
        {
          key: 'quality',
          type: 'select',
          required: false,
          default: DEFAULT_QUALITY,
          label: TEXT.quality,
          options: QUALITY_KEYS.map((value) => ({
            value,
            label: QUALITY_TEXT[value],
          })),
        },
      ],
    },
  };
}

async function get(hub, { language = 'en' } = {}) {
  if (!hub.client) {
    return message(TEXT.pick, language);
  }
  if (hub.error) {
    const unreachable = hub.error.kind === ERROR_KINDS.UNREACHABLE;
    return {
      ttl_seconds: 120,
      components: [
        {
          type: 'status',
          items: [
            {
              label: 'MeTube',
              icon: 'alert-triangle',
              value: fit(t(unreachable ? TEXT.offline : TEXT.problem, language), 40),
              color: WIDGET_COLORS.DANGER,
            },
          ],
        },
        { type: 'text', variant: 'body', text: fit(t(ERROR_TEXT[hub.error.kind], language), 300) },
      ],
    };
  }
  const counts = hub.counts();
  if (!counts) {
    return message(TEXT.waitingFirst, language);
  }
  const history = hub.server.history;
  const components = [
    {
      type: 'value',
      value: counts.running,
      label: t(TEXT.running, language),
      icon: 'download',
      color: counts.running ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    },
    { type: 'value', value: counts.waiting, label: t(TEXT.waiting, language), icon: 'clock' },
    {
      type: 'value',
      value: counts.failed,
      label: t(TEXT.failed, language),
      icon: 'alert-circle',
      color: counts.failed ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
  ];
  // Oldest first, the order MeTube serves them in: running, waiting for a
  // slot, then waiting for Start.
  const oldest = (items) => [...items].reverse();
  const queue = [
    ...oldest(history.running),
    ...oldest(history.waiting.filter((item) => item.status !== 'pending')),
    ...oldest(history.waiting.filter((item) => item.status === 'pending')),
  ];
  if (queue.length) {
    components.push({
      type: 'status',
      items: queue.slice(0, QUEUE_ROWS).map((item) => queueRow(item, language)),
    });
  }
  const done = hub.done().slice(0, LIST_SIZE);
  components.push(
    done.length
      ? { type: 'card-list', display: 'list', items: done.map((item) => doneItem(item, language)) }
      : { type: 'text', variant: 'body', text: t(TEXT.none, language) },
  );
  components.push(addButton(language));
  if (history.waiting.some((item) => item.status === 'pending')) {
    components.push({
      type: 'button',
      label: t(TEXT.start, language),
      icon: 'play',
      style: 'secondary',
      action: { key: ACTIONS.START },
    });
  }
  // Short while something downloads: the progress moves.
  return { ttl_seconds: counts.running ? 15 : 300, components };
}

async function action(hub, { actionKey, values = {} }) {
  if (actionKey === ACTIONS.ADD) {
    await hub.addUrl(values.url, values.quality);
    return ACTION_TEXT.added;
  }
  if (actionKey === ACTIONS.START) {
    return hub.startPending();
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
