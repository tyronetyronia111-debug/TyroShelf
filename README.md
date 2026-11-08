# Tyro-Shelf

A TV-style launcher for your emulators, PC games and streaming apps: real box art on a 3D shelf, cases you can open,
and one controller for everything. **Tyro-Shelf is a fork of [Boxshelf](https://github.com/sassiestrhihno/boxshelf-beta)**
(1.82.0-beta.8, by sassiestrhihno), with Playnite-style extras. All credit for the original app goes to its author;
this fork is not affiliated with or endorsed by them.

Windows only (portable `.exe`, no installer). Released under the [GNU GPL v3.0](LICENSE).

## Download

Get the latest `Tyro-Shelf-<version>.exe` from the [Releases](../../releases) page, put it in its own folder and run it.
Everything it saves (settings, caches, your log) goes in a `data` folder next to the exe.

Windows SmartScreen may warn that the file is from an unknown publisher: the exe isn't code-signed. Choose
**More info → Run anyway**, or build it yourself (below).

**Updates:** Tyro-Shelf checks this page's releases when it starts (Settings → About → *Check for updates automatically*).
When a newer build is out it tells you; **Install** downloads it, checks it, closes Tyro-Shelf and starts the new one. Your
settings and games stay as they are, and the old exe is kept as `data\update\previous.exe`. Nothing installs without you pressing Install.

Tyro-Shelf doesn't include or download any games, BIOS files or keys. You supply your own emulators and games.

## What's different from Boxshelf

- **Discord Rich Presence**, per game: its own name, hide it, a picture, or its own Discord application (for the icon beside your name).
- **Background music** from your own `Music` folder, with a volume bar in the quick menu.
- **Collections / custom shelves**: your own order, rename any shelf, hide a game in one shelf only.
- **Animated SteamGridDB covers** (with an "animated only" filter) and a **custom back cover and spine** for PC games.
- **Per-game window mode** for PC games Tyro-Shelf starts itself (custom, GOG, Quiver): the game's own setting,
  borderless fullscreen (for games with no fullscreen of their own), or windowed. Details → Window.
- **Scripts and programs along with a game** (Details → Scripts): PowerShell lines (or a `.ps1` path) that run before the game
  starts, after it started and after it closed, each with an "also run the global script" switch (Settings → PC), plus programs
  that open together with the game and can close with it. The idea is from Playnite's Scripts tab; the scripts see
  `TYRO_GAME_NAME`, `TYRO_GAME_ID`, `TYRO_GAME_EXE`, `TYRO_GAME_DIR` and `TYRO_GAME_SOURCE`.
- **Epic games through Legendary** (Settings → PC): Settings can download [Legendary](https://github.com/derrod/legendary) and sign in
  to Epic with the code from Epic's page; games Legendary has installed start without the Epic Games Launcher. Games only the
  Epic launcher knows keep starting through it. Nothing of Legendary is bundled and no account details are kept by Tyro-Shelf.
- **Play actions** (Details → Play actions, from Playnite's Actions tab): extra ways to start a game (a modded version, another
  launcher), each with its own program, options and folder. Press Play and choose the normal game or one of them.
- **Desktop shortcuts** (Details → Desktop shortcut): a `.lnk` on your desktop that starts Tyro-Shelf and then that game.
- **HoYoPlay games** (Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Honkai Impact 3rd) on the PC shelf, read from HoYoPlay's
  install list. Programs that insist on administrator rights get a normal Windows prompt when started.
- **Controller** works when connected before launch and stays working between games.
- **Taskbar and focus fixes**: the taskbar comes back when you tab out of a game, a launching game is brought to the front
  (and restored if it minimized itself), and the shelf doesn't clutter Alt+Tab while a game runs.
- **Screen-recording compatibility** setting (Settings → System) so recorders don't freeze on the shelf.
- No Alt-key menu, the update check is removed, and the app has its own id so it can sit beside Boxshelf.

## Build it yourself

You need [Node.js](https://nodejs.org/) (LTS).

```
npm install
npm start                     # run it from source (npm run windowed for a window)
npx electron-builder --win portable    # builds dist\Tyro-Shelf.exe
```

## Releasing (for the maintainer)

Push a tag and GitHub Actions builds the exe and attaches it to a release. The tag is a whole number, always higher
than the last one (`v18`, then `v19`...): it becomes the build number the in-app updater compares, and the repository
name is stamped in automatically, so the updater needs no setup:

```
git tag v18
git push origin v18
```

Or, from Windows, double-click `Publish release.bat` and type the number: it commits what changed, pushes it and tags it.

Write the release notes as a bulleted list (`- one thing`): the first few bullets show on the shelf's "update available" card.
An exe built any other way (not by this workflow) has no repository set, so its updater stays off.

## Credits and licence

- **Playnite** (MIT, <https://github.com/JosefNemec/Playnite>): the idea of per-game scripts and desktop shortcuts. No Playnite code is used.
- **HoYoPlay Library** add-on by darklinkpower (MIT, <https://github.com/darklinkpower/PlayniteExtensionsCollection>): where HoYoPlay keeps its install list. Rewritten, no code used.
- **Legendary** by derrod / hawkeye116477 (GPL-3.0, <https://github.com/derrod/legendary>): downloaded from GitHub only when you ask; not part of this repository.
- **Boxshelf** by sassiestrhihno: the app this is built on (GPL-3.0). Original: <https://github.com/sassiestrhihno/boxshelf-beta>
- Third-party components and fonts are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- Tyro-Shelf is free software under the GNU General Public License v3.0: you can use, change and share it under the same terms,
  and anyone you give a copy to is entitled to the source (this repository).
- Box art, manuals and game info come from third-party services at your request and belong to their owners.
