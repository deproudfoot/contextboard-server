# Contextboard Desktop

A native, downloadable Contextboard. This is a **separate project** from the hosted web app in `web/` and `api/`.

You install it on your computer. Boards, tokens, and attached files stay in a folder you own. There is no cloud database, no hosting bill, and no subscription. An older install keeps working if you never upgrade.

## What you get

- A Mac, Windows, and Linux app built with Electron
- The same Contextboard board editor (hex tokens, media, Facebook thread capture)
- A local library on disk instead of Postgres or S3
- Backup, restore, and “reveal data folder” from the File menu
- Optional upgrades — skipping an upgrade does not lock you out of your files

## Where your data lives

The app writes a library folder on this computer:

- macOS: `~/Library/Application Support/Contextboard/library`
- Windows: `%APPDATA%\Contextboard\library`
- Linux: `~/.config/Contextboard/library`

That folder contains:

- `library.json` — boards and settings
- `files/` — images, audio, video, and other attachments

Copy that folder (or use **File → Backup library…**) to make your own backup. Nothing is uploaded.

## Build installers

From this `desktop/` folder:

```bash
npm install
npm run build:mac     # .dmg and .zip
npm run build:win     # NSIS installer and .zip
npm run build:linux   # AppImage and .deb
```

Installers land in `desktop/release/`. Give those files to people. They do not need Node, Postgres, or an account.

## Run from source

```bash
cd desktop
npm install
npm run dev
```

This starts the local library server and the Electron window. Point the library at a folder you choose with `CONTEXTBOARD_DATA=/path/to/library`. You can also run only the library server:

```bash
npm run start:server
```

## How this differs from the web app

| | Hosted web app | Desktop app |
| --- | --- | --- |
| Project | `web/` + `api/` | `desktop/` |
| Login | Invite list + password | Opens your local library |
| Storage | Postgres + optional S3/R2 | Files on this computer |
| Sharing | Cloud share links and collaborators | Not used — data stays here |
| Cost to run | Hosting, traffic, database | None after you install it |
| Upgrades | Deploy a new site | Optional installer |

The hosted site is unchanged. Keep using it if you want a shared cloud board. Use this app when you want to own the copy on your machine.

## Upgrade later

Newer installers read the same `library.json` format (`version: 1`). If a future version needs a change, it will migrate that file in place and leave a working library behind. You can keep running the installer you already have.
