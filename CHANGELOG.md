# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- MeTube in Gladys: one device for the server (online, downloads in progress,
  waiting, finished and in error, progress, title and speed of the current
  download, last download finished).
- Scene triggers: a download finished (title, link, file name, size), a
  download failed (with the error of yt-dlp).
- Scene action: add a video or a playlist to MeTube, in the quality chosen.
- A dashboard widget: the queue with its progress, the last downloads, a form
  to add a video and a button to start the downloads waiting for Start.
- Configuration: address (with the URL_PREFIX of MeTube), user name and
  password of a reverse proxy, refresh interval, language of the feature names.
  Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-metube/commits/main
