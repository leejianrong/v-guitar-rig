# 0008: Riff input sources, a plucked-string guitar, and an amp with an effects loop

Status: accepted (2026-11-04)

## Context

Testing a tone with the 110 Hz test tone says little about how it sounds on a riff. The amp is drawn as a pedal, and boards cannot express the usual rig: drive pedals into the amp, time and modulation pedals in its effects loop.

## Decisions

1. **Guitar source is a plucked-string model we write** (Karplus-Strong-style waveguide with pick position and pickup position), run by the same shared code in the worklet and in Node. Sampled notes are a later option: the owner can record their own guitar, so no licensed recordings are needed.
2. **Riffs are JSON in `rig/riffs`**, stored like boards and presets (daemon is the only writer, `rev`, 409 on stale). A riff is tab-shaped: strings, frets, beats, plus techniques (hammer-on, pull-off, slide, bend, mute). ASCII tab converts to and from the JSON.
3. **Tab editor first**, with a playhead, tempo and loop. A piano roll is not planned.
4. **The LLM writes riffs through MCP** (`set_riff`, `get_riff`, `list_riffs`, ASCII tab accepted), and `render` takes a riff as its input, so a tone can be judged on a riff offline.
5. **The board stays a flat `Slot[]`.** The amp is split into a preamp module and a power-amp module. Pedals between the two are the effects loop. The UI draws one amp chassis with a SEND/RETURN lane, and the amp face has a speaker grille with the cab built in. Existing `amp@1` keeps working; shipped presets move to the new pair.
6. **Order of work:** guitar and riffs, then the tab editor, then the audio-file source, then the amp split and amp face, then preset migration, then the wah.

## Consequences

- No board schema change, so the engine, validation, MCP and CLI keep working.
- Live and offline riff playback share one synth, so parity is testable.
- A plucked-string model can sound synthetic when played clean. Distortion hides most of it. The sampled-note path stays open.
