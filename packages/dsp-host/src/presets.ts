import type { Preset, Slot } from "@rig/shared";

const slot = (module: string, params: Record<string, number> = {}): Slot => ({
  id: module.split("@")[0] as string,
  module,
  bypass: false,
  params,
});

const preset = (
  id: string,
  name: string,
  description: string,
  tags: string[],
  slots: Slot[],
): Preset => ({ schema: 1, id, name, description, tags, rev: 0, slots });

/**
 * Starter presets. Each is levelled to about -16 LUFS on the shipped riffs (`presets.int.test.ts`) with the
 * cab's Level, and for the quietest clean tone the amp's master too, so switching presets does not jump in volume.
 * Names are original and descriptions say what a tone is in the spirit of, never a product
 * name (docs/QUESTIONS.md Q14). Tags for brightness and drive are checked against measured descriptors.
 */
export const STARTER_PRESETS: Preset[] = [
  preset(
    "glass-clean",
    "Glass Clean",
    "Chimey, open clean with a touch of chorus shimmer. Country-and-pop sparkle.",
    ["clean", "bright", "genre:country", "genre:pop", "era:60s"],
    [
      slot("chorus@1", { rate: 0.6, depth: 0.3, mix: 0.3 }),
      slot("amp@1", { gain: 1.5, treble: 0.85, sag: 0.1 }),
      slot("cab@1", { cab: 3, level: 1.39 }),
    ],
  ),
  preset(
    "blue-crunch",
    "Blue Crunch",
    "Edge-of-breakup crunch that cleans up when you play softly. Classic blues-rock in the spirit of Eric Clapton.",
    ["crunch", "warm", "genre:blues", "artist:eric-clapton", "era:60s"],
    [
      slot("overdrive@1", { drive: 10, tone: 2600, level: 0.7 }),
      slot("amp@1", { gain: 14, bass: 0.55, treble: 0.5, master: 0.4 }),
      slot("cab@1", { cab: 1, level: 0.43 }),
    ],
  ),
  preset(
    "gilmour-lead",
    "Cosmic Lead",
    "Singing, sustained lead with long echoes and a big room, in the spirit of David Gilmour's solos on Pink Floyd records.",
    [
      "lead",
      "sustain",
      "dreamy",
      "spacey",
      "genre:progressive",
      "genre:psychedelic",
      "artist:david-gilmour",
      "era:70s",
    ],
    [
      slot("overdrive@1", { drive: 9, tone: 2400, level: 0.6 }),
      slot("amp@1", { gain: 9, bass: 0.5, mid: 0.6, treble: 0.45, sag: 0.4, master: 0.45 }),
      slot("cab@1", { cab: 1, level: 0.42 }),
      slot("delay@1", { time: 440, feedback: 0.5, mix: 0.35 }),
      slot("reverb@1", { size: 0.8, mix: 0.35 }),
    ],
  ),
  preset(
    "echo-drift",
    "Echo Drift",
    "Clean ambient wash: swirling chorus, long repeats and a deep reverb for floating pads.",
    ["clean", "dreamy", "spacey", "ambient", "genre:ambient", "era:80s"],
    [
      slot("chorus@1", { rate: 0.4, depth: 0.6, mix: 0.5 }),
      slot("amp@1", { gain: 1.5, treble: 0.45, sag: 0.1 }),
      slot("cab@1", { cab: 0, level: 1.97 }),
      slot("delay@1", { time: 620, feedback: 0.6, mix: 0.45 }),
      slot("reverb@1", { size: 0.95, mix: 0.55 }),
    ],
  ),
  preset(
    "stack-rock",
    "Stack Rock",
    "Big, open hard-rock crunch from a loud stack. Thick low mids, bite on top.",
    ["high-gain", "crunch", "genre:hard-rock", "era:70s", "era:80s"],
    [
      slot("overdrive@1", { drive: 20, tone: 3200, level: 0.7 }),
      slot("amp@1", { gain: 45, bass: 0.6, mid: 0.6, treble: 0.55, sag: 0.35, master: 0.35 }),
      slot("cab@1", { cab: 2, level: 0.34 }),
    ],
  ),
  preset(
    "iron-wall",
    "Iron Wall",
    "Tight, scooped high-gain for fast palm-muted riffing. Gated so the silence is silent.",
    ["high-gain", "tight", "genre:metal", "era:90s"],
    [
      slot("noise-gate@1", { threshold: -50, release: 60 }),
      slot("overdrive@1", { drive: 30, tone: 3500, level: 0.7 }),
      slot("amp@1", { gain: 80, bass: 0.65, mid: 0.3, treble: 0.6, sag: 0.1, master: 0.35 }),
      slot("cab@1", { cab: 2, level: 0.34 }),
    ],
  ),
  preset(
    "fuzz-bloom",
    "Fuzz Bloom",
    "Thick, spitty vintage fuzz that blooms into feedback. Psychedelic rock in the spirit of Jimi Hendrix.",
    ["fuzz", "vintage", "high-gain", "genre:psychedelic", "artist:jimi-hendrix", "era:60s"],
    [
      slot("fuzz@1", { fuzz: 70, level: 0.4 }),
      slot("amp@1", { gain: 8, mid: 0.6, sag: 0.5, master: 0.5 }),
      slot("cab@1", { cab: 1, level: 0.35 }),
    ],
  ),
  preset(
    "wet-surf",
    "Wet Surf",
    "Bright, drenched in spring-style reverb. Surf twang in the spirit of Dick Dale.",
    ["clean", "bright", "genre:surf", "artist:dick-dale", "era:60s"],
    [
      slot("amp@1", { gain: 1.5, bass: 0.4, treble: 0.8, sag: 0.1 }),
      slot("cab@1", { cab: 3, level: 1.24 }),
      slot("reverb@1", { size: 0.7, mix: 0.45 }),
    ],
  ),
  preset(
    "velvet-jazz",
    "Velvet Jazz",
    "Dark, round clean tone with the treble rolled away. For chords and warm single-note lines.",
    ["clean", "dark", "warm", "genre:jazz", "era:50s"],
    [
      slot("amp@1", { gain: 1.2, bass: 0.7, mid: 0.5, treble: 0.15, sag: 0, master: 1.17 }),
      slot("cab@1", { cab: 0, level: 2.0 }),
    ],
  ),
  preset(
    "haze-wall",
    "Haze Wall",
    "Fuzz drowned in chorus and reverb: a dense, dreamy wall of sound. Shoegaze.",
    ["fuzz", "dreamy", "spacey", "high-gain", "genre:shoegaze", "era:90s"],
    [
      slot("fuzz@1", { fuzz: 30, level: 0.35 }),
      slot("chorus@1", { rate: 0.5, depth: 0.7, mix: 0.5 }),
      slot("amp@1", { gain: 3, treble: 0.4, master: 0.5 }),
      slot("cab@1", { cab: 1, level: 0.58 }),
      slot("reverb@1", { size: 0.9, mix: 0.5 }),
    ],
  ),
  preset(
    "slap-twang",
    "Slap Twang",
    "Crisp, lightly driven twang with a short slapback echo. Rockabilly.",
    ["crunch", "bright", "genre:rockabilly", "era:50s"],
    [
      slot("amp@1", { gain: 18, bass: 0.4, treble: 0.8, sag: 0.2, master: 0.45 }),
      slot("cab@1", { cab: 3, level: 0.36 }),
      slot("delay@1", { time: 120, feedback: 0.1, mix: 0.35 }),
    ],
  ),
  preset(
    "jangle-rise",
    "Jangle Rise",
    "Bright, chorused, lightly pushed jangle with a dotted-eighth echo. Indie rock in the spirit of The Edge.",
    ["crunch", "bright", "genre:indie", "artist:the-edge", "era:80s"],
    [
      slot("overdrive@1", { drive: 6, tone: 5000, level: 0.6 }),
      slot("chorus@1", { rate: 0.8, depth: 0.25, mix: 0.25 }),
      slot("amp@1", { gain: 8, treble: 0.65, sag: 0.2, master: 0.6 }),
      slot("cab@1", { cab: 3, level: 0.29 }),
      slot("delay@1", { time: 375, feedback: 0.35, mix: 0.3 }),
    ],
  ),
];
