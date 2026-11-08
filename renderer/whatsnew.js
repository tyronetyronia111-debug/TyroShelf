// What's new: each version's notes, shipped with the app (so the card after an update works offline, and on the Thor).
// The shelf shows a version's highlights once, the first time it starts; Settings → System → What's new lists the
// items (a short headline per row; the side card says more). scripts/release-notes.js prints the same notes as Markdown
// for the GitHub release, so the app and the release page always say the same thing.
// { version (Windows / Linux), android (the Android build with the same changes, if any), date, title, highlights[],
//   sections: [{ h, items: [[headline, more]] }] }; newest first.
window.BS_WHATSNEW = [
  {
    version: '1.82.0-beta.8', android: '1.82.0-beta.8', date: '2026-11-06', title: 'Video previews, a new Details page and easier setup',
    highlights: [
      'Video previews: rest on a game and its trailer plays, on the shelf and in Details, console games too',
      'A new Details page: the game\'s logo, play stats, tabs and one big Play button',
      'Add many games at once: pick several, scan a folder, or import from Playnite (experimental)',
      'Ten more consoles, including Saturn, Neo Geo, Arcade and DOS',
      'Set up for me: one switch sets up RetroArch, Dolphin, DuckStation, PCSX2 and PPSSPP'
    ],
    // (scripts/release-notes.js prints these under the notes: where each part works)
    platforms: [
      'Windows: everything above.',
      'Linux / Steam Deck (experimental): everything except Set up for me, console trailers, scanning a folder of games and the Playnite import. On a Steam Deck, add Tyro-Shelf to Steam (it offers to) and play from Game Mode.',
      'Android (AYN Thor): the new Details page and the magazines fix; video previews, Add games and the new consoles come to Android later.'
    ],
    sections: [
      { h: 'New', items: [
        ['Video previews', 'Rest on a game and its preview plays, softly behind the shelf and behind the case in Details: your own videos (ES-DE, EmuDeck, RetroBat, LaunchBox or a folder of your own), Steam\'s own trailers for Steam games, and console trailers from YouTube. Settings → Video previews, which also sets how soon they start (half a second to 15 seconds).'],
        ['Console trailers', 'A console game\'s YouTube trailer is kept as a short clip (about 1 MB) the first time you rest on it, so it plays on the shelf just like a Steam trailer. It needs a free helper (yt-dlp), fetched once with one press: Tyro-Shelf asks you on the shelf, or Settings → Video previews.'],
        ['A new Details page', 'The game\'s logo, time played and last played, one Play button with Manual, Inspect and More beside it, and tabs: Overview, Media and Your copy (LB / RB, or Q / E). The game\'s art or its preview fills the background.'],
        ['Add many games at once', 'Settings → Custom games → Add games, or the Add games tile at the end of the Custom shelf: pick several programs at once, or point Tyro-Shelf at a folder of games and tick the ones to add.'],
        ['Import from Playnite (experimental)', 'Bring your Playnite library over in one go: games you added by hand, with their covers, and your emulated games\' folders. You see what will be added first, and one press removes it all again. Tell us how it goes.'],
        ['Steam Deck: Game Mode and Add to Steam', 'Tyro-Shelf now starts from Steam and in Game Mode by itself. On a Steam Deck in Desktop Mode it offers to add itself to Steam, so your controller works as a gamepad in games (outside Steam, B is the Esc key, which quits most emulators). Any time: Settings → System → Add Tyro-Shelf to Steam.'],
        ['Switch: Citron and Ryujinx', 'Found and started as well as Eden, so EmuDeck\'s Switch emulator works without setting anything up.'],
        ['Ten more consoles', 'Saturn, TurboGrafx-16, Neo Geo, Arcade, Sega CD, 32X, Atari 2600, Lynx, WonderSwan and DOS, through RetroArch, each with its own case and colours. Arcade games show their real names.'],
        ['Set up for me', 'Settings → a console → Set up for me: your controller mapped, the Home menu\'s Save and Load keys, one shared BIOS folder and graphics that suit your PC. Your files are backed up first, and Undo puts them back. The first run can do it for you.'],
        ['RetroArch cores and BIOS files', 'A missing RetroArch core downloads by itself the first time you play, and Settings checks the BIOS files each console needs.'],
        ['More PC stores', 'GOG, Ubisoft Connect, EA app and Xbox / Game Pass games join Steam and Epic on the PC shelf.'],
        ['Library tools', 'Filter by decade, genre, players or co-op, and make collections: shelves of your own, from Details → More → Collections.'],
        ['Patch notes in the app', 'A card on the shelf when a new version is out, with its highlights; What\'s new after you update; and every version\'s notes in Settings → System → What\'s new.']
      ] },
      { h: 'Better', items: [
        ['A tidier first run', 'Only the consoles you have games for come ticked; the rest fold away, grouped by maker.'],
        ['Easier to find', 'Video previews has its own place in Settings, and Add games its own page, so the main pages stay short.']
      ] },
      { h: 'Fixed', items: [
        ['Trailers play again', 'YouTube stopped playing trailers opened on their own. They now play in Tyro-Shelf\'s own player.'],
        ['Android: magazines and guides always show', 'The reading corner\'s list could stay empty on some devices; it now always loads.'],
        ['Your changes stay put', 'A game you renamed, or a finished "Set up for me", could be undone by changing another setting in the same visit.'],
        ['No accidental holds', 'Holding A on a disc, or holding Restart / Shut down, now stops if you switch away or pull down the notification shade, instead of finishing on its own.'],
        ['Covers and the museum', 'A Wi-Fi sign-in page could be saved as a game\'s cover, and the museum\'s camera jumped when you touched the controls after leaving it idle.'],
        ['Android: taps after a quick swipe', 'After flicking the shelf or the console bar, the first tap on a game or console did nothing. It works first time now.']
      ] }
    ]
  },  {
    version: '1.82.0-beta.6', android: '0.4.0-beta.1', date: '2026-11-05', title: 'Now on Android and Linux, and clean game transitions',
    highlights: [
      'Tyro-Shelf on Android (AYN Thor) and Linux / Steam Deck',
      'Starting and quitting a game shows nothing but the game',
      'Twelve retro consoles, from PlayStation to Dreamcast'
    ],
    sections: [
      { h: 'New', items: [
        ['Android and Linux', 'The AYN Thor gets Tyro-Shelf with its bottom screen; Linux and the Steam Deck get an AppImage (experimental).'],
        ['Retro consoles', 'PlayStation, NES, SNES, Nintendo 64, Game Boy, Game Boy Color, Game Boy Advance, DS, Mega Drive, Master System, Game Gear and Dreamcast.'],
        ['Rename and change covers', 'Give any game the name you want, and pick its cover from every one found.']
      ] },
      { h: 'Better', items: [
        ['Clean game transitions', 'No taskbar, no desktop and no gaps while a game starts or closes: it feels like a console.']
      ] }
    ]
  }
];
