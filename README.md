# MeTube for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
brings a [MeTube](https://github.com/alexta69/metube) server (the self-hosted web
interface of [yt-dlp](https://github.com/yt-dlp/yt-dlp), to download a video or
a playlist on demand) into Gladys, over the local network.

![MeTube for Gladys](cover.png)

## What it does

- **One device**: online, downloads in progress, waiting, finished and in error,
  progress, title and speed of the current download, and the last download
  finished (as text).
- **Scene triggers**: a download finished (title, link, file name, size), a
  download failed (with the error of yt-dlp), whoever added it.
- **Scene action**: add a video or a playlist to MeTube, in the quality chosen
  (best, 1080p, 720p, 480p, audio only as MP3), started at once.
- **Dashboard widget**: in progress, waiting, in error, the queue with its
  progress, the last downloads, an **Add a video** button (a form: link and
  quality) and a **Start** button for the downloads waiting for it.
- Never deletes a download nor a file.

MeTube downloads on demand. To follow YouTube channels and playlists
automatically, see [Pinchflat for Gladys](https://github.com/guim31/gladys-pinchflat).

The user documentation, in English, French, German and Spanish, is in
[`docs/`](docs/en.md) and is shown by Gladys.

Tested against a real MeTube 2026.10.23 (the official Docker image, downloading
a real public-domain video from archive.org, and a link that fails), not yet in
a real Gladys installation: feedback welcome on the
[Gladys forum](https://community.gladysassistant.com) or in the
[issues](https://github.com/guim31/gladys-metube/issues).

**Copyright**: download only what you have the right to (public domain, free
licenses, your own videos). The terms of service of many video sites forbid
downloading; respecting them is your responsibility.

## Requirements

- Gladys Assistant 5.2.0 or later (the form of the widget button).
- A MeTube server reachable from Gladys, on the port of its web interface
  (`8081` by default), with its `URL_PREFIX` if it has one.
- When a reverse proxy in front of it asks for a password (basic
  authentication): that user name and password. MeTube itself has none.

## Installation

In Gladys: **Integrations** → **Install from GitHub**, with the address of this
repository: `https://github.com/guim31/gladys-metube`. Then enter the address of
MeTube in the configuration, and add the device from the **Discover** tab.

## How it works

The integration uses the HTTP API of the MeTube web page, at the chosen interval
(30 seconds by default):

- `GET /history`: the queue (running, waiting for a slot), the downloads added
  without auto start, and the finished and failed downloads;
- `GET /version`: the versions of MeTube and yt-dlp, once per connection;
- `POST /add` (scene action, widget form), in the historical `format` +
  `quality` schema that every version of MeTube accepts;
- `POST /start` (widget button), for the downloads waiting for Start.

No Socket.IO: the history read every few seconds tells the same with no extra
dependency, and the sandbox of Gladys opens no inbound port. The keys of the
downloads already seen are kept under `/data`: a download is announced once,
even after a restart, and what MeTube had before is never announced. Only the
changes are sent to Gladys.

## Limits

- One MeTube server per integration.
- No deletion, no cancel, no management of the subscriptions of MeTube.
- MeTube logs a line for each reading of `/history`.
- Only a basic authentication in front of MeTube, not a login page.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and an in-memory MeTube whose
records have the shape of the real ones (`test/fixtures/metube/`, captured from
MeTube 2026.10.23). See [`CLAUDE.md`](CLAUDE.md) for the architecture and the
pitfalls.

## Credits

- [MeTube](https://github.com/alexta69/metube) by Alex Shnitman (AGPL-3.0). The
  logo of the cover is the icon of its web interface
  (`assets/icons/safari-pinned-tab.svg` of the official image), recolored as the
  official app icon.
  No code of MeTube is copied: the integration only calls its HTTP API.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), which does the
  downloads in MeTube.
- Test video: _Popeye for President_ (1956), public domain, from the
  [Internet Archive](https://archive.org/details/Popeye_forPresident).
- Built on the official
  [integration template](https://github.com/GladysAssistant/integration-template-js)
  and SDK of Gladys Assistant.

Not affiliated with MeTube, yt-dlp or any video site. Licensed under the
[Apache License 2.0](LICENSE).
