#!/usr/bin/env python3
"""Convert standard MIDI files into SamBasic PLAY/PLAYPOLY commands.

Usage:
    python utils/midi2basic.py input.mid [-o output.sam] [--quantize 16] [--tempo 120]
                                          [--wave SQUARE] [--section-beats 16]
                                          [--no-percussion] [--info]
"""

import argparse
import struct
import sys
from collections import defaultdict

# ---------------------------------------------------------------------------
# MIDI binary parser
# ---------------------------------------------------------------------------

def read_varlen(data, offset):
    """Read a MIDI variable-length quantity. Returns (value, new_offset)."""
    value = 0
    while offset < len(data):
        b = data[offset]
        offset += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            break
    return value, offset


def parse_midi(filepath):
    """Parse a standard MIDI file. Returns (format, tpb, tracks).

    Each track is a list of (abs_tick, event_type, channel, data) tuples.
    event_type: 'note_on', 'note_off', 'tempo'
    """
    with open(filepath, 'rb') as f:
        raw = f.read()

    # --- MThd header ---
    if raw[:4] != b'MThd':
        raise ValueError("Not a valid MIDI file (missing MThd)")
    hdr_len = struct.unpack('>I', raw[4:8])[0]
    fmt, ntrks, tpb = struct.unpack('>HHH', raw[8:14])
    if tpb & 0x8000:
        raise ValueError("SMPTE time division not supported")

    pos = 8 + hdr_len
    tracks = []

    for _ in range(ntrks):
        if raw[pos:pos+4] != b'MTrk':
            raise ValueError("Expected MTrk chunk")
        trk_len = struct.unpack('>I', raw[pos+4:pos+8])[0]
        trk_data = raw[pos+8:pos+8+trk_len]
        pos += 8 + trk_len

        events = []
        offset = 0
        abs_tick = 0
        running_status = 0

        while offset < len(trk_data):
            delta, offset = read_varlen(trk_data, offset)
            abs_tick += delta

            if offset >= len(trk_data):
                break

            status = trk_data[offset]

            # Meta event
            if status == 0xFF:
                offset += 1
                if offset >= len(trk_data):
                    break
                meta_type = trk_data[offset]
                offset += 1
                meta_len, offset = read_varlen(trk_data, offset)
                meta_data = trk_data[offset:offset+meta_len]
                offset += meta_len
                if meta_type == 0x51 and len(meta_data) == 3:
                    uspqn = (meta_data[0] << 16) | (meta_data[1] << 8) | meta_data[2]
                    events.append((abs_tick, 'tempo', 0, {'uspqn': uspqn}))
                continue

            # SysEx
            if status in (0xF0, 0xF7):
                offset += 1
                sysex_len, offset = read_varlen(trk_data, offset)
                offset += sysex_len
                continue

            # Channel message
            if status & 0x80:
                running_status = status
                offset += 1
            else:
                status = running_status

            msg_type = status & 0xF0
            channel = status & 0x0F

            if msg_type in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
                # Two data bytes
                if offset + 1 >= len(trk_data):
                    break
                d1 = trk_data[offset]
                d2 = trk_data[offset+1]
                offset += 2
                if msg_type == 0x90 and d2 > 0:
                    events.append((abs_tick, 'note_on', channel, {'note': d1, 'vel': d2}))
                elif msg_type == 0x90 and d2 == 0:
                    events.append((abs_tick, 'note_off', channel, {'note': d1}))
                elif msg_type == 0x80:
                    events.append((abs_tick, 'note_off', channel, {'note': d1}))
            elif msg_type in (0xC0, 0xD0):
                # One data byte
                if offset >= len(trk_data):
                    break
                d1 = trk_data[offset]
                offset += 1
                if msg_type == 0xC0:
                    events.append((abs_tick, 'program_change', channel, {'program': d1}))
            else:
                # Skip unknown
                offset += 1

        tracks.append(events)

    return fmt, tpb, tracks


# ---------------------------------------------------------------------------
# Note extraction
# ---------------------------------------------------------------------------

def extract_notes(tracks, tpb, quantize, tempo_override):
    """Extract notes grouped by channel. Returns (channel_notes, bpm, tempo_map).

    channel_notes: dict of channel -> list of (grid_start, grid_dur, midi_note, velocity)
    All times in integer grid units.
    tempo_map: list of (grid_pos, bpm) for all tempo changes, sorted by grid_pos.
    """
    grid_ticks = tpb * 4 / quantize

    # Merge all track events, find tempo
    all_events = []
    for trk in tracks:
        all_events.extend(trk)
    all_events.sort(key=lambda e: e[0])

    # Build tempo map from all tempo events
    bpm = 120
    tempo_map = []
    for tick, etype, ch, data in all_events:
        if etype == 'tempo':
            t_bpm = round(60_000_000 / data['uspqn'])
            t_grid = round(tick / grid_ticks)
            tempo_map.append((t_grid, t_bpm))
    if tempo_map:
        bpm = tempo_map[0][1]
    if tempo_override:
        bpm = tempo_override
        tempo_map = []  # override disables tempo map

    # Match note_on -> note_off per (channel, note)
    pending = defaultdict(list)  # (channel, note) -> [(start_tick, velocity), ...]
    channel_notes = defaultdict(list)

    for tick, etype, ch, data in all_events:
        if etype == 'note_on':
            pending[(ch, data['note'])].append((tick, data['vel']))
        elif etype == 'note_off':
            key = (ch, data['note'])
            if pending[key]:
                start_tick, vel = pending[key].pop(0)
                dur_ticks = tick - start_tick
                gs = round(start_tick / grid_ticks)
                gd = max(1, round(dur_ticks / grid_ticks))
                channel_notes[ch].append((gs, gd, data['note'], vel))

    # Sort each channel by start time, then by pitch descending
    for ch in channel_notes:
        channel_notes[ch].sort(key=lambda n: (n[0], -n[2]))

    return dict(channel_notes), bpm, tempo_map


def extract_programs(tracks):
    """Extract first program change per channel. Returns dict of channel -> program number."""
    channel_program = {}
    all_events = []
    for trk in tracks:
        all_events.extend(trk)
    all_events.sort(key=lambda e: e[0])
    for tick, etype, ch, data in all_events:
        if etype == 'program_change' and ch not in channel_program:
            channel_program[ch] = data['program']
    return channel_program


# GM program bank (groups of 8) -> SamBasic waveform
_GM_BANK_WAVEFORMS = [
    'TRIANGLE',   # 0-7:    Piano
    'TRIANGLE',   # 8-15:   Chromatic Percussion
    'SINE',       # 16-23:  Organ
    'SAWTOOTH',   # 24-31:  Guitar
    'TRIANGLE',   # 32-39:  Bass
    'SAWTOOTH',   # 40-47:  Strings
    'SAWTOOTH',   # 48-55:  Ensemble
    'SQUARE',     # 56-63:  Brass
    'SQUARE',     # 64-71:  Reed
    'SINE',       # 72-79:  Pipe
    'SAWTOOTH',   # 80-87:  Synth Lead
    'SINE',       # 88-95:  Synth Pad
    'SQUARE',     # 96-103: Synth Effects
    'SAWTOOTH',   # 104-111: Ethnic
    'SQUARE',     # 112-119: Percussive
    'SQUARE',     # 120-127: Sound FX
]


def gm_program_to_waveform(program):
    """Map GM program number (0-127) to a SamBasic waveform."""
    bank = min(program // 8, 15)
    return _GM_BANK_WAVEFORMS[bank]


# ---------------------------------------------------------------------------
# Voice processing
# ---------------------------------------------------------------------------

def allocate_voices(notes):
    """Pack notes into minimum monophonic voices using greedy interval scheduling.

    No note is dropped. Overlapping notes (chords) land in different voices.
    Returns a list of note-lists, one per voice.
    """
    if not notes:
        return []

    # Sort by start time, then highest pitch first
    sorted_notes = sorted(notes, key=lambda n: (n[0], -n[2]))

    # Each voice tracks its end time and note list
    # voice = (end_time, [notes...])
    voices = []

    for note in sorted_notes:
        gs, gd = note[0], note[1]
        note_end = gs + gd
        # Find tightest-fit voice: largest end_time that is <= gs
        best_idx = -1
        best_end = -1
        for i, (v_end, _) in enumerate(voices):
            if v_end <= gs and v_end > best_end:
                best_idx = i
                best_end = v_end
        if best_idx >= 0:
            voices[best_idx][1].append(note)
            voices[best_idx] = (note_end, voices[best_idx][1])
        else:
            voices.append((note_end, [note]))

    return [v_notes for _, v_notes in voices]


# ---------------------------------------------------------------------------
# Music string generation
# ---------------------------------------------------------------------------

NOTE_NAMES = ['C', 'C#', 'D', 'E-', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B-', 'B']
# SamBasic uses - for flat, # for sharp. MIDI semitones map to these names.
# We use sharps for black keys except Eb(D#)->E-, Bb(A#)->B- to match QBASIC convention.

def midi_note_name(midi_note):
    """Convert MIDI note number to (note_name, octave)."""
    octave = midi_note // 12 - 1
    pc = midi_note % 12
    return NOTE_NAMES[pc], octave


# GM percussion note -> SamBasic percussion command
_GM_PERC_MAP = {
    35: 'PK', 36: 'PK',                          # Kick
    37: 'PS', 38: 'PS', 39: 'PS', 40: 'PS',      # Snare / clap
    42: 'PH', 44: 'PH', 46: 'PH',                # Hi-hat
    49: 'PC', 51: 'PC', 52: 'PC',                 # Cymbal (crash/ride)
    55: 'PC', 57: 'PC', 59: 'PC',
}


def gm_perc_name(midi_note):
    """Map GM percussion MIDI note to SamBasic percussion command."""
    return _GM_PERC_MAP.get(midi_note, 'P')


def build_length_table(quantize):
    """Build available (grid_size, length_token) pairs for given quantize level.

    Returns list sorted by grid_size descending.
    """
    # Standard note lengths and their grid sizes at Q=16:
    # L1 = 16 grids, L2. = 12, L2 = 8, L4. = 6, L4 = 4, L8. = 3, L8 = 2, L16 = 1
    # At other quantize levels, scale proportionally.
    base = quantize  # grids per whole note = quantize
    candidates = []
    for divisor, token, dotted in [
        (1,   'L1',    False),
        (1,   'L2.',   True),
        (2,   'L2',    False),
        (2,   'L4.',   True),
        (4,   'L4',    False),
        (4,   'L8.',   True),
        (8,   'L8',    False),
        (8,   'L16.',  True),
        (16,  'L16',   False),
        (16,  'L32.',  True),
        (32,  'L32',   False),
        (32,  'L64.',  True),
        (64,  'L64',   False),
        (64,  'L128.', True),
        (128, 'L128',  False),
        (128, 'L256.', True),
        (256, 'L256',  False),
    ]:
        if dotted:
            grids = base * 3 // (divisor * 4)
        else:
            grids = base // divisor
        if grids >= 1:
            candidates.append((grids, token))

    # Deduplicate and sort descending by grid size.
    # When a dotted and undotted token map to the same grid count (due to
    # integer truncation, e.g. L16. and L16 both → 1 at quantize=16),
    # prefer the undotted token — the dotted one only landed here because
    # of truncation and would play 1.5× too long in the audio engine.
    seen = {}  # grid_size -> (grid_size, token)
    for g, t in candidates:
        is_dot = t.endswith('.')
        if g not in seen:
            seen[g] = (g, t)
        elif is_dot:
            pass  # keep existing undotted entry
        else:
            seen[g] = (g, t)  # undotted replaces dotted
    result = sorted(seen.values(), key=lambda x: -x[0])
    return result


def decompose_duration(grids, length_table):
    """Decompose a grid duration into a list of length tokens (greedy)."""
    tokens = []
    remaining = grids
    for g, t in length_table:
        while remaining >= g:
            tokens.append((g, t))
            remaining -= g
    return tokens


def make_music_string(notes, section_start, section_end, quantize, is_percussion,
                      tempo_changes=None):
    """Generate a SamBasic music string for notes within [section_start, section_end).

    tempo_changes: list of (grid_pos, bpm) within or before this section, sorted.
    Returns the music string (without quotes or tempo prefix).
    """
    length_table = build_length_table(quantize)
    tokens = []
    cur_octave = None
    cur_length = None  # current default length token (e.g. 'L4')
    pos = section_start

    # Build iterator for tempo changes strictly inside this section
    # (tempo at section_start is handled by the TEMPO keyword / T prefix)
    pending_tempos = []
    if tempo_changes:
        for tg, tbpm in tempo_changes:
            if tg > section_start and tg < section_end:
                pending_tempos.append((tg, tbpm))
    tempo_idx = 0

    def emit_pending_tempos(up_to_grid):
        """Emit any tempo changes that fall at or before up_to_grid."""
        nonlocal tempo_idx
        while tempo_idx < len(pending_tempos) and pending_tempos[tempo_idx][0] <= up_to_grid:
            tokens.append(f"T{pending_tempos[tempo_idx][1]}")
            tempo_idx += 1

    def emit_duration(grids, note_name):
        """Emit tokens for a note or rest with given grid duration.

        Uses explicit L commands to change the default length (matching the
        engine's parseMusicString behaviour, where per-note lengths like C8
        do NOT update defaultLength — only L commands do).
        """
        nonlocal cur_length
        parts = decompose_duration(grids, length_table)
        for g, lt in parts:
            # Parse length number and dot from token like 'L4.' or 'L16'
            lt_body = lt[1:]  # strip 'L'
            is_dot = lt_body.endswith('.')
            len_num = lt_body.rstrip('.')

            if is_dot:
                # Dotted notes must use per-note override (engine L command
                # doesn't support dots), so emit e.g. C4. — this doesn't
                # change the engine's defaultLength.
                tokens.append(f"{note_name}{len_num}.")
            elif f"L{len_num}" != cur_length:
                # Length changed: emit an L command, then the bare note
                tokens.append(f"L{len_num}")
                cur_length = f"L{len_num}"
                tokens.append(note_name)
            else:
                tokens.append(note_name)

    cur_velocity = None

    for note in notes:
        gs, gd, pitch = note[0], note[1], note[2]
        vel = note[3] if len(note) > 3 else 127
        # Clip to section
        ns = max(gs, section_start)
        ne = min(gs + gd, section_end)
        if ne <= ns:
            continue
        clipped_dur = ne - ns

        # Emit any tempo changes up to this note's start
        emit_pending_tempos(ns)

        # Fill gap with rests
        if ns > pos:
            gap = ns - pos
            emit_duration(gap, 'R')
        pos = ne

        # Emit velocity change (quantize to steps of 8)
        qvel = min(127, round(vel / 8) * 8)
        if qvel != cur_velocity:
            tokens.append(f"V{qvel}")
            cur_velocity = qvel

        if is_percussion:
            emit_duration(clipped_dur, gm_perc_name(pitch))
        else:
            name, octave = midi_note_name(pitch)
            if octave != cur_octave:
                tokens.append(f"O{octave}")
                cur_octave = octave
            emit_duration(clipped_dur, name)

    # Pad remaining section time with rests so all voices span the full section
    if pos < section_end:
        emit_duration(section_end - pos, 'R')

    return ' '.join(tokens)


# ---------------------------------------------------------------------------
# Section splitting & output
# ---------------------------------------------------------------------------

WAVEFORMS = ['SQUARE', 'TRIANGLE', 'SINE', 'SAWTOOTH']


def avg_pitch(notes):
    """Average MIDI pitch of a note list (for waveform assignment)."""
    if not notes:
        return 0
    return sum(n[2] for n in notes) / len(notes)


def generate_output(channel_notes, bpm, quantize, wave_override,
                    section_beats, no_percussion, source_name,
                    channel_program=None, tempo_map=None):
    """Generate SamBasic output from processed channel notes."""
    if channel_program is None:
        channel_program = {}
    if tempo_map is None:
        tempo_map = []
    grids_per_beat = quantize // 4

    # Separate percussion (channel 9 = MIDI channel 10, 0-indexed)
    perc_voices = []
    if 9 in channel_notes:
        if no_percussion:
            del channel_notes[9]
        else:
            perc_voices = allocate_voices(channel_notes.pop(9))

    # Allocate voices per channel so each instrument keeps one waveform
    # Assign one waveform per channel, then allocate voices within each
    channel_list = sorted(channel_notes.keys())
    channel_waveform = {}
    for i, ch in enumerate(channel_list):
        if wave_override:
            channel_waveform[ch] = wave_override
        elif ch in channel_program:
            channel_waveform[ch] = gm_program_to_waveform(channel_program[ch])
        else:
            channel_waveform[ch] = WAVEFORMS[i % len(WAVEFORMS)]

    # Build voice list: (notes, is_percussion, waveform)
    voices = []
    for ch in channel_list:
        wf = channel_waveform[ch]
        for v in allocate_voices(channel_notes[ch]):
            voices.append((v, False, wf))

    # Sort melodic voices by average pitch descending (highest first)
    voices.sort(key=lambda v: -avg_pitch(v[0]))

    # Append percussion voices
    for pv in perc_voices:
        wf = wave_override if wave_override else 'SQUARE'
        voices.append((pv, True, wf))

    if not voices:
        return "' No notes found in MIDI file\n"

    # Find total duration across all voices
    max_grid = 0
    for notes, _, _ in voices:
        for n in notes:
            max_grid = max(max_grid, n[0] + n[1])

    section_grids = section_beats * grids_per_beat if section_beats else max_grid

    # Generate sections
    lines = [f"' Converted from: {source_name}", '']

    sec_start = 0
    while sec_start < max_grid:
        sec_end = min(sec_start + section_grids, max_grid)
        # Snap last section up to full section if close
        if max_grid - sec_end < grids_per_beat and sec_end < max_grid:
            sec_end = max_grid

        # Find the active tempo at this section's start
        sec_bpm = bpm
        for tg, tbpm in tempo_map:
            if tg <= sec_start:
                sec_bpm = tbpm
            else:
                break

        if len(voices) == 1:
            notes, is_perc, wf = voices[0]
            ms = make_music_string(notes, sec_start, sec_end, quantize, is_perc,
                                   tempo_changes=tempo_map)
            lines.append(f'PLAY "T{sec_bpm} {ms}", WAVE {wf}')
        else:
            lines.append('PLAYPOLY (')
            for notes, is_perc, wf in voices:
                ms = make_music_string(notes, sec_start, sec_end, quantize, is_perc,
                                       tempo_changes=tempo_map)
                lines.append(f'  ["{ms}" WAVE {wf}]')
            lines.append(f') TEMPO {sec_bpm}')

        lines.append('')
        sec_start = sec_end

    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Info mode
# ---------------------------------------------------------------------------

def print_info(filepath, fmt, tpb, tracks, channel_notes, bpm):
    """Print MIDI metadata and per-channel stats."""
    # Total duration in ticks
    max_tick = 0
    for trk in tracks:
        for tick, *_ in trk:
            max_tick = max(max_tick, tick)

    duration_sec = max_tick / tpb * (60 / bpm) if tpb > 0 else 0

    print(f"File:          {filepath}")
    print(f"Format:        {fmt}")
    print(f"Tracks:        {len(tracks)}")
    print(f"Ticks/beat:    {tpb}")
    print(f"Tempo:         {bpm} BPM")
    print(f"Duration:      {duration_sec:.1f}s ({max_tick} ticks)")
    print()

    if not channel_notes:
        print("No note data found.")
        return

    print(f"{'Chan':>4}  {'Notes':>6}  {'Low':>5}  {'High':>5}  {'Type'}")
    print(f"{'----':>4}  {'-----':>6}  {'---':>5}  {'----':>5}  {'----'}")
    for ch in sorted(channel_notes):
        notes = channel_notes[ch]
        pitches = [n[2] for n in notes]
        lo_name, lo_oct = midi_note_name(min(pitches))
        hi_name, hi_oct = midi_note_name(max(pitches))
        kind = "Percussion" if ch == 9 else "Melodic"
        print(f"{ch+1:>4}  {len(notes):>6}  {lo_name}{lo_oct:>2}  {hi_name}{hi_oct:>2}  {kind}")

    # Estimate voice count via allocate_voices
    melodic_notes = []
    perc_notes = []
    for ch, notes in channel_notes.items():
        if ch == 9:
            perc_notes.extend(notes)
        else:
            melodic_notes.extend(notes)
    n_melodic = len(allocate_voices(melodic_notes))
    n_perc = len(allocate_voices(perc_notes))
    print()
    print(f"Est. voices:   {n_melodic} melodic + {n_perc} percussion = {n_melodic + n_perc} total")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Convert standard MIDI files into SamBasic PLAY/PLAYPOLY commands."
    )
    parser.add_argument("input", help="Input MIDI file (.mid)")
    parser.add_argument("-o", "--output", help="Output .sam file (default: stdout)")
    parser.add_argument(
        "--quantize", type=int, default=128,
        help="Smallest note subdivision (default: 128 = 128th notes)"
    )
    parser.add_argument(
        "--tempo", type=int, default=None,
        help="Override BPM (default: from MIDI file)"
    )
    parser.add_argument(
        "--wave", default=None, choices=['SQUARE', 'TRIANGLE', 'SINE', 'SAWTOOTH'],
        help="Force waveform for all voices (default: auto-assign)"
    )
    parser.add_argument(
        "--section-beats", type=int, default=None,
        help="Beats per PLAYPOLY section before splitting (default: no splitting)"
    )
    parser.add_argument(
        "--no-percussion", action="store_true",
        help="Skip MIDI channel 10 percussion"
    )
    parser.add_argument(
        "--info", action="store_true",
        help="Print MIDI metadata and exit (no conversion)"
    )
    args = parser.parse_args()

    fmt, tpb, tracks = parse_midi(args.input)
    channel_notes, bpm, tempo_map = extract_notes(tracks, tpb, args.quantize, args.tempo)
    channel_program = extract_programs(tracks)

    if args.info:
        print_info(args.input, fmt, tpb, tracks, channel_notes, bpm)
        sys.exit(0)

    if not channel_notes:
        print("No notes found in MIDI file.", file=sys.stderr)
        sys.exit(1)

    source_name = args.input.rsplit("/", 1)[-1] if "/" in args.input else args.input
    output = generate_output(
        channel_notes, bpm, args.quantize,
        args.wave, args.section_beats, args.no_percussion, source_name,
        channel_program=channel_program,
        tempo_map=tempo_map,
    )

    if args.output:
        with open(args.output, 'w') as f:
            f.write(output)
            f.write('\n')
        print(f"Wrote {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
