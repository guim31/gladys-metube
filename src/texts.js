// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the command
// errors and messages, and the text features. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted". test/i18n.test.js
// checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './metube/client.js';

export const pick = (text, language) => text?.[language] ?? text?.en ?? '';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your MeTube server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur MeTube dans la configuration.",
    de: 'Gib die Adresse deines MeTube-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor MeTube en la configuración.',
  },
  invalid: {
    en: 'The address of the MeTube server is not valid (e.g. http://192.168.1.2:8081).',
    fr: "L'adresse du serveur MeTube n'est pas valide (ex. http://192.168.1.2:8081).",
    de: 'Die Adresse des MeTube-Servers ist ungültig (z. B. http://192.168.1.2:8081).',
    es: 'La dirección del servidor MeTube no es válida (p. ej. http://192.168.1.2:8081).',
  },
};

// One explanation per error kind (src/metube/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'MeTube does not answer: check the address and the port (8081).',
    fr: "MeTube ne répond pas : vérifiez l'adresse et le port (8081).",
    de: 'MeTube antwortet nicht: Prüfe die Adresse und den Port (8081).',
    es: 'MeTube no responde: compruebe la dirección y el puerto (8081).',
  },
  [ERROR_KINDS.TLS]: {
    en: 'Certificate refused: use the http:// address on your network.',
    fr: 'Certificat refusé : utilisez l’adresse en http:// de votre réseau.',
    de: 'Zertifikat abgelehnt: Verwende die http://-Adresse in deinem Netzwerk.',
    es: 'Certificado rechazado: use la dirección http:// de su red.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'User name or password refused or missing (reverse proxy in front of MeTube).',
    fr: 'Identifiant ou mot de passe refusé ou manquant (proxy inverse devant MeTube).',
    de: 'Benutzername oder Passwort abgelehnt oder fehlend (Reverse Proxy vor MeTube).',
    es: 'Usuario o contraseña rechazados o ausentes (proxy inverso delante de MeTube).',
  },
  [ERROR_KINDS.NOT_METUBE]: {
    en: 'No MeTube at this address: check the port (8081) and the URL_PREFIX.',
    fr: "Aucun MeTube à cette adresse : vérifiez le port (8081) et l'URL_PREFIX.",
    de: 'Kein MeTube unter dieser Adresse: Prüfe den Port (8081) und das URL_PREFIX.',
    es: 'No hay ningún MeTube en esta dirección: compruebe el puerto (8081) y el URL_PREFIX.',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'The address redirects (a login page?): enter the direct address of MeTube.',
    fr: "L'adresse redirige (page de connexion ?) : saisissez l'adresse directe de MeTube.",
    de: 'Die Adresse leitet um (Anmeldeseite?): Gib die direkte Adresse von MeTube ein.',
    es: 'La dirección redirige (¿página de acceso?): introduzca la dirección directa de MeTube.',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'Unexpected answer from MeTube, see the logs of the integration.',
    fr: "Réponse inattendue de MeTube, voir les logs de l'intégration.",
    de: 'Unerwartete Antwort von MeTube, sieh in den Protokollen der Integration nach.',
    es: 'Respuesta inesperada de MeTube, consulte los registros de la integración.',
  },
};

// Errors and messages of the scene action and of the widget buttons.
export const ACTION_TEXT = {
  noServer: CONNECTION_TEXT.noServer,
  badUrl: {
    en: 'Enter the address of a video or a playlist (https://…).',
    fr: "Saisissez l'adresse d'une vidéo ou d'une playlist (https://…).",
    de: 'Gib die Adresse eines Videos oder einer Playlist ein (https://…).',
    es: 'Introduzca la dirección de un vídeo o de una lista (https://…).',
  },
  // Followed by the message of MeTube.
  rejected: {
    en: 'MeTube refused the link: ',
    fr: 'MeTube a refusé le lien : ',
    de: 'MeTube hat den Link abgelehnt: ',
    es: 'MeTube ha rechazado el enlace: ',
  },
  added: {
    en: 'Added to MeTube.',
    fr: 'Ajouté à MeTube.',
    de: 'Zu MeTube hinzugefügt.',
    es: 'Añadido a MeTube.',
  },
  started: {
    en: 'Waiting downloads started.',
    fr: 'Téléchargements en attente lancés.',
    de: 'Wartende Downloads gestartet.',
    es: 'Descargas en espera iniciadas.',
  },
  nothingToStart: {
    en: 'No download waits for Start.',
    fr: 'Aucun téléchargement n’attend d’être lancé.',
    de: 'Kein Download wartet auf den Start.',
    es: 'Ninguna descarga espera a ser iniciada.',
  },
};

// The "Current download" text feature when nothing downloads.
export const IDLE_TEXT = {
  en: 'Nothing downloading',
  fr: 'Aucun téléchargement',
  de: 'Kein Download',
  es: 'Ninguna descarga',
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (version) => (version ? `OK, MeTube ${version}` : 'OK, MeTube'),
    running: (count) => `${count} in progress`,
    waiting: (count) => `${count} waiting`,
    finished: (count) => `${count} finished`,
    failed: (count) => `${count} in error`,
  },
  fr: {
    ok: (version) => (version ? `OK, MeTube ${version}` : 'OK, MeTube'),
    running: (count) => `${count} en cours`,
    waiting: (count) => `${count} en attente`,
    finished: (count) => `${count} terminé(s)`,
    failed: (count) => `${count} en erreur`,
  },
  de: {
    ok: (version) => (version ? `OK, MeTube ${version}` : 'OK, MeTube'),
    running: (count) => `${count} laufend`,
    waiting: (count) => `${count} wartend`,
    finished: (count) => `${count} abgeschlossen`,
    failed: (count) => `${count} mit Fehler`,
  },
  es: {
    ok: (version) => (version ? `OK, MeTube ${version}` : 'OK, MeTube'),
    running: (count) => `${count} en curso`,
    waiting: (count) => `${count} en espera`,
    finished: (count) => `${count} terminada(s)`,
    failed: (count) => `${count} con error`,
  },
};
