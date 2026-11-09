/**
 * Spotter's knowledge base: a built-in FAQ bot (no server, no AI, no key). Every answer is plain
 * text, rendered as text — never HTML. `keywords` are matched against the question after
 * normalising (lower case, light stemming, synonyms in match.ts); `phrases` score higher.
 * Links are internal routes only.
 */
export interface SpotterLink {
  label: string;
  href: `/${string}`;
}

export interface Intent {
  id: string;
  /** the question as a suggestion chip; also a test fixture (it must match its own intent) */
  question: string;
  topic: 'site' | 'tactics' | 'chat';
  keywords: string[];
  phrases?: string[];
  answer: string;
  link?: SpotterLink;
  /** follow-up chips offered under the answer (intent ids) */
  next?: string[];
}

export const INTENTS: Intent[] = [
  // ---- using RotationLab ---------------------------------------------------------------------
  {
    id: 'what-is',
    question: 'What is RotationLab?',
    topic: 'site',
    keywords: ['rotationlab', 'about', 'site', 'app', 'what', 'purpose', 'use'],
    phrases: ['what is this', 'what can i do', 'what is rotationlab', 'how does this work'],
    answer:
      'RotationLab is a shared tactical map for your squad. Open a room, invite your team, and draw drops, rotations, zones and enemy calls on Erangel, Miramar or Rondo — everyone sees it live, with chat and map pings alongside.',
    link: { label: 'Explore the maps', href: '/explore' },
    next: ['create-room', 'draw-tools', 'drop-erangel'],
  },
  {
    id: 'create-room',
    question: 'How do I create a room?',
    topic: 'site',
    keywords: ['create', 'room', 'new', 'make', 'start', 'open', 'squad', 'team'],
    phrases: ['create a room', 'new room', 'make a room', 'start a room'],
    answer:
      'Sign up (free), then on your dashboard press "New room", give it a name and pick the first map. The room starts with one board and three layers: Plan, Enemies and Zones. You are its Owner.',
    link: { label: 'Go to dashboard', href: '/dashboard' },
    next: ['invite', 'boards'],
  },
  {
    id: 'invite',
    question: 'How do I invite my squad?',
    topic: 'site',
    keywords: ['invite', 'friend', 'teammate', 'squad', 'add', 'join', 'link', 'code', 'share'],
    phrases: ['invite my squad', 'add teammates', 'invite link', 'join a room', 'join code'],
    answer:
      'In the room, press "Invite" in the top bar. Copy the invite link and send it to your squad — or share the invite code, which they paste into "Have an invite code?" on their dashboard. You choose their role when you create the invite: Editor (can draw) or Viewer (can watch, measure and use the laser). Teammates open the link, log in and they are in.',
    next: ['roles', 'share-link'],
  },
  {
    id: 'roles',
    question: 'What are Owner, Editor and Viewer?',
    topic: 'site',
    keywords: ['role', 'viewer', 'owner', 'editor', 'permission', 'kick', 'ban', 'admin'],
    phrases: ['what can viewers do', 'change role', 'can viewers draw', 'viewers draw'],
    answer:
      '• Owner: everything, including room settings, deleting boards, locking layers, kicking or blocking members. There is exactly one.\n• Editor: draws, adds boards, saves and restores snapshots.\n• Viewer: watches live, chats, measures and uses the laser pointer — but cannot draw.\nThe Owner changes roles in Room settings → Members.',
  },
  {
    id: 'boards',
    question: 'What are boards?',
    topic: 'site',
    keywords: ['board', 'tab', 'plan', 'map', 'switch', 'duplicate', 'rename'],
    phrases: ['new board', 'add a board', 'switch map', 'change map', 'another map'],
    answer:
      'A board is one plan on one map — like "Erangel – Drop A". A room holds up to 20, shown as tabs in the top bar. Press + to add one (pick a name and map), use the tab menu to rename, duplicate or open snapshots, and keys 1–9 to jump between tabs.',
    next: ['snapshots', 'layers'],
  },
  {
    id: 'draw-tools',
    question: 'How do I draw on the map?',
    topic: 'site',
    keywords: [
      'draw',
      'tool',
      'pen',
      'line',
      'arrow',
      'circle',
      'polygon',
      'text',
      'eraser',
      'sketch',
    ],
    phrases: ['how to draw', 'draw a route', 'draw an arrow', 'drawing tools'],
    answer:
      'Pick a tool on the left toolbar (or press its key): Select V, Pen P, Line L, Arrow A, Circle C, Polygon G, Text T, Marker M, Eraser E, Measure R, Laser K. Drag on the map to draw; hold Shift to snap lines to 15° or draw a circle from its centre. The style bar at the bottom sets colour, width, dashes and fill. Ctrl+Z undoes.',
    next: ['shortcuts', 'markers', 'zone-tool'],
  },
  {
    id: 'shortcuts',
    question: 'What are the keyboard shortcuts?',
    topic: 'site',
    keywords: ['shortcut', 'key', 'keyboard', 'hotkey', 'undo', 'redo', 'delete', 'duplicate'],
    phrases: ['keyboard shortcuts', 'hot keys'],
    answer:
      '• Tools: V P L A C G T M E R K\n• Undo Ctrl+Z · Redo Ctrl+Shift+Z or Ctrl+Y\n• Delete selection: Delete / Backspace · Duplicate: Ctrl+D · Select all: Ctrl+A\n• Esc cancels · Enter finishes a polygon or arrow · Space (hold) pans\n• 1–9 switch board · N map labels · Shift+G grid · / chat · ] side panel · ? all shortcuts\nOn a Mac use Cmd instead of Ctrl.',
  },
  {
    id: 'markers',
    question: 'How do I mark enemies and my squad?',
    topic: 'site',
    keywords: ['marker', 'mark', 'enemy', 'pin', 'vehicle', 'player', 'icon', 'loot', 'number'],
    phrases: ['mark enemies', 'enemy squad', 'place a marker', 'own squad'],
    answer:
      'Press M (Marker) and pick a kind: own squad, own player (1–4), enemy squad (numbered 1–25), vehicle, drop, danger, hold, pin or loot (with 80 item icons). Click the map to place it. Select a marker to add a label — team name, IGN or a note.',
    next: ['layers', 'pings'],
  },
  {
    id: 'zone-tool',
    question: 'How do I draw the zone?',
    topic: 'site',
    keywords: ['preset', 'circle', 'zone', 'safe', 'white', 'phase', 'ring'],
    phrases: ['draw the zone', 'zone preset', 'safe zone', 'white circle'],
    answer:
      'Pick Circle (C) and drag from the centre outwards (Shift draws from the centre). In the style bar, "Zone presets" sizes the circle to a phase so you can sketch where the next safe zones could land. The Zones layer keeps them separate from your plan.',
    next: ['zone-play', 'measure'],
  },
  {
    id: 'layers',
    question: 'What are layers?',
    topic: 'site',
    keywords: ['layer', 'lock', 'hide', 'show', 'visibility', 'order'],
    answer:
      "Layers keep a board tidy: every room starts with Plan, Enemies and Zones. In the side panel's Layers tab you can hide a layer, add new ones, recolour or rename them. The Owner can lock a layer so nobody — not even the Owner — can change it until it is unlocked.",
  },
  {
    id: 'measure',
    question: 'How far is it and how long to rotate?',
    topic: 'site',
    keywords: [
      'measure',
      'distance',
      'far',
      'time',
      'travel',
      'minute',
      'metre',
      'meter',
      'long',
      'speed',
    ],
    phrases: ['how far', 'how long', 'travel time', 'measure distance'],
    answer:
      'Press R (Measure), click points along your route and double-click or press Enter to finish. You get each leg in metres plus the total, with an approximate time on foot and by vehicle. Everyone can measure, Viewers too. Editors can keep it with "Save as line".',
    next: ['rotation-basics', 'vehicles'],
  },
  {
    id: 'pings',
    question: 'How do map pings in chat work?',
    topic: 'site',
    keywords: ['ping', 'chat', 'message', 'spot', 'location', 'grid', 'fly'],
    phrases: ['map ping', 'ping a spot'],
    answer:
      'In the chat input press the 📍 button, then click the spot on the map. Your message carries a chip like "F-M 4,7 · Erangel – Drop A"; when a teammate clicks it, their map flies to that exact spot on the right board and pulses it. Press / to jump to the chat box.',
  },
  {
    id: 'snapshots',
    question: 'Can I save versions of a plan?',
    topic: 'site',
    keywords: ['snapshot', 'save', 'version', 'restore', 'history', 'backup', 'revert'],
    phrases: ['save a version', 'go back', 'restore plan'],
    answer:
      'Yes — snapshots. From the board tab\'s menu choose "Snapshots…", name it and save (up to 50 per board). Click one to preview it; Editors can restore it for everyone. RotationLab also saves an automatic snapshot before every restore and before a layer is cleared.',
  },
  {
    id: 'undo',
    question: 'I deleted something by mistake',
    topic: 'site',
    keywords: ['undo', 'mistake', 'deleted', 'wrong', 'accident', 'redo', 'back'],
    phrases: ['by mistake', 'undo'],
    answer:
      "Press Ctrl+Z (Cmd+Z on Mac) to undo your own changes; Ctrl+Shift+Z or Ctrl+Y redoes. If a whole board went wrong, restore an earlier snapshot from the board tab's menu → Snapshots.",
  },
  {
    id: 'export',
    question: 'Can I download the map as an image?',
    topic: 'site',
    keywords: ['export', 'download', 'png', 'image', 'screenshot', 'picture', 'save'],
    phrases: ['download the map', 'save as image', 'export png'],
    answer:
      'Yes. Open the room\'s "More" (⋯) menu in the top bar and choose Export PNG. It saves exactly what you see — map, grid and drawings — at up to 2× resolution, with a small footer naming the room, board and map.',
  },
  {
    id: 'share-link',
    question: 'Can someone view a board without an account?',
    topic: 'site',
    keywords: ['share', 'public', 'link', 'account', 'without', 'view', 'read', 'only', 'coach'],
    phrases: ['share link', 'without an account', 'read only'],
    answer:
      'Yes: from the board tab\'s menu choose "Share link…" (Owner or Editor). Pick an expiry (24 h, 7 days, 30 days or never) and copy the link — it is only shown once. Anyone with it sees the board read-only, with the grid and Measure, but no chat or member names. You can regenerate or revoke it any time.',
  },
  {
    id: 'explore',
    question: 'Can I try it without signing up?',
    topic: 'site',
    keywords: ['try', 'demo', 'explore', 'sign', 'free', 'guest', 'without', 'account'],
    phrases: ['without signing up', 'try it', 'demo'],
    answer:
      'Yes — Explore shows demo boards for every map, read-only, with labels, the grid and the Measure tool. Creating your own rooms needs a free account.',
    link: { label: 'Open Explore', href: '/explore' },
  },
  {
    id: 'follow',
    question: "How do I follow a teammate's view?",
    topic: 'site',
    keywords: ['follow', 'view', 'presence', 'avatar', 'cursor', 'laser', 'where', 'teammate'],
    phrases: ['follow a teammate', 'see their screen', 'laser pointer'],
    answer:
      "Click a teammate's avatar in the top bar and choose Follow — your map tracks their view until you move. Their cursors show live on the map; press K for the laser pointer to point at something without drawing.",
  },
  {
    id: 'account',
    question: 'I forgot my password',
    topic: 'site',
    keywords: ['password', 'forgot', 'reset', 'login', 'log', 'account', 'email', 'verify', 'sign'],
    phrases: ['forgot my password', 'cant log in', 'reset password'],
    answer:
      'On the login page choose "Forgot password?" and enter your email; the reset link lasts a short time. Your IGN, display name and password live in Settings once you are logged in.',
    link: { label: 'Log in', href: '/login' },
  },
  {
    id: 'sync',
    question: 'What does Synced / Reconnecting mean?',
    topic: 'site',
    keywords: [
      'sync',
      'synced',
      'saving',
      'reconnect',
      'offline',
      'lag',
      'slow',
      'connection',
      'internet',
    ],
    phrases: ['not syncing', 'reconnecting'],
    answer:
      'The dot in the top bar shows your connection: Synced (green, everyone has your changes), Saving…, Reconnecting… (amber) or Offline (red). Offline changes are queued and sent when you are back online — keep the tab open.',
    next: ['waking'],
  },
  {
    id: 'waking',
    question: 'Why is the site slow to load sometimes?',
    topic: 'site',
    keywords: ['slow', 'loading', 'waking', 'server', 'wait', 'stuck', 'down', 'sleep'],
    phrases: ['waking the server', 'takes long to load'],
    answer:
      'RotationLab runs on free hosting, which naps when nobody is planning. The first request after a quiet spell can take up to about 30 seconds while the server wakes — you will see a "Waking the server…" card. After that it is quick.',
  },
  {
    id: 'mobile',
    question: 'Does it work on my phone?',
    topic: 'site',
    keywords: ['phone', 'mobile', 'android', 'iphone', 'tablet', 'touch', 'work'],
    answer:
      'Yes. On a phone the room is a view-and-chat layout: full-screen map, a board dropdown, chat as a sheet, and the Select, Marker, Measure and Laser tools. A tablet gets every tool in a bottom bar. For full drawing, use a tablet or laptop.',
  },
  {
    id: 'labels-grid',
    question: 'How do I hide map labels or the grid?',
    topic: 'site',
    keywords: ['label', 'grid', 'hide', 'names', 'letters', 'clean', 'zoom', 'fit'],
    phrases: ['hide labels', 'hide the grid', 'map names'],
    answer:
      'Press N to toggle place names and Shift+G to toggle the grid, or use the buttons in the bottom-right corner of the map, next to zoom and fit. Grid squares are about 1 km, lettered like the in-game map.',
  },

  // ---- BGMI tactics --------------------------------------------------------------------------
  {
    id: 'drop-general',
    question: 'How should we choose where to drop?',
    topic: 'tactics',
    keywords: ['drop', 'choose', 'land', 'landing', 'where', 'jump', 'plane', 'spot', 'loot'],
    phrases: ['where to drop', 'where should we land', 'drop spot'],
    answer:
      "Pick a drop from the flight path and your squad's style:\n• Hot drops (lots of loot, lots of squads) suit aggressive teams that win early fights.\n• Edge drops a few km off the path give safe loot and a calm rotation in.\n• In scrims, agree a home drop per map and a backup if it is contested.\nDraw both on a board with the Drop marker so everyone jumps to the same roof.",
    next: ['drop-erangel', 'drop-miramar', 'drop-rondo'],
  },
  {
    id: 'drop-erangel',
    question: 'Best drops on Erangel?',
    topic: 'tactics',
    keywords: [
      'erangel',
      'drop',
      'pochinki',
      'school',
      'georgopol',
      'military',
      'sosnovka',
      'mylta',
      'yasnaya',
      'best',
      'land',
    ],
    phrases: ['drops on erangel', 'erangel drop', 'land on erangel'],
    answer:
      'Erangel:\n• Hot: Pochinki (central, many buildings), School & Apartments, Georgopol (containers + city), Military Base on Sosnovka island, Mylta Power and Yasnaya Polyana.\n• Calmer: Severny, Stalber, Kameshki, Zharki, Primorsk, Gatka, Lipovka.\nRemember Military Base only connects to the mainland by two bridges — plan your exit early.',
    link: { label: 'Open Erangel', href: '/maps/erangel' },
    next: ['bridges', 'rotation-basics'],
  },
  {
    id: 'drop-miramar',
    question: 'Best drops on Miramar?',
    topic: 'tactics',
    keywords: [
      'miramar',
      'pecado',
      'hacienda',
      'leones',
      'pozo',
      'martin',
      'desert',
      'drop',
      'best',
    ],
    phrases: ['drops on miramar', 'miramar drop'],
    answer:
      'Miramar:\n• Hot: Pecado (central, arena and casino), Hacienda del Patrón, Los Leones (huge city in the south-east), El Pozo, San Martín.\n• Miramar is big and open — whatever you drop, secure vehicles straight away, and expect long rotations over ridges.',
    link: { label: 'Open Miramar', href: '/maps/miramar' },
    next: ['vehicles', 'rotation-basics'],
  },
  {
    id: 'drop-rondo',
    question: 'Tips for Rondo?',
    topic: 'tactics',
    keywords: ['rondo', 'drop', 'tips', 'best'],
    phrases: ['drops on rondo', 'rondo tips'],
    answer:
      'Rondo is an 8×8 km map that mixes dense city blocks with open countryside and water. Turn on map labels (N) to see the place names, measure the gaps between cover before you commit to a rotation, and keep a vehicle — the open stretches punish late walkers.',
    link: { label: 'Open Rondo', href: '/maps/rondo' },
    next: ['rotation-basics', 'vehicles'],
  },
  {
    id: 'rotation-basics',
    question: 'How do we plan a rotation?',
    topic: 'tactics',
    keywords: [
      'rotation',
      'rotate',
      'route',
      'move',
      'path',
      'plan',
      'edge',
      'center',
      'centre',
      'when',
    ],
    phrases: ['plan a rotation', 'how to rotate', 'edge or center', 'when to rotate'],
    answer:
      'A good rotation is decided before the zone closes:\n• Rotate early: arrive at your next compound before other squads take it.\n• Edge play keeps your back to the blue zone so fights come from one side; centre play gives you the best position but fights from all sides.\n• Plan the route cover to cover — ridges, compounds, trees — and avoid open fields and bridges in the late game.\n• Draw it on the board with the Arrow tool and measure it (R) to check the timing.',
    next: ['zone-play', 'third-party', 'measure'],
  },
  {
    id: 'zone-play',
    question: 'How do we play the zone?',
    topic: 'tactics',
    keywords: ['zone', 'blue', 'circle', 'safe', 'phase', 'damage', 'shrink', 'timing'],
    phrases: ['play the zone', 'blue zone', 'zone timing'],
    answer:
      "The safe zone shrinks in phases, and blue-zone damage grows each phase — early zones can be walked through with heals, late ones cannot.\n• Move when the next circle is shown, not when the blue zone touches you.\n• Take a compound or ridge inside the next circle on the side you rotate from.\n• Sketch likely next circles with the Circle tool's zone presets and agree a plan for each.",
    next: ['final-circle', 'compound'],
  },
  {
    id: 'vehicles',
    question: 'When should we use vehicles?',
    topic: 'tactics',
    keywords: ['vehicle', 'car', 'uaz', 'dacia', 'buggy', 'bike', 'boat', 'drive', 'fuel'],
    phrases: ['use vehicles', 'car or walk'],
    answer:
      'Vehicles win long rotations — essential on Miramar and Rondo. Park them as cover when you stop, keep one spare per squad, and watch fuel. Late in the game engines give your position away, so drive to your final compound early and go on foot from there. Mark parked cars with the Vehicle marker.',
  },
  {
    id: 'bridges',
    question: 'How do we cross the Erangel bridges?',
    topic: 'tactics',
    keywords: ['bridge', 'cross', 'erangel', 'camp', 'island', 'military', 'swim', 'boat'],
    phrases: ['cross the bridge', 'bridge camp'],
    answer:
      'Bridges to Military Base are classic camp spots. Cross early, before squads set up; scout the far end and smoke your path if you must cross under fire. Alternatives: a boat, or swimming at a narrow point if the zone gives you time. Mark known bridge campers with the Danger marker.',
  },
  {
    id: 'compound',
    question: 'How do we hold a compound?',
    topic: 'tactics',
    keywords: ['compound', 'hold', 'house', 'building', 'defend', 'position', 'cover'],
    phrases: ['hold a compound', 'defend a house'],
    answer:
      "Give every player a window or angle covering a different side, keep one player on the stairs or door, and stay off the same floor so one grenade cannot take two of you. Use the Hold marker for each player's spot so nobody doubles up.",
  },
  {
    id: 'third-party',
    question: 'How do we avoid getting third-partied?',
    topic: 'tactics',
    keywords: ['third', 'party', 'thirdparty', 'fight', 'push', 'enemy', 'gunfight'],
    phrases: ['third party', 'third partied'],
    answer:
      'Finish fights fast or disengage, then reposition before looting — gunfire tells every squad nearby where you are. Keep one player watching outwards during a fight, and mark squads you hear with numbered Enemy markers so everyone tracks them.',
  },
  {
    id: 'final-circle',
    question: 'Tips for the final circles?',
    topic: 'tactics',
    keywords: ['final', 'last', 'endgame', 'end', 'circle', 'win', 'chicken', 'dinner'],
    phrases: ['final circle', 'end game', 'chicken dinner'],
    answer:
      'Final circles are about information and utility: count the squads left, hold cover inside the next circle early, prefer crouch or prone over running in the open, and save smokes and grenades for the last moves. Let other squads fight each other first.',
    next: ['utility'],
  },
  {
    id: 'utility',
    question: 'How should we use smokes and grenades?',
    topic: 'tactics',
    keywords: ['smoke', 'grenade', 'nade', 'molotov', 'stun', 'utility', 'throwable'],
    phrases: ['use smokes', 'use grenades'],
    answer:
      'Smokes give cover to revive, cross open ground or push; throw them between you and the threat, not on top of yourself. Grenades flush squads from cover, molotovs deny doorways and stairs, stuns help a push. Each player should carry a few for the late game.',
  },
  {
    id: 'loot',
    question: 'What should we loot first?',
    topic: 'tactics',
    keywords: [
      'loot',
      'gun',
      'weapon',
      'armor',
      'armour',
      'helmet',
      'vest',
      'meds',
      'heal',
      'ammo',
    ],
    phrases: ['loot first', 'what to loot'],
    answer:
      'First a gun, then helmet and vest, then healing (bandages, first aid kits, energy drinks and painkillers), then ammo and scopes. Do not over-loot: being late to rotate costs more than a better scope. Use Loot markers to call out good finds.',
  },
  {
    id: 'scrim-plan',
    question: 'How do we prepare for scrims?',
    topic: 'tactics',
    keywords: ['scrim', 'tournament', 'practice', 'igl', 'prepare', 'strategy', 'comms', 'team'],
    phrases: ['prepare for scrims', 'scrim plan'],
    answer:
      'Make one board per map: home drop, backup drop, two or three rotation plans depending on where the first circle lands, and the enemy squads you usually meet nearby. Save a snapshot of each plan. During review, draw what actually happened next to the plan and compare.',
  },

  // ---- small talk ----------------------------------------------------------------------------
  {
    id: 'hello',
    question: 'Hi',
    topic: 'chat',
    keywords: ['hi', 'hello', 'hey', 'yo', 'sup', 'namaste', 'hii'],
    answer:
      "Hey! I'm Spotter. I can explain how RotationLab works or share BGMI tactics — drops, rotations, zones. What do you need?",
    next: ['what-is', 'drop-general', 'rotation-basics'],
  },
  {
    id: 'thanks',
    question: 'Thanks',
    topic: 'chat',
    keywords: ['thanks', 'thank', 'thx', 'ty', 'great', 'nice', 'cool', 'ok', 'okay'],
    answer: 'Anytime. Good luck out there — see you in the final circle.',
  },
  {
    id: 'who',
    question: 'Who are you?',
    topic: 'chat',
    keywords: ['who', 'you', 'bot', 'spotter', 'human', 'ai'],
    phrases: ['who are you', 'are you a bot', 'are you ai'],
    answer:
      'I\'m Spotter, RotationLab\'s built-in help bot. I am not an AI — I match your question to answers written for this site, so I work best with short questions like "how do I invite my squad" or "best drops on Erangel".',
  },
];

export const STARTERS = ['what-is', 'invite', 'draw-tools', 'drop-erangel', 'rotation-basics'];
export const FALLBACK_SUGGESTIONS = ['create-room', 'draw-tools', 'drop-general', 'zone-play'];

export const byId = new Map(INTENTS.map((i) => [i.id, i]));
