# MeTube

Bring your [MeTube](https://github.com/alexta69/metube) server (the self-hosted
web interface of yt-dlp, to download a video or a playlist on demand) into
Gladys, over your local network: the download queue with its progress, the
finished and failed downloads on a dashboard, scenes that react when a download
ends or fails, and an action that adds a video to MeTube.

The integration was tested against a real MeTube 2026.10.23 (the official
Docker image, downloading a real public-domain video), not yet in a real Gladys
installation: feedback is welcome on the
[Gladys forum](https://community.gladysassistant.com) or in the
[issues](https://github.com/guim31/gladys-metube/issues).

Download only what you have the right to: videos in the public domain, under a
free license, or your own.

## What you need

- Gladys Assistant 5.2.0 or later.
- A **MeTube** server, reachable from Gladys (same network), on the port of its
  web interface (`8081` by default).
- When a reverse proxy in front of MeTube asks for a password (MeTube itself
  has none), that user name and password.

## Set up

1. Install the integration from the Gladys catalog.
2. In **Configuration**, enter the **Address** of MeTube (for example
   `192.168.1.2:8081`; without a port, `8081` is used). If MeTube runs with a
   `URL_PREFIX`, add it: `192.168.1.2:8081/metube`. Behind a reverse proxy that
   asks for a password, fill the **User name** and **Password** too.
3. Save, then click **Test the connection**: the message under the button gives
   the versions of MeTube and yt-dlp, and the downloads in progress, waiting,
   finished and in error.
4. Open the **Discover** tab: one device for the server. Click **Add**, pick a
   room and save.

Options:

- **Refresh interval**: 10 seconds to 2 minutes (30 seconds by default). MeTube
  writes a line in its own log at each reading.
- **Language of the feature names**: the names given to the features when the
  device is added (French by default), and the language of the messages of the
  scene action.

The integration reads the history of MeTube (`/history`, the very list its web
page shows) and adds links through `/add`, as the web page does. It never
deletes a download nor a file.

## The device

One device, **MeTube** followed by the address of the server:

| Feature                          | What it gives                                        |
| -------------------------------- | ---------------------------------------------------- |
| Online                           | 1 when MeTube answers, 0 otherwise                   |
| Downloads in progress            | downloads running (preparing, downloading)           |
| Downloads waiting                | waiting for a free slot, or for the Start button     |
| Downloads finished               | finished downloads in the history of MeTube          |
| Downloads in error               | failed downloads in the history of MeTube            |
| Progress of the current download | in percent, 0 when nothing downloads                 |
| Download speed                   | in MB/s, all downloads together                      |
| Current download                 | its title, as text (“Nothing downloading” when idle) |
| Last download finished           | its title, as text                                   |

The finished and failed downloads are the ones MeTube keeps in its history:
when you clear them in MeTube, the figures go down.

## Dashboard

The **MeTube downloads** widget shows three tiles (in progress, waiting, in
error), the queue (title, progress and speed, or why it waits), and the last
downloads finished or failed (title, file or error, size). Two buttons:

- **Add a video**: a form with the link and the quality; the video is added to
  MeTube and starts at once.
- **Start**: shown only when downloads added without auto start wait for the
  Start button of MeTube; it starts them all.

Add it from the dashboard editor; it needs no setting, and it works before the
device is added.

## Scenes

### Triggers

- **MeTube download finished**: a download has just finished, whoever added it
  (the web page of MeTube, its browser extension, Gladys). Information passed on
  to the actions: the title, the link of the video, the file name and the size
  in MB.
- **MeTube download failed**: a download failed (link not supported, video
  unavailable or private, yt-dlp error). Information: the title, the link and
  the error message.

Each download is announced once, even after a restart of the integration. What
MeTube already had in its history when the integration started is not
announced. The same link downloaded again is announced again.

### Actions

- **Add a video to MeTube**: adds a video or a playlist to the queue of MeTube,
  started at once. Fields: the **Link** (a variable of an earlier step works
  too) and the **Quality**: best video, 1080p, 720p, 480p, or audio only (MP3).
  When MeTube refuses the link, the action fails with its message.

### Scene ideas

- When a MeTube download finishes, send yourself a message: “{title} is ready
  ({size_mb} MB)”.
- When a download fails, send the error message, so you can check the link or
  update yt-dlp.
- Every Sunday at 8 am, add the link of a weekly public-domain show or podcast
  in audio only, to listen to it later.

## Troubleshooting

- **“MeTube does not answer”**: check the address and the port (`8081`), and
  that Gladys can reach the server (same network, firewall).
- **“No MeTube at this address”**: another service answers on this port, or
  MeTube runs with a `URL_PREFIX` missing from the address.
- **“User name or password refused or missing”**: a reverse proxy asks for a
  password; enter its user name and password.
- **“The address redirects”**: a reverse proxy sends to a login page or to
  HTTPS; enter the direct address of MeTube on your network.
- **“MeTube refused the link”**: yt-dlp does not support the site, or the video
  is unavailable; the message of MeTube tells why.
- More details: set the `LOG_LEVEL` of the integration to `debug` and open its
  logs.

## Limits

- A download is seen at the next reading: within the refresh interval.
- At most 10 events of each kind per reading: beyond (a burst of downloads),
  the downloads are counted, not announced.
- The integration does not delete downloads nor files, does not cancel a
  download, and does not manage the subscriptions of MeTube. To follow YouTube
  channels and playlists automatically, see the
  [Pinchflat integration](https://github.com/guim31/gladys-pinchflat).
- A reverse proxy with a login page (OAuth, Authelia…) is not supported: only a
  basic authentication (user name and password).
- Not affiliated with MeTube, yt-dlp or any video site.
