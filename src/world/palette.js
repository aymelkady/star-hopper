/*
 * Star Hopper world palette (DESIGN.md §5.2).  EVERY colour used by src/world/** comes from here.
 * Rule: no neutral grey.  Every entry has HSL saturation >= 8 % (whites are warm/cool tinted),
 * except the deliberately metallic details (chimes frame / bell), which are still tinted.
 * Run `node test/color-audit.mjs` to list every material in the live scene.
 */
export const PAL = {
  // ---- grass & ground ----
  grass: 0x58c832,        // base spring green
  grassHi: 0x8fe85a,      // sunny highlight
  grassLo: 0x2f9a2a,      // shadow / hollows
  grassHub: 0x62d03a,     // hub lawn (a touch brighter)
  grassTop: 0x9cf060,     // hill tops
  earth: 0xb97a46,        // dirt paths
  earthHi: 0xd29a5e,      // path centre
  earthLo: 0x8a5530,      // under-island soil
  sand: 0xf3d58a,         // dry beach
  sandWet: 0xdcb46a,      // wet sand at the waterline
  sandDeep: 0xb89058,     // sea bed
  // ---- warm stone (never grey) ----
  stone: 0xc9b8a8,        // warm stone light
  stoneLo: 0x8c7466,      // warm stone shadow
  stoneMid: 0xab9482,
  sandstone: 0xe7b77a,    // layered cliff bands
  sandstone2: 0xd49a5e,
  sandstone3: 0xc07f4a,
  sandstone4: 0xf2cf98,
  // ---- wood ----
  wood: 0xc98a4e,         // planks
  woodHi: 0xe6aa66,       // fresh plank
  woodLo: 0x93582e,       // posts / dark plank
  bark: 0x8a5230,
  barkLo: 0x63391e,
  rope: 0xd8b878,
  // ---- foliage ----
  leaf: 0x3fae3a,
  leafHi: 0x6fd44a,
  leafLo: 0x247a2c,       // canopy underside
  leafLime: 0x9be04e,
  palmLeaf: 0x34b84e,
  palmLeafHi: 0x5fd468,
  bush: 0x3a9e3c,
  bushHi: 0x5cc04a,
  // ---- water ----
  water: 0x2fb2e8,
  waterDeep: 0x1677c2,
  waterShallow: 0x5fe0e6,
  foam: 0xeefcff,
  fall: 0x7fd8ff,         // waterfall base
  // ---- sky ----
  skyTop: 0x2a74e0,
  skyMid: 0x6cb8f4,
  skyLow: 0xb4dcfa,
  skyHorizon: 0xf4ecd0,   // warm pale horizon (= fog colour)
  fog: 0xe2ecdc,
  sun: 0xfff6d8,
  sunGlow: 0xffd98a,
  cloud: 0xfffcf4,
  cloudShade: 0xc8dcf4,
  // ---- mountains (near -> far) ----
  mtnNear: 0x4e9e4a,
  mtnNearHi: 0x78c25a,
  mtnNearRock: 0x9a7a5e,
  mtnMid: 0x5d8fa0,
  mtnMidHi: 0x7fb0b4,
  mtnFar: 0x9bbcd8,
  mtnFarHi: 0xb8d2e6,
  snow: 0xf6faff,
  snowShade: 0xd4e4f8,
  // ---- flowers ----
  flowerPink: 0xff5fa2,
  flowerYellow: 0xffd93a,
  flowerWhite: 0xfff6e6,
  flowerPurple: 0xa772ff,
  flowerCentre: 0xffb020,
  stem: 0x3c9e30,
  // ---- painted tower stone ----
  towerCream: 0xf5e6c4,
  towerCream2: 0xe9d3a6,
  towerBlue: 0x4f9ae6,
  towerBlue2: 0x3a7cd0,
  towerBlueLo: 0x2c5fa8,
  gold: 0xffc93a,
  goldLo: 0xd99a1a,
  crystal: 0x7ff0ff,
  // ---- zone accents ----
  hubAccent: 0xff7a3c,
  meadowAccent: 0xff4f6a,
  coveAccent: 0x2fb7c8,
  towersAccent: 0x8a6cff,
  roofRed: 0xe0503e,
  roofRedLo: 0xa83a30,
  hutWall: 0xf4dcae,
  // ---- props ----
  white: 0xfffaf0,        // "white" paint (warm)
  ink: 0x2b1d45,          // dark details (eyes, mouths)
  inkLo: 0x1d1530,
  grumble: 0x8a55d8,
  grumbleLo: 0x6b3fb3,
  grumbleFoot: 0x3a2a55,
  mushStem: 0xfff1d6,
  mushRed: 0xff4f7a,
  mushOrange: 0xff7b2e,
  mushPurple: 0xb05cff,
  flagRed: 0xff4040,
  flagBlue: 0x4f7de0,
  flagGreen: 0x2fd35a,
  switchBase: 0x5a6aa8,
  switchRed: 0xff5a3c,
  switchGreen: 0x3fdc6a,
  lanternGlass: 0x8a6a3e,
  lanternFrame: 0x4a3420,
  lanternLit: 0xfff0a0,
  lanternGlow: 0xffb000,
  platform: 0xc9b8e8,
  platformTrim: 0xffe27a,
  elevator: 0xffc7e0,
  logCore: 0xe0b27a,
  stripe: 0xffe27a,
  umbrellaRed: 0xff5a5a,
  umbrellaBlue: 0x5ab8ff,
  padStart: 0x3a7bff,
  padFinish: 0x2b2a6a,
  ghost: 0xbfe0ff,
  metal: 0x9a8fb0,        // chimes frame (metallic detail, tinted)
  metalLo: 0x6e6088,
  bell: 0xffc93a,
  coin: 0xffc93a,
  coinRed: 0xff3f4f,
  star: 0xffd84a,
  starGhost: 0x8fd0ff,
  wind: 0xf4fbff,
  signPaper: 0xfff4d6,
  chime1: 0xff6b6b, chime2: 0xffc93a, chime3: 0x4fd18b, chime4: 0x5aa8ff,
  // ---- emissive tints ----
  coinEmissive: 0x6a4a00, redEmissive: 0x700010, starEmissive: 0xb07a00, ghostEmissive: 0x2a6aa0,
  starHalo: 0xfff2a0, chimeLit: 0x664400, bellEmissive: 0x553300,
  // ---- lights ----
  keyLight: 0xfff2d0,
  hemiSky: 0xbfe4ff,
  hemiGround: 0x6a8f3c,
  backLight: 0xa8c8ff,
};

// Accent colours per zone, handy for wayfinding props.
export const ZONE_ACCENT = { hub: PAL.hubAccent, meadow: PAL.meadowAccent, cove: PAL.coveAccent, towers: PAL.towersAccent };
