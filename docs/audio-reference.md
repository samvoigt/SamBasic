# SamBasic Audio Reference

## Music String Notation

Music strings are case-insensitive text that describe a sequence of notes. They are passed as string arguments to `PLAY` and `PLAYPOLY`.

### Notes

Notes are letters `A` through `G`:

```
"C D E F G A B"
```

**Accidentals:**
- Sharp: `#` or `+` after the note letter (`C#`, `F+`)
- Flat: `-` after the note letter (`B-`, `E-`)

### Note Length

Set the default length with `L`:

| Command | Duration | Name |
|---------|----------|------|
| `L1` | 4 beats | Whole note |
| `L2` | 2 beats | Half note |
| `L4` | 1 beat | Quarter note (default) |
| `L8` | 0.5 beats | Eighth note |
| `L16` | 0.25 beats | Sixteenth note |

Override per-note by appending a number: `C4` = C quarter note regardless of current `L` setting.

**Dotted notes** — append `.` for 1.5x duration: `E.` = dotted quarter (1.5 beats at L4), `C2.` = dotted half (3 beats).

### Tempo

`T` followed by BPM: `T120` (default), `T72`, `T200`.

One beat = `60 / tempo` seconds. At T120, a quarter note = 0.5s. At T72, a quarter note = 0.833s.

### Octave

- `O` followed by number: `O3`, `O4` (default), `O5`
- `>` shifts up one octave, `<` shifts down one

Octave persists until changed. Middle C is `O4 C`.

### Rests and Percussion

- `R` — rest (silence). Optional length: `R4`, `R8`, `R2.`
- `P` — percussion (white noise burst). Optional length: `P4`, `P8.`

### Full Example

```
"T130 O4 L4 E E F G G F E D C C D E E. L8 D L2 D"
```

Breakdown: tempo 130, octave 4, quarter notes by default. Plays E E F G G F E D C C D E, then dotted-quarter E, eighth D, half D.

## Duration Math

```
duration_seconds = (4 / note_length) * (60 / tempo) * dot_multiplier
```

| Note | T120 | T72 | T200 |
|------|------|-----|------|
| Whole (L1) | 2.0s | 3.33s | 1.2s |
| Half (L2) | 1.0s | 1.67s | 0.6s |
| Quarter (L4) | 0.5s | 0.83s | 0.3s |
| Eighth (L8) | 0.25s | 0.42s | 0.15s |
| Dotted quarter | 0.75s | 1.25s | 0.45s |

## PLAY

```
PLAY "T120 O4 L4 C D E F G"
PLAY musicString$, WAVE TRIANGLE
PLAY "O5 L8 E G E G", BACKGROUND YES, WAVE SQUARE
PLAY "T80 L4 C E G", REPEAT YES
```

**Parameters (all optional except the music string):**

| Parameter | Values | Default | Notes |
|-----------|--------|---------|-------|
| `WAVE` | `SINE`, `SQUARE`, `TRIANGLE`, `SAWTOOTH` | `SQUARE` | Oscillator waveform |
| `BACKGROUND` | `YES` / `NO` | `NO` | YES = non-blocking, code continues |
| `REPEAT` | `YES` / `NO` | `NO` | Loop the music |

**Foreground** (default): execution blocks until music finishes.
**Background**: music plays while code continues. Only one background playback at a time — starting a new one stops the previous.

## PLAYPOLY

Play multiple voices simultaneously:

```
PLAYPOLY ["T130 O4 L4 E E F G" WAVE SQUARE] ["T130 O3 L2 C G E G" WAVE TRIANGLE]
```

Each voice is in `[square brackets]` containing:
1. A music string (string expression)
2. Optional `WAVE` keyword with waveform type

After the voice brackets, optional `BACKGROUND YES/NO` and `REPEAT YES/NO`.

**Important:** All voices must have the **same total beat count** to stay synchronized. The playback duration equals the longest voice.

Gain is automatically divided by the number of voices (0.3 / voiceCount) to prevent clipping.

### Multi-voice example (4 voices)

```
PLAYPOLY (
  ["T72 O5 L4 D D D" WAVE SINE]
  ["T72 O4 L4 G G B" WAVE TRIANGLE]
  ["T72 O4 L4 D D D" WAVE SQUARE]
  ["T72 O3 L4 G G G" WAVE SAWTOOTH]
)
```

Wrapping in `()` allows voices to span multiple lines. Single-line syntax still works:

```
PLAYPOLY ["T72 O5 L4 D D D" WAVE SINE] ["T72 O4 L4 G G B" WAVE TRIANGLE]
```

## Playback Control

These affect **background** playback only (foreground PLAY cannot be paused):

```
PAUSEPLAY       ' pause background music
RESUMEPLAY      ' resume from where it paused
STOPPLAY        ' stop and discard background music
```

## Waveforms

| Waveform | Character | Best for |
|----------|-----------|----------|
| `SINE` | Pure, smooth | Flutes, soft leads, upper harmonies |
| `SQUARE` | Hollow, bright (default) | Melodies, chiptune, bold lines |
| `TRIANGLE` | Warm, mellow | Bass, accompaniment, gentle leads |
| `SAWTOOTH` | Harsh, buzzy | Brass-like bass, rich textures |

## Tips for Multi-Voice Arrangements

1. **Match beat counts.** Count the total beats in each voice — they must be equal or voices will desync.
2. **Use the same tempo** in all voices (`T72` in every string).
3. **Use rests to pad.** If one voice has fewer notes, add `R` to fill time.
4. **Octave placement:** Separate voices by octave for clarity (e.g., melody O4, bass O3).
5. **Waveform contrast:** Use different waveforms so voices are distinguishable.
6. **Watch dotted notes.** A dotted quarter (`E.`) is 1.5 beats, not 1. Easy to miscount.
7. **Split into sections.** For longer pieces, use multiple PLAYPOLY calls (one per phrase) like the beethoven.sam example. Each call blocks until finished, then the next starts.

## Quick Reference: Note Frequencies

| Note | Octave 3 | Octave 4 | Octave 5 |
|------|----------|----------|----------|
| C | 131 Hz | 262 Hz | 523 Hz |
| D | 147 Hz | 294 Hz | 587 Hz |
| E | 165 Hz | 330 Hz | 659 Hz |
| F | 175 Hz | 349 Hz | 698 Hz |
| G | 196 Hz | 392 Hz | 784 Hz |
| A | 220 Hz | 440 Hz | 880 Hz |
| B | 247 Hz | 494 Hz | 988 Hz |
