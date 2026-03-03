#!/usr/bin/env python3
"""Bidirectional ABC <-> SamBasic converter.

Usage:
    python utils/abc2play.py -i input.abc -o output.sam [--wave SQUARE]
                             [--no-chords] [--transpose N]
                             [--section-beats N] [--tune N] [--info]
    python utils/abc2play.py -i input.sam -o output.abc
"""

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Note:
    pitch: str           # 'C'-'B' or 'R' for rest
    accidental: int      # -2..+2 (double flat to double sharp)
    octave: int          # SamBasic octave (4 = middle C)
    duration: Fraction   # fraction of whole note (1/4 = quarter)
    is_rest: bool = False
    is_grace: bool = False
    velocity: int = 127
    tied: bool = False   # tied to next note
    chord_group: int = -1  # -1 = not in a chord, >= 0 = chord index


@dataclass
class MusicBlock:
    """A PLAY or PLAYPOLY block parsed from a .sam file."""
    voices: List[str]       # music strings (1 for PLAY, N for PLAYPOLY)
    waveforms: List[str]    # per-voice waveform
    tempo: int              # from TEMPO param or first T command


# ---------------------------------------------------------------------------
# Key signature tables
# ---------------------------------------------------------------------------

# Sharps/flats in order for key signatures
SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

# Number of sharps (positive) or flats (negative) for each major key
MAJOR_KEY_SHARPS = {
    'C': 0, 'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7,
    'F': -1, 'B-': -2, 'Bb': -2, 'E-': -3, 'Eb': -3,
    'A-': -4, 'Ab': -4, 'D-': -5, 'Db': -5,
    'G-': -6, 'Gb': -6, 'C-': -7, 'Cb': -7,
}

# Mode offsets (how many steps up from the relative major)
# e.g., Dorian is 2 steps up from major, so its relative major is 2 semitones below
MODE_SHARP_OFFSETS = {
    'maj': 0, 'major': 0, 'ion': 0, 'ionian': 0, '': 0,
    'dor': 2, 'dorian': 2,
    'phr': 4, 'phrygian': 4,
    'lyd': -1, 'lydian': -1,
    'mix': 1, 'mixolydian': 1,
    'min': 3, 'minor': 3, 'aeo': 3, 'aeolian': 3, 'm': 3,
    'loc': 5, 'locrian': 5,
}


def get_key_accidentals(key_str: str) -> Dict[str, int]:
    """Parse a key signature string and return note->accidental mapping.

    E.g., 'G' -> {'F': 1}, 'Dm' -> {'B': -1}, 'Amix' -> {'F': 1}
    """
    key_str = key_str.strip()
    if not key_str:
        return {}

    # Handle 'HP' and 'Hp' (Highland Pipe keys)
    if key_str in ('HP', 'Hp'):
        return {'F': 1, 'C': 1}

    # Parse key letter + optional accidental + optional mode
    m = re.match(r'^([A-G])([#b-]?)\s*(\w*)$', key_str)
    if not m:
        return {}

    key_letter = m.group(1)
    key_acc_str = m.group(2)
    mode_str = m.group(3).lower()

    # Build the key root name
    if key_acc_str == '#':
        key_name = key_letter + '#'
    elif key_acc_str in ('b', '-'):
        key_name = key_letter + 'b'
    else:
        key_name = key_letter

    # Determine mode offset
    sharp_offset = MODE_SHARP_OFFSETS.get(mode_str, 0)

    # Find number of sharps for the key root as major
    if key_name not in MAJOR_KEY_SHARPS:
        # Try alternate spelling
        alt = key_name.replace('b', '-')
        if alt in MAJOR_KEY_SHARPS:
            key_name = alt
        else:
            return {}

    num_sharps = MAJOR_KEY_SHARPS[key_name]

    # Apply mode offset: modal keys shift the number of sharps
    # E.g., D dorian has same accidentals as C major (0 sharps)
    # The offset tells us how many sharps to subtract
    num_sharps -= sharp_offset

    accidentals = {}
    if num_sharps > 0:
        for i in range(min(num_sharps, 7)):
            accidentals[SHARP_ORDER[i]] = 1
    elif num_sharps < 0:
        for i in range(min(-num_sharps, 7)):
            accidentals[FLAT_ORDER[i]] = -1

    return accidentals


# ---------------------------------------------------------------------------
# Accidental state tracking
# ---------------------------------------------------------------------------

class AccidentalState:
    """Track key signature and per-measure accidental overrides."""

    def __init__(self, key_accidentals: Dict[str, int]):
        self.key_accidentals = dict(key_accidentals)
        self.measure_overrides: Dict[str, int] = {}

    def set_key(self, key_accidentals: Dict[str, int]):
        self.key_accidentals = dict(key_accidentals)
        self.measure_overrides.clear()

    def new_measure(self):
        self.measure_overrides.clear()

    def set_accidental(self, note: str, accidental: int):
        """Record an explicit accidental for this measure."""
        self.measure_overrides[note] = accidental

    def get_accidental(self, note: str) -> int:
        """Get the effective accidental for a note."""
        if note in self.measure_overrides:
            return self.measure_overrides[note]
        return self.key_accidentals.get(note, 0)


# ---------------------------------------------------------------------------
# ABC parser
# ---------------------------------------------------------------------------

def parse_abc_file(text: str) -> list:
    """Parse an ABC file into a list of tunes.

    Each tune is a dict with 'headers' (dict) and 'body' (str).
    """
    tunes = []
    current_headers = {}
    current_body_lines = []
    in_tune = False

    for line in text.split('\n'):
        stripped = line.strip()

        # Skip empty lines and comments outside tunes
        if not stripped or stripped.startswith('%'):
            if in_tune and not stripped:
                # Empty line can end a tune body in some conventions
                # but we continue until next X: or EOF
                current_body_lines.append('')
            continue

        # Header line
        header_match = re.match(r'^([A-Za-z]):\s*(.*)', stripped)
        if header_match:
            field = header_match.group(1)
            value = header_match.group(2).strip()

            if field == 'X':
                # Start of a new tune
                if in_tune:
                    tunes.append({
                        'headers': current_headers,
                        'body': '\n'.join(current_body_lines),
                    })
                current_headers = {'X': value}
                current_body_lines = []
                in_tune = True
            elif in_tune:
                if field == 'K':
                    # K: is the last header before body
                    current_headers[field] = value
                elif field in ('w', 'W'):
                    # Lyrics — skip
                    continue
                elif field == 'V':
                    # Voice header can appear in body too
                    if 'K' in current_headers:
                        current_body_lines.append(stripped)
                    else:
                        current_headers.setdefault('V_defs', []).append(value)
                else:
                    current_headers[field] = value
        elif in_tune:
            current_body_lines.append(stripped)

    if in_tune:
        tunes.append({
            'headers': current_headers,
            'body': '\n'.join(current_body_lines),
        })

    return tunes


def parse_default_length(header_val: str) -> Fraction:
    """Parse L: header value like '1/8' into a Fraction of whole note."""
    header_val = header_val.strip()
    if '/' in header_val:
        parts = header_val.split('/')
        return Fraction(int(parts[0]), int(parts[1]))
    return Fraction(1, int(header_val)) if header_val.isdigit() else Fraction(1, 8)


def parse_meter(header_val: str) -> Optional[Tuple[int, int]]:
    """Parse M: header value like '4/4' or 'C'. Returns (num, den) or None."""
    header_val = header_val.strip()
    if header_val == 'C':
        return (4, 4)
    if header_val == 'C|':
        return (2, 2)
    if header_val.lower() == 'none':
        return None
    m = re.match(r'(\d+)/(\d+)', header_val)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return None


def parse_tempo(header_val: str) -> int:
    """Parse Q: header value. Returns BPM.

    Supports formats like:
    - '120' (simple BPM)
    - '1/4=120' (quarter note = 120)
    - '1/8=200' (eighth note = 200, effectively 100 QPM)
    - '3/8=80' (dotted quarter = 80)
    """
    header_val = header_val.strip()
    # Remove surrounding quotes if present
    header_val = header_val.strip('"')

    # Try "note_length=bpm" format
    m = re.match(r'(\d+)/(\d+)\s*=\s*(\d+)', header_val)
    if m:
        num, den, bpm = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # Convert to quarter-note BPM
        beat_fraction = Fraction(num, den)
        quarter = Fraction(1, 4)
        return max(1, round(bpm * beat_fraction / quarter))

    # Simple BPM number
    m = re.match(r'(\d+)', header_val)
    if m:
        return int(m.group(1))

    return 120


# Token types for body parsing
_RE_NOTE = re.compile(
    r'(\^{1,2}|_{1,2}|=)?'   # accidental: ^, ^^, _, __, =
    r'([A-Ga-g])'             # note letter
    r"([,']*)?"               # octave modifiers
    r'(\d*/*\d*)'             # duration: number, /number, number/number
)

_RE_REST = re.compile(
    r'[zx]'                   # rest
    r'(\d*/*\d*)'             # duration
)


def _parse_duration_str(dur_str: str, default_length: Fraction) -> Fraction:
    """Parse an ABC duration string relative to the default length.

    '' -> default_length
    '2' -> default_length * 2
    '/2' -> default_length / 2
    '/' -> default_length / 2
    '//' -> default_length / 4
    '3/2' -> default_length * 3/2
    """
    dur_str = dur_str.strip()
    if not dur_str:
        return default_length

    # Count leading slashes for shorthand halving
    if dur_str == '/':
        return default_length / 2
    if dur_str == '//':
        return default_length / 4

    if '/' in dur_str:
        parts = dur_str.split('/')
        num_str = parts[0].strip()
        den_str = parts[1].strip() if len(parts) > 1 else ''
        num = int(num_str) if num_str else 1
        den = int(den_str) if den_str else 2
        return default_length * Fraction(num, den)
    else:
        return default_length * int(dur_str)


def _parse_accidental(acc_str: str) -> int:
    """Convert ABC accidental string to integer."""
    if acc_str == '^':
        return 1
    elif acc_str == '^^':
        return 2
    elif acc_str == '_':
        return -1
    elif acc_str == '__':
        return -2
    elif acc_str == '=':
        return 0  # natural
    return None  # no explicit accidental


def parse_body(body: str, headers: dict) -> Dict[str, List]:
    """Parse the ABC body into voice -> list of events.

    Events are Notes or control markers (bar lines, repeats, etc.)
    Returns dict of voice_id -> event list.
    """
    # Determine defaults from headers
    meter = parse_meter(headers.get('M', '4/4'))
    default_length_header = headers.get('L', '')

    if default_length_header:
        default_length = parse_default_length(default_length_header)
    elif meter:
        # ABC convention: if meter >= 3/4, default length is 1/8; else 1/16
        meter_val = Fraction(meter[0], meter[1])
        default_length = Fraction(1, 8) if meter_val >= Fraction(3, 4) else Fraction(1, 16)
    else:
        default_length = Fraction(1, 8)

    key_str = headers.get('K', 'C')
    # Key might have inline modifiers like "K:G ^c" — parse just the key part
    key_parts = key_str.split()
    key_name = key_parts[0] if key_parts else 'C'
    key_acc = get_key_accidentals(key_name)
    acc_state = AccidentalState(key_acc)

    tempo = parse_tempo(headers.get('Q', '120'))
    velocity = 127
    current_voice = '1'  # default voice

    voices: Dict[str, List] = {'1': []}

    # Dynamics mapping
    dynamics_map = {
        'ppp': 16, 'pp': 32, 'p': 48, 'mp': 64,
        'mf': 80, 'f': 96, 'ff': 112, 'fff': 127,
    }

    def add_event(event):
        if current_voice not in voices:
            voices[current_voice] = []
        voices[current_voice].append(event)

    i = 0
    body_len = len(body)

    while i < body_len:
        ch = body[i]

        # Skip whitespace and newlines
        if ch in ' \t\n\r':
            i += 1
            continue

        # Skip comments (%)
        if ch == '%':
            # Skip to end of line
            while i < body_len and body[i] != '\n':
                i += 1
            continue

        # Lyrics line (w:)
        if ch == 'w' and i + 1 < body_len and body[i + 1] == ':':
            while i < body_len and body[i] != '\n':
                i += 1
            continue

        # Inline fields [X:value]
        if ch == '[' and i + 2 < body_len and body[i + 1].isalpha() and body[i + 2] == ':':
            field_char = body[i + 1]
            end_bracket = body.find(']', i + 3)
            if end_bracket == -1:
                i += 1
                continue
            field_value = body[i + 3:end_bracket].strip()

            if field_char == 'K':
                kp = field_value.split()
                kn = kp[0] if kp else 'C'
                acc_state.set_key(get_key_accidentals(kn))
            elif field_char == 'M':
                meter = parse_meter(field_value)
            elif field_char == 'L':
                default_length = parse_default_length(field_value)
            elif field_char == 'Q':
                tempo = parse_tempo(field_value)
                add_event(('tempo', tempo))
            elif field_char == 'V':
                voice_id = field_value.split()[0] if field_value else '1'
                current_voice = voice_id
                if current_voice not in voices:
                    voices[current_voice] = []

            i = end_bracket + 1
            continue

        # Header-like lines in body (V:, K:, M:, L:, Q:)
        if (i == 0 or body[i - 1] == '\n') and i + 1 < body_len and body[i + 1] == ':':
            field_char = ch
            colon_pos = i + 1
            eol = body.find('\n', colon_pos)
            if eol == -1:
                eol = body_len
            field_value = body[colon_pos + 1:eol].strip()

            if field_char == 'V':
                voice_id = field_value.split()[0] if field_value else '1'
                current_voice = voice_id
                if current_voice not in voices:
                    voices[current_voice] = []
                i = eol
                continue
            elif field_char == 'K':
                kp = field_value.split()
                kn = kp[0] if kp else 'C'
                acc_state.set_key(get_key_accidentals(kn))
                i = eol
                continue
            elif field_char == 'M':
                meter = parse_meter(field_value)
                i = eol
                continue
            elif field_char == 'L':
                default_length = parse_default_length(field_value)
                i = eol
                continue
            elif field_char == 'Q':
                tempo = parse_tempo(field_value)
                add_event(('tempo', tempo))
                i = eol
                continue

        # Bar lines
        if ch == '|':
            # Check multi-char bar tokens
            rest = body[i:i + 3]
            if rest.startswith('|:'):
                add_event(('repeat_start',))
                acc_state.new_measure()
                i += 2
                continue
            elif rest.startswith(':|'):
                add_event(('repeat_end',))
                acc_state.new_measure()
                i += 2
                continue
            elif rest.startswith('||'):
                add_event(('bar',))
                acc_state.new_measure()
                i += 2
                continue
            elif rest.startswith('|]'):
                add_event(('bar',))
                acc_state.new_measure()
                i += 2
                continue
            else:
                add_event(('bar',))
                acc_state.new_measure()
                i += 1
                continue

        if ch == ':' and i + 1 < body_len and body[i + 1] == '|':
            add_event(('repeat_end',))
            acc_state.new_measure()
            i += 2
            continue

        # Variant endings [1 and [2
        if ch == '[' and i + 1 < body_len and body[i + 1].isdigit():
            ending_num = int(body[i + 1])
            add_event(('variant', ending_num))
            i += 2
            continue

        # Tuplets (3abc -> triplet
        if ch == '(' and i + 1 < body_len and body[i + 1].isdigit():
            tuplet_n = int(body[i + 1])
            add_event(('tuplet', tuplet_n))
            i += 2
            # Skip optional :p:q
            if i < body_len and body[i] == ':':
                i += 1
                while i < body_len and body[i].isdigit():
                    i += 1
                if i < body_len and body[i] == ':':
                    i += 1
                    while i < body_len and body[i].isdigit():
                        i += 1
            continue

        # Grace notes {abc}
        if ch == '{':
            i += 1
            grace_notes = []
            while i < body_len and body[i] != '}':
                m = _RE_NOTE.match(body, i)
                if m:
                    acc_str, letter, octave_mod, dur_str = m.groups()
                    pitch = letter.upper()
                    abc_octave = _abc_octave(letter, octave_mod or '')
                    explicit_acc = _parse_accidental(acc_str) if acc_str else None
                    if explicit_acc is not None:
                        acc_state.set_accidental(pitch, explicit_acc)
                        acc_val = explicit_acc
                    else:
                        acc_val = acc_state.get_accidental(pitch)

                    grace_notes.append(Note(
                        pitch=pitch,
                        accidental=acc_val,
                        octave=abc_octave,
                        duration=Fraction(1, 32),  # grace notes are very short
                        is_grace=True,
                        velocity=velocity,
                    ))
                    i = m.end()
                else:
                    i += 1
            if i < body_len:
                i += 1  # skip '}'
            for gn in grace_notes:
                add_event(gn)
            continue

        # Dynamics (!pp! through !fff!)
        if ch == '!':
            end_bang = body.find('!', i + 1)
            if end_bang != -1:
                dyn_str = body[i + 1:end_bang].lower()
                if dyn_str in dynamics_map:
                    velocity = dynamics_map[dyn_str]
                i = end_bang + 1
                continue
            i += 1
            continue

        # Ties
        if ch == '-':
            # Mark the last note in current voice as tied
            if current_voice in voices and voices[current_voice]:
                for j in range(len(voices[current_voice]) - 1, -1, -1):
                    if isinstance(voices[current_voice][j], Note):
                        voices[current_voice][j].tied = True
                        break
            i += 1
            continue

        # Broken rhythm (> <) — handled in post-processing
        if ch in '<>':
            add_event(('broken_rhythm', ch))
            i += 1
            continue

        # Slurs (ignore)
        if ch == '(' and (i + 1 >= body_len or not body[i + 1].isdigit()):
            i += 1
            continue
        if ch == ')':
            i += 1
            continue

        # Chords [CEG]
        if ch == '[' and i + 1 < body_len and (body[i + 1] in 'ABCDEFGabcdefg^_='):
            i += 1
            chord_notes = []
            while i < body_len and body[i] != ']':
                m = _RE_NOTE.match(body, i)
                if m:
                    acc_str, letter, octave_mod, dur_str = m.groups()
                    pitch = letter.upper()
                    abc_octave = _abc_octave(letter, octave_mod or '')
                    explicit_acc = _parse_accidental(acc_str) if acc_str else None
                    if explicit_acc is not None:
                        acc_state.set_accidental(pitch, explicit_acc)
                        acc_val = explicit_acc
                    else:
                        acc_val = acc_state.get_accidental(pitch)
                    dur = _parse_duration_str(dur_str or '', default_length)

                    chord_notes.append(Note(
                        pitch=pitch,
                        accidental=acc_val,
                        octave=abc_octave,
                        duration=dur,
                        velocity=velocity,
                    ))
                    i = m.end()
                else:
                    i += 1

            if i < body_len:
                i += 1  # skip ']'

            # Check for duration after the closing bracket
            dur_after = ''
            while i < body_len and (body[i].isdigit() or body[i] == '/'):
                dur_after += body[i]
                i += 1
            if dur_after:
                chord_dur = _parse_duration_str(dur_after, default_length)
                for cn in chord_notes:
                    cn.duration = chord_dur

            # Assign chord group
            chord_idx = id(chord_notes)  # unique ID for this chord
            for cn in chord_notes:
                cn.chord_group = chord_idx
            for cn in chord_notes:
                add_event(cn)
            continue

        # Rests
        if ch in 'zx':
            m = _RE_REST.match(body, i)
            if m:
                dur_str = m.group(1)
                dur = _parse_duration_str(dur_str or '', default_length)
                add_event(Note(
                    pitch='R',
                    accidental=0,
                    octave=4,
                    duration=dur,
                    is_rest=True,
                    velocity=velocity,
                ))
                i = m.end()
                continue

        # Multi-measure rest Z
        if ch == 'Z':
            i += 1
            num_str = ''
            while i < body_len and body[i].isdigit():
                num_str += body[i]
                i += 1
            n_measures = int(num_str) if num_str else 1
            if meter:
                measure_dur = Fraction(meter[0], meter[1])
            else:
                measure_dur = Fraction(4, 4)
            for _ in range(n_measures):
                add_event(Note(
                    pitch='R', accidental=0, octave=4,
                    duration=measure_dur, is_rest=True, velocity=velocity,
                ))
            continue

        # Notes
        m = _RE_NOTE.match(body, i)
        if m:
            acc_str, letter, octave_mod, dur_str = m.groups()
            pitch = letter.upper()
            abc_octave = _abc_octave(letter, octave_mod or '')
            explicit_acc = _parse_accidental(acc_str) if acc_str else None

            if explicit_acc is not None:
                acc_state.set_accidental(pitch, explicit_acc)
                acc_val = explicit_acc
            else:
                acc_val = acc_state.get_accidental(pitch)

            dur = _parse_duration_str(dur_str or '', default_length)

            add_event(Note(
                pitch=pitch,
                accidental=acc_val,
                octave=abc_octave,
                duration=dur,
                velocity=velocity,
            ))
            i = m.end()
            continue

        # Skip anything else
        i += 1

    return voices, tempo


def _abc_octave(letter: str, octave_mod: str) -> int:
    """Convert ABC note letter + octave modifiers to SamBasic octave.

    Uppercase C = middle C = SamBasic O4
    Lowercase c = octave above = SamBasic O5
    Each , lowers by 1, each ' raises by 1
    """
    if letter.isupper():
        base = 4
    else:
        base = 5

    for ch in (octave_mod or ''):
        if ch == "'":
            base += 1
        elif ch == ',':
            base -= 1

    return base


# ---------------------------------------------------------------------------
# Post-processing passes
# ---------------------------------------------------------------------------

def apply_tuplets(events: List) -> List:
    """Apply tuplet duration adjustments.

    (3abc → triplet: 3 notes in the time of 2 → multiply durations by 2/3
    (n → n notes in the time of (n-1) for n=3,5,6,7,9; n/2 for n=2,4,8
    """
    result = []
    tuplet_remaining = 0
    tuplet_ratio = Fraction(1)

    for event in events:
        if isinstance(event, tuple) and event[0] == 'tuplet':
            n = event[1]
            # Standard ABC tuplet defaults
            if n in (3, 5, 6, 7, 9):
                p = n - 1  # play n notes in time of (n-1)
            elif n in (2, 4, 8):
                p = n + 1 if n == 2 else 3 if n == 4 else 3  # approximate
                # More standard: (2 = 2 in time of 3, (4 = 4 in time of 3
                if n == 2:
                    p = 3
                elif n == 4:
                    p = 3
                elif n == 8:
                    p = 6
            else:
                p = n - 1
            tuplet_ratio = Fraction(p, n)
            tuplet_remaining = n
            continue

        if isinstance(event, Note) and tuplet_remaining > 0:
            event.duration = event.duration * tuplet_ratio
            tuplet_remaining -= 1

        result.append(event)

    return result


def apply_broken_rhythm(events: List) -> List:
    """Apply broken rhythm modifiers (> and <).

    A>B → A is dotted (3/2 duration), B is halved (1/2 duration)
    A<B → A is halved, B is dotted
    """
    result = []
    i = 0
    while i < len(events):
        if isinstance(events[i], tuple) and events[i][0] == 'broken_rhythm':
            direction = events[i][1]
            # Find previous and next notes
            prev_note = None
            for j in range(len(result) - 1, -1, -1):
                if isinstance(result[j], Note) and not result[j].is_rest:
                    prev_note = result[j]
                    break
            # Find next note
            next_note = None
            for j in range(i + 1, len(events)):
                if isinstance(events[j], Note) and not events[j].is_rest:
                    next_note = events[j]
                    break

            if prev_note and next_note:
                if direction == '>':
                    prev_note.duration = prev_note.duration * Fraction(3, 2)
                    next_note.duration = next_note.duration * Fraction(1, 2)
                else:
                    prev_note.duration = prev_note.duration * Fraction(1, 2)
                    next_note.duration = next_note.duration * Fraction(3, 2)
            i += 1
            continue
        result.append(events[i])
        i += 1
    return result


def expand_repeats(events: List) -> List:
    """Expand repeat signs |: :| and variant endings [1 [2.

    Stack-based: track |: positions, on :| duplicate from last |:.
    Variant endings: first pass includes [1, second pass skips [1 and includes [2.
    """
    # First, find and process repeat sections
    result = []
    repeat_stack = []  # stack of indices into result

    i = 0
    while i < len(events):
        event = events[i]

        if isinstance(event, tuple):
            if event[0] == 'repeat_start':
                repeat_stack.append(len(result))
                i += 1
                continue
            elif event[0] == 'repeat_end':
                if repeat_stack:
                    start = repeat_stack[-1]
                    # Collect the section to repeat
                    section = list(result[start:])

                    # Check for variant endings in the section
                    variant_1_start = None
                    variant_2_start = None
                    for j, ev in enumerate(section):
                        if isinstance(ev, tuple) and ev[0] == 'variant':
                            if ev[1] == 1:
                                variant_1_start = j
                            elif ev[1] == 2:
                                variant_2_start = j

                    if variant_1_start is not None and variant_2_start is not None:
                        # First pass already played: everything up to [2
                        # Second pass: play up to [1, then skip to [2
                        before_v1 = section[:variant_1_start]
                        after_v2 = section[variant_2_start + 1:]
                        result.extend(before_v1)
                        result.extend(after_v2)
                    elif variant_1_start is not None:
                        # Only [1 ending, no [2: repeat without the [1 section
                        before_v1 = section[:variant_1_start]
                        result.extend(before_v1)
                    else:
                        # Simple repeat: duplicate entire section
                        result.extend(section)

                    repeat_stack.pop()
                i += 1
                continue
            elif event[0] == 'variant':
                result.append(event)
                i += 1
                continue

        result.append(event)
        i += 1

    # Strip variant markers from final result
    result = [e for e in result if not (isinstance(e, tuple) and e[0] == 'variant')]

    return result


def merge_ties(events: List) -> List:
    """Merge tied notes into single longer notes."""
    result = []
    for event in events:
        if isinstance(event, Note) and not event.is_rest and result:
            # Check if previous note is tied to this one
            for j in range(len(result) - 1, -1, -1):
                prev = result[j]
                if isinstance(prev, Note):
                    if (prev.tied and not prev.is_rest
                            and prev.pitch == event.pitch
                            and prev.octave == event.octave
                            and prev.accidental == event.accidental):
                        prev.duration += event.duration
                        prev.tied = event.tied  # carry forward if still tied
                        break
                    else:
                        result.append(event)
                        break
                elif isinstance(prev, tuple) and prev[0] == 'bar':
                    # Ties can cross bar lines
                    continue
                else:
                    result.append(event)
                    break
            else:
                result.append(event)
        else:
            result.append(event)
    return result


def split_chords(events: List, no_chords: bool = False) -> Dict[int, List[Note]]:
    """Split events into voices, separating chord notes.

    Returns dict of voice_number -> list of Notes (with time positions).
    Voice 0 gets the highest note of each chord + all non-chord notes.
    Voice 1,2,... get lower chord notes.
    """
    # Filter to just notes and tempo changes, tracking time
    voices: Dict[int, List[Note]] = {0: []}
    time_pos = Fraction(0)

    for event in events:
        if isinstance(event, tuple):
            if event[0] in ('bar', 'repeat_start', 'repeat_end'):
                continue
            if event[0] == 'tempo':
                # Add tempo marker to voice 0
                voices[0].append(('tempo', event[1], time_pos))
                continue
            continue

        if not isinstance(event, Note):
            continue

        note = event

        if note.is_grace:
            # Grace notes: steal time, add to voice 0
            voices[0].append(Note(
                pitch=note.pitch, accidental=note.accidental,
                octave=note.octave, duration=note.duration,
                is_grace=True, velocity=note.velocity,
            ))
            # Don't advance time_pos — grace notes steal from next note
            continue

        if note.chord_group >= 0:
            # Collect all notes with same chord group
            # They'll appear consecutively
            if no_chords:
                # Just take the note as-is in voice 0
                voices[0].append(Note(
                    pitch=note.pitch, accidental=note.accidental,
                    octave=note.octave, duration=note.duration,
                    velocity=note.velocity,
                ))
                # Only advance time for the first note of the chord
                # (Handled below — chord notes all have same duration)
            else:
                # Add to appropriate voice
                voices[0].append(Note(
                    pitch=note.pitch, accidental=note.accidental,
                    octave=note.octave, duration=note.duration,
                    velocity=note.velocity,
                ))
            time_pos += note.duration
        else:
            voices[0].append(note)
            time_pos += note.duration

    # Now handle chord splitting properly
    # Re-process: walk through events, group chord notes, assign to voices
    if not no_chords:
        voices = _split_chords_proper(events)

    return voices


def _split_chords_proper(events: List) -> Dict[int, List]:
    """Proper chord splitting: walk events, group chords, assign voices."""
    voices: Dict[int, List] = {0: []}
    time_pos = Fraction(0)
    max_voice = 0

    i = 0
    note_events = []

    # First, collect note events with time positions
    for event in events:
        if isinstance(event, tuple):
            if event[0] == 'tempo':
                note_events.append(('tempo', event[1], time_pos))
            continue
        if not isinstance(event, Note):
            continue

        if event.is_grace:
            note_events.append(('grace', event, time_pos))
            continue

        # Check if this note is part of a chord group
        note_events.append(('note', event, time_pos))
        if event.chord_group < 0:
            time_pos += event.duration

    # Group consecutive chord notes
    processed = []
    i = 0
    while i < len(note_events):
        ev = note_events[i]
        if ev[0] == 'note' and ev[1].chord_group >= 0:
            # Collect all notes with the same chord group
            chord_group_id = ev[1].chord_group
            chord = []
            while i < len(note_events) and note_events[i][0] == 'note' and note_events[i][1].chord_group == chord_group_id:
                chord.append(note_events[i])
                i += 1
            # Sort chord notes by octave*10 + pitch descending (highest first)
            pitch_order = {'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6}
            chord.sort(key=lambda x: (x[1].octave, pitch_order.get(x[1].pitch, 0)), reverse=True)
            # Use duration from first note for time advancement
            chord_dur = chord[0][1].duration
            processed.append(('chord', chord, ev[2], chord_dur))
        else:
            processed.append(ev)
            i += 1

    # Now assign to voices
    for item in processed:
        if item[0] == 'tempo':
            voices[0].append(item)
        elif item[0] == 'grace':
            voices[0].append(item[1])
        elif item[0] == 'chord':
            _, chord_notes, t_pos, chord_dur = item
            for vi, (_, note, _) in enumerate(chord_notes):
                if vi not in voices:
                    voices[vi] = []
                    max_voice = max(max_voice, vi)
                voices[vi].append(note)

            # Fill other voices with rests for this chord's duration
            # (Not needed here — we handle alignment in make_music_string)
            time_pos = t_pos + chord_dur
        elif item[0] == 'note':
            voices[0].append(item[1])
            time_pos = item[2] + item[1].duration

    # For multi-voice output, we need to ensure alignment
    # The simplest approach: voice 0 gets top notes, other voices get chord notes
    # with rests filling the gaps
    if max_voice > 0:
        voices = _align_chord_voices(voices, events)

    return voices


def _align_chord_voices(voices: Dict[int, List], events: List) -> Dict[int, List]:
    """Align chord voices by inserting rests where a voice has no chord note."""
    # Rebuild from scratch with proper time tracking
    aligned: Dict[int, List] = {}
    max_voice = max(voices.keys())

    # Walk through events tracking time
    time_positions: Dict[int, Fraction] = {}  # voice -> current time
    for v in range(max_voice + 1):
        aligned[v] = []
        time_positions[v] = Fraction(0)

    for event in events:
        if isinstance(event, tuple):
            if event[0] == 'tempo':
                aligned[0].append(('tempo', event[1], time_positions[0]))
            continue
        if not isinstance(event, Note):
            continue

        if event.is_grace:
            aligned[0].append(event)
            continue

        if event.chord_group >= 0:
            continue  # handled in chord group pass below

        # Non-chord note: goes to voice 0, other voices get rests
        aligned[0].append(event)
        for v in range(1, max_voice + 1):
            aligned[v].append(Note(
                pitch='R', accidental=0, octave=4,
                duration=event.duration, is_rest=True,
            ))

    # Now re-process chord groups
    chord_groups = {}  # chord_group_id -> list of notes
    for event in events:
        if isinstance(event, Note) and event.chord_group >= 0:
            if event.chord_group not in chord_groups:
                chord_groups[event.chord_group] = []
            chord_groups[event.chord_group].append(event)

    # We need to insert chord notes at the right positions
    # This is complex — let's use a simpler approach: rebuild everything
    return _rebuild_with_chords(events, max_voice)


def _rebuild_with_chords(events: List, max_voice: int) -> Dict[int, List]:
    """Rebuild voice lists with proper chord splitting and rest filling."""
    voices: Dict[int, List] = {}
    for v in range(max_voice + 1):
        voices[v] = []

    pitch_order = {'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6}

    current_chord_group = None
    chord_notes = []

    def flush_chord():
        nonlocal chord_notes
        if not chord_notes:
            return
        # Sort highest first
        chord_notes.sort(
            key=lambda n: (n.octave, pitch_order.get(n.pitch, 0)),
            reverse=True
        )
        dur = chord_notes[0].duration
        for vi, note in enumerate(chord_notes):
            if vi > max_voice:
                break
            voices[vi].append(note)
        # Fill remaining voices with rests
        for vi in range(len(chord_notes), max_voice + 1):
            voices[vi].append(Note(
                pitch='R', accidental=0, octave=4,
                duration=dur, is_rest=True,
            ))
        chord_notes = []

    for event in events:
        if isinstance(event, tuple):
            flush_chord()
            if event[0] == 'tempo':
                voices[0].append(('tempo', event[1], Fraction(0)))
            continue
        if not isinstance(event, Note):
            continue

        if event.is_grace:
            flush_chord()
            voices[0].append(event)
            continue

        if event.chord_group >= 0:
            if current_chord_group is not None and event.chord_group != current_chord_group:
                flush_chord()
            current_chord_group = event.chord_group
            chord_notes.append(event)
        else:
            flush_chord()
            current_chord_group = None
            # Non-chord note: voice 0 gets it, others get rest
            voices[0].append(event)
            for v in range(1, max_voice + 1):
                voices[v].append(Note(
                    pitch='R', accidental=0, octave=4,
                    duration=event.duration, is_rest=True,
                ))

    flush_chord()

    # Trim trailing rests from non-primary voices
    for v in range(1, max_voice + 1):
        while voices[v] and isinstance(voices[v][-1], Note) and voices[v][-1].is_rest:
            voices[v].pop()

    # Remove empty voices
    voices = {v: notes for v, notes in voices.items() if notes}

    return voices


# ---------------------------------------------------------------------------
# Transpose
# ---------------------------------------------------------------------------

NOTE_TO_SEMITONE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
SEMITONE_TO_NOTE = {0: ('C', 0), 1: ('C', 1), 2: ('D', 0), 3: ('E', -1),
                    4: ('E', 0), 5: ('F', 0), 6: ('F', 1), 7: ('G', 0),
                    8: ('G', 1), 9: ('A', 0), 10: ('B', -1), 11: ('B', 0)}


def transpose_note(note: Note, semitones: int):
    """Transpose a note by the given number of semitones (in place)."""
    if note.is_rest:
        return
    base = NOTE_TO_SEMITONE.get(note.pitch, 0) + note.accidental
    total = base + semitones + note.octave * 12
    new_octave = total // 12
    new_semitone = total % 12
    new_pitch, new_acc = SEMITONE_TO_NOTE[new_semitone]
    note.pitch = new_pitch
    note.accidental = new_acc
    note.octave = new_octave


# ---------------------------------------------------------------------------
# Music string generation (matches midi2basic.py pattern)
# ---------------------------------------------------------------------------

# SamBasic available note lengths (as fractions of a whole note)
# L1 = 1, L2 = 1/2, L4 = 1/4, L8 = 1/8, L16 = 1/16, L32 = 1/32, L64 = 1/64
# Dotted: L2. = 3/4, L4. = 3/8, L8. = 3/16, L16. = 3/32, L32. = 3/64

SAMBASIC_LENGTHS = [
    (Fraction(1, 1),  '1',  False),
    (Fraction(3, 4),  '2',  True),    # dotted half
    (Fraction(1, 2),  '2',  False),
    (Fraction(3, 8),  '4',  True),    # dotted quarter
    (Fraction(1, 3),  '3',  False),   # triplet half
    (Fraction(1, 4),  '4',  False),
    (Fraction(1, 4),  '6',  True),    # dotted triplet quarter
    (Fraction(3, 16), '8',  True),    # dotted eighth
    (Fraction(1, 6),  '6',  False),   # triplet quarter
    (Fraction(1, 8),  '8',  False),
    (Fraction(1, 8),  '12', True),    # dotted triplet eighth
    (Fraction(3, 32), '16', True),    # dotted sixteenth
    (Fraction(1, 12), '12', False),   # triplet eighth
    (Fraction(1, 16), '16', False),
    (Fraction(1, 16), '24', True),    # dotted triplet sixteenth
    (Fraction(3, 64), '32', True),    # dotted 32nd
    (Fraction(1, 24), '24', False),   # triplet sixteenth
    (Fraction(1, 32), '32', False),
    (Fraction(1, 48), '48', False),   # triplet 32nd
    (Fraction(1, 64), '64', False),
]


def _nearest_sambasic_length(duration: Fraction) -> List[Tuple[str, bool]]:
    """Decompose a duration into SamBasic length tokens (greedy).

    Returns list of (length_number_str, is_dotted) pairs.
    E.g., quarter note → [('4', False)]
          dotted quarter → [('4', True)]
          quarter + eighth → [('4', False), ('8', False)]

    Non-representable durations (e.g., triplets 1/6) are approximated
    to the nearest single length with a warning.
    """
    # First, check for an exact single match
    for frac, num_str, is_dotted in SAMBASIC_LENGTHS:
        if duration == frac:
            return [(num_str, is_dotted)]

    # Try greedy decomposition (max 6 parts to handle long tied notes)
    remaining = duration
    result = []

    for frac, num_str, is_dotted in SAMBASIC_LENGTHS:
        while remaining >= frac and len(result) < 6:
            result.append((num_str, is_dotted))
            remaining -= frac

    if remaining == 0 and result:
        return result

    # If greedy didn't produce an exact fit, find the single closest match
    best_diff = Fraction(100)
    best = ('4', False)
    for frac, num_str, is_dotted in SAMBASIC_LENGTHS:
        diff = abs(duration - frac)
        if diff < best_diff:
            best_diff = diff
            best = (num_str, is_dotted)

    # Use single closest if greedy left a significant remainder
    if remaining > 0:
        print(f"Warning: duration {duration} approximated to L{best[0]}{'.' if best[1] else ''}",
              file=sys.stderr)
        return [best]

    return result


def _note_name_sambasic(pitch: str, accidental: int) -> str:
    """Convert pitch + accidental to SamBasic note name.

    SamBasic uses # for sharp, - for flat. Only single sharps/flats.
    Double sharps/flats are converted to enharmonic equivalents.
    """
    if pitch == 'R':
        return 'R'

    base = NOTE_TO_SEMITONE.get(pitch, 0)
    total_semitone = (base + accidental) % 12
    note_name, remaining_acc = SEMITONE_TO_NOTE[total_semitone]

    if remaining_acc == 1:
        return note_name + '#'
    elif remaining_acc == -1:
        return note_name + '-'
    return note_name


def make_music_string(notes: List, tempo: int) -> str:
    """Generate a SamBasic music string from a list of Notes.

    Follows midi2basic.py pattern: track cur_octave, cur_length, cur_velocity
    to minimize redundant commands.
    """
    tokens = []
    cur_octave = None
    cur_length = None  # current default length number (e.g., '4')
    cur_velocity = None

    # Add tempo
    tokens.append(f'T{tempo}')

    for item in notes:
        # Handle tempo change markers
        if isinstance(item, tuple) and item[0] == 'tempo':
            tokens.append(f'T{item[1]}')
            continue

        if not isinstance(item, Note):
            continue

        note = item
        note_name = _note_name_sambasic(note.pitch, note.accidental)

        # Velocity
        qvel = min(127, round(note.velocity / 8) * 8)
        if qvel != cur_velocity and not note.is_rest:
            tokens.append(f'V{qvel}')
            cur_velocity = qvel

        # Octave
        if not note.is_rest and note.octave != cur_octave:
            tokens.append(f'O{note.octave}')
            cur_octave = note.octave

        # Duration decomposition
        parts = _nearest_sambasic_length(note.duration)

        for length_num, is_dotted in parts:
            if is_dotted:
                # Dotted: use per-note override (e.g., C4.)
                tokens.append(f'{note_name}{length_num}.')
            elif length_num != cur_length:
                # Length changed: emit L command then bare note
                tokens.append(f'L{length_num}')
                cur_length = length_num
                tokens.append(note_name)
            else:
                tokens.append(note_name)

    return ' '.join(tokens)


# ---------------------------------------------------------------------------
# Output generation
# ---------------------------------------------------------------------------

WAVEFORMS = ['SQUARE', 'TRIANGLE', 'SINE', 'SAWTOOTH']


def generate_output(voice_notes: Dict, tempo: int, wave_override: str,
                    section_beats: Optional[int], source_name: str,
                    title: str = '') -> str:
    """Generate SamBasic output from processed voice notes."""
    lines = [f"' Converted from: {source_name}"]
    if title:
        lines.append(f"' Title: {title}")
    lines.append('')

    # Determine voices and their notes
    voice_ids = sorted(voice_notes.keys())

    if not voice_ids:
        return "' No notes found in ABC file\n"

    # Check if all voices have notes
    voice_ids = [v for v in voice_ids if voice_notes[v]]
    if not voice_ids:
        return "' No notes found in ABC file\n"

    # Calculate total duration for section splitting
    def voice_duration(notes):
        total = Fraction(0)
        for n in notes:
            if isinstance(n, Note):
                total += n.duration
        return total

    max_duration = max(voice_duration(voice_notes[v]) for v in voice_ids)

    if section_beats:
        beat_duration = Fraction(1, 4)  # quarter note
        section_duration = beat_duration * section_beats
    else:
        section_duration = max_duration

    # Split into sections if needed
    if section_beats and max_duration > section_duration:
        sections = _split_into_sections(voice_notes, voice_ids, section_duration)
    else:
        sections = [{v: voice_notes[v] for v in voice_ids}]

    for section in sections:
        active_voices = [v for v in voice_ids if v in section and section[v]]

        if len(active_voices) == 1:
            v = active_voices[0]
            wf = wave_override or WAVEFORMS[0]
            ms = make_music_string(section[v], tempo)
            lines.append(f'PLAY "{ms}", WAVE {wf}')
        elif len(active_voices) > 1:
            lines.append('PLAYPOLY (')
            for idx, v in enumerate(active_voices):
                wf = wave_override or WAVEFORMS[idx % len(WAVEFORMS)]
                ms = make_music_string(section[v], tempo)
                lines.append(f'  ["{ms}" WAVE {wf}]')
            lines.append(f') TEMPO {tempo}')

        lines.append('')

    return '\n'.join(lines)


def _split_into_sections(voice_notes: Dict, voice_ids: list,
                         section_duration: Fraction) -> list:
    """Split voice notes into sections of given duration."""
    sections = []

    # Track position in each voice
    voice_positions = {v: 0 for v in voice_ids}
    voice_time = {v: Fraction(0) for v in voice_ids}

    done = False
    while not done:
        section = {}
        section_start = min(voice_time[v] for v in voice_ids)
        section_end = section_start + section_duration

        done = True
        for v in voice_ids:
            section[v] = []
            pos = voice_positions[v]
            notes = voice_notes[v]
            t = voice_time[v]

            while pos < len(notes):
                item = notes[pos]
                if isinstance(item, Note):
                    if t + item.duration <= section_end + Fraction(1, 128):
                        section[v].append(item)
                        t += item.duration
                        pos += 1
                    else:
                        # Note spans section boundary — split or include
                        remaining = section_end - t
                        if remaining > Fraction(1, 64):
                            # Include partial
                            section[v].append(Note(
                                pitch=item.pitch, accidental=item.accidental,
                                octave=item.octave, duration=remaining,
                                is_rest=item.is_rest, velocity=item.velocity,
                            ))
                            # Adjust remaining note
                            item.duration -= remaining
                            t = section_end
                        break
                else:
                    section[v].append(item)
                    pos += 1

            voice_positions[v] = pos
            voice_time[v] = t
            if pos < len(notes):
                done = False

        sections.append(section)

    return sections


# ---------------------------------------------------------------------------
# Info mode
# ---------------------------------------------------------------------------

def print_info(filepath: str, tunes: list):
    """Print ABC metadata."""
    print(f"File:    {filepath}")
    print(f"Tunes:   {len(tunes)}")
    print()

    for i, tune in enumerate(tunes):
        h = tune['headers']
        print(f"--- Tune {i + 1} ---")
        print(f"  X: {h.get('X', '?')}")
        if 'T' in h:
            print(f"  Title: {h['T']}")
        if 'C' in h:
            print(f"  Composer: {h['C']}")
        if 'M' in h:
            print(f"  Meter: {h['M']}")
        if 'L' in h:
            print(f"  Default length: {h['L']}")
        if 'K' in h:
            print(f"  Key: {h['K']}")
        if 'Q' in h:
            print(f"  Tempo: {h['Q']}")
        if 'V_defs' in h:
            print(f"  Voices: {len(h['V_defs'])}")
        print()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def process_tune(tune: dict, no_chords: bool = False,
                 transpose: int = 0) -> Tuple[Dict, int]:
    """Process a single tune through the full pipeline.

    Returns (voice_notes, tempo).
    """
    headers = tune['headers']
    body = tune['body']

    # Parse body into voice event lists
    voices, tempo = parse_body(body, headers)

    all_voice_notes = {}

    for voice_id, events in voices.items():
        # Apply tuplets
        events = apply_tuplets(events)

        # Apply broken rhythm
        events = apply_broken_rhythm(events)

        # Expand repeats
        events = expand_repeats(events)

        # Merge ties
        events = merge_ties(events)

        # Strip non-note events (bars, etc.)
        notes = [e for e in events if isinstance(e, Note) or
                 (isinstance(e, tuple) and e[0] == 'tempo')]

        # Transpose
        if transpose:
            for n in notes:
                if isinstance(n, Note):
                    transpose_note(n, transpose)

        all_voice_notes[voice_id] = notes

    # Now handle chord splitting across all voices
    final_voices = {}
    voice_counter = 0

    for voice_id in sorted(all_voice_notes.keys()):
        notes = all_voice_notes[voice_id]

        # Check if any notes have chord groups
        has_chords = any(isinstance(n, Note) and n.chord_group >= 0 for n in notes)

        if has_chords and not no_chords:
            # Build event list with chord info preserved
            chord_voices = _split_chords_proper(notes)
            for cv_id in sorted(chord_voices.keys()):
                final_voices[voice_counter] = chord_voices[cv_id]
                voice_counter += 1
        else:
            # Strip chord group markers
            final_voices[voice_counter] = notes
            voice_counter += 1

    return final_voices, tempo


# ---------------------------------------------------------------------------
# SAM → ABC: Parse .sam files
# ---------------------------------------------------------------------------

def parse_sam_file(text: str) -> List[MusicBlock]:
    """Extract PLAY/PLAYPOLY statements from a .sam file.

    Returns a list of MusicBlock objects representing sequential music blocks.
    """
    blocks: List[MusicBlock] = []

    # Remove comment lines (lines starting with optional whitespace then ')
    lines = text.split('\n')
    cleaned = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("'"):
            continue
        cleaned.append(line)
    text = '\n'.join(cleaned)

    # Find PLAYPOLY blocks: PLAYPOLY ( ... ) TEMPO N [BACKGROUND ...] [REPEAT ...]
    playpoly_re = re.compile(
        r'PLAYPOLY\s*\((.*?)\)\s*'
        r'(?:TEMPO\s+(\d+))?',
        re.DOTALL
    )

    # Find PLAY statements: PLAY "...", WAVE ...
    play_re = re.compile(
        r'PLAY\s+"([^"]+)"'
        r'(?:\s*,\s*WAVE\s+(SQUARE|TRIANGLE|SINE|SAWTOOTH))?'
    )

    # Track positions to avoid double-matching
    used_ranges = []

    for m in playpoly_re.finditer(text):
        inner = m.group(1)
        tempo = int(m.group(2)) if m.group(2) else 120
        used_ranges.append((m.start(), m.end()))

        # Parse voice entries: ["..." WAVE ...]
        voice_re = re.compile(
            r'\[\s*"([^"]+)"\s*'
            r'(?:WAVE\s+(SQUARE|TRIANGLE|SINE|SAWTOOTH))?\s*\]'
        )
        voices = []
        waveforms = []
        for vm in voice_re.finditer(inner):
            voices.append(vm.group(1))
            waveforms.append(vm.group(2) or 'SQUARE')

        if voices:
            # Try to extract tempo from first voice's T command if not in TEMPO
            if tempo == 120:
                t_match = re.match(r'T(\d+)', voices[0].strip())
                if t_match:
                    tempo = int(t_match.group(1))
            blocks.append(MusicBlock(voices=voices, waveforms=waveforms, tempo=tempo))

    for m in play_re.finditer(text):
        # Skip if this PLAY is inside a PLAYPOLY we already matched
        if any(start <= m.start() < end for start, end in used_ranges):
            continue
        music_str = m.group(1)
        waveform = m.group(2) or 'SQUARE'
        tempo = 120
        t_match = re.match(r'T(\d+)', music_str.strip())
        if t_match:
            tempo = int(t_match.group(1))
        blocks.append(MusicBlock(voices=[music_str], waveforms=[waveform], tempo=tempo))

    return blocks


# ---------------------------------------------------------------------------
# SAM → ABC: Parse music strings
# ---------------------------------------------------------------------------

def parse_play_string(music_str: str) -> List:
    """Parse a SamBasic music string into a list of Note objects and tempo markers.

    Walks the string character by character, tracking octave/length/velocity state.
    """
    result = []
    i = 0
    s = music_str.strip()
    length = len(s)

    cur_octave = 4
    cur_length = Fraction(1, 4)  # default quarter note
    cur_velocity = 127

    note_letters = set('ABCDEFGR')

    while i < length:
        ch = s[i].upper()

        # Skip whitespace
        if s[i] in ' \t':
            i += 1
            continue

        # Octave command: O followed by digit(s)
        if ch == 'O' and i + 1 < length and s[i + 1].isdigit():
            i += 1
            num_str = ''
            while i < length and s[i].isdigit():
                num_str += s[i]
                i += 1
            cur_octave = int(num_str)
            continue

        # Octave shift
        if ch == '>':
            cur_octave += 1
            i += 1
            continue
        if ch == '<':
            cur_octave -= 1
            i += 1
            continue

        # Length command: L followed by digit(s)
        if ch == 'L' and i + 1 < length and s[i + 1].isdigit():
            i += 1
            num_str = ''
            while i < length and s[i].isdigit():
                num_str += s[i]
                i += 1
            cur_length = Fraction(1, int(num_str))
            continue

        # Tempo command: T followed by digit(s)
        if ch == 'T' and i + 1 < length and s[i + 1].isdigit():
            i += 1
            num_str = ''
            while i < length and s[i].isdigit():
                num_str += s[i]
                i += 1
            result.append(('tempo', int(num_str)))
            continue

        # Velocity command: V followed by digit(s)
        if ch == 'V' and i + 1 < length and s[i + 1].isdigit():
            i += 1
            num_str = ''
            while i < length and s[i].isdigit():
                num_str += s[i]
                i += 1
            cur_velocity = int(num_str)
            continue

        # Percussion: P followed by letter — skip with warning
        if ch == 'P' and i + 1 < length and s[i + 1].upper() in 'KSHC':
            print(f"Warning: percussion command P{s[i+1]} skipped (not supported in ABC)",
                  file=sys.stderr)
            i += 2
            # Skip optional length
            while i < length and (s[i].isdigit() or s[i] == '.'):
                i += 1
            continue

        # Notes A-G and Rest R
        if ch in note_letters:
            pitch = ch
            is_rest = (ch == 'R')
            accidental = 0
            i += 1

            # Parse accidental: # or + (sharp), - (flat)
            if not is_rest and i < length:
                if s[i] in '#' '+':
                    accidental = 1
                    i += 1
                elif s[i] == '-':
                    accidental = -1
                    i += 1

            # Parse optional length number
            note_dur = cur_length
            num_str = ''
            while i < length and s[i].isdigit():
                num_str += s[i]
                i += 1
            if num_str:
                note_dur = Fraction(1, int(num_str))

            # Parse optional dot (dotted note)
            is_dotted = False
            if i < length and s[i] == '.':
                is_dotted = True
                note_dur = note_dur * Fraction(3, 2)
                i += 1

            result.append(Note(
                pitch=pitch,
                accidental=accidental,
                octave=cur_octave,
                duration=note_dur,
                is_rest=is_rest,
                velocity=cur_velocity,
            ))
            continue

        # Skip unrecognized characters
        i += 1

    return result


# ---------------------------------------------------------------------------
# SAM → ABC: Generate ABC notation
# ---------------------------------------------------------------------------

_VELOCITY_DYNAMICS = [
    (24, None),
    (40, '!pp!'),
    (56, '!p!'),
    (72, '!mp!'),
    (88, '!mf!'),
    (104, '!f!'),
    (120, '!ff!'),
    (127, '!fff!'),
]


def _velocity_to_dynamic(vel: int) -> Optional[str]:
    """Map a velocity value to an ABC dynamics decoration."""
    for threshold, dyn in _VELOCITY_DYNAMICS:
        if vel <= threshold:
            return dyn
    return '!fff!'


def _duration_to_abc(duration: Fraction, default_length: Fraction) -> str:
    """Convert a note duration to an ABC duration suffix.

    Duration is expressed as a multiple of default_length.
    """
    ratio = duration / default_length

    if ratio == Fraction(1):
        return ''  # bare note = 1x default

    # Express as fraction
    num = ratio.numerator
    den = ratio.denominator

    if den == 1:
        return str(num)  # e.g., '2', '4', '8'
    elif num == 1:
        return f'/{den}'  # e.g., '/2', '/4'
    else:
        return f'{num}/{den}'  # e.g., '3/2'


def _note_to_abc(note: Note) -> str:
    """Convert a Note object to ABC note notation (pitch + octave, no duration)."""
    if note.is_rest:
        return 'z'

    # Accidental prefix
    if note.accidental == 1:
        acc = '^'
    elif note.accidental == -1:
        acc = '_'
    elif note.accidental == 2:
        acc = '^^'
    elif note.accidental == -2:
        acc = '__'
    else:
        acc = ''

    # Pitch letter and octave
    # SamBasic O4 C = ABC C (middle C, uppercase)
    # SamBasic O5 C = ABC c (lowercase)
    # SamBasic O3 C = ABC C, (comma lowers)
    # SamBasic O6 C = ABC c' (apostrophe raises)
    pitch = note.pitch
    octave = note.octave

    if octave <= 4:
        letter = pitch.upper()
        octave_suffix = ',' * (4 - octave)
    else:
        letter = pitch.lower()
        octave_suffix = "'" * (octave - 5)

    return f'{acc}{letter}{octave_suffix}'


def generate_abc(blocks: List[MusicBlock], source_name: str) -> str:
    """Generate ABC notation from parsed MusicBlock list."""
    # Determine title from filename
    title = os.path.splitext(os.path.basename(source_name))[0]

    # Collect all voices across blocks
    # Each block's voice index maps to a global voice
    max_voices = max(len(b.voices) for b in blocks) if blocks else 1
    tempo = blocks[0].tempo if blocks else 120

    # Parse all music strings
    parsed_voices: Dict[int, List] = {}
    for block in blocks:
        for vi, music_str in enumerate(block.voices):
            notes = parse_play_string(music_str)
            if vi not in parsed_voices:
                parsed_voices[vi] = []
            parsed_voices[vi].extend(notes)

    # Use first tempo marker found, or block tempo
    first_tempo = tempo
    for vi in sorted(parsed_voices.keys()):
        for item in parsed_voices[vi]:
            if isinstance(item, tuple) and item[0] == 'tempo':
                first_tempo = item[1]
                break
        else:
            continue
        break

    # ABC default length: 1/8
    abc_default = Fraction(1, 8)
    measure_duration = Fraction(1, 1)  # 4/4 time = 1 whole note

    # Build header
    header_lines = [
        'X:1',
        f'T:{title}',
        'M:4/4',
        'L:1/8',
        f'Q:1/4={first_tempo}',
        'K:C',
    ]

    voice_lines: Dict[int, List[str]] = {}

    for vi in sorted(parsed_voices.keys()):
        events = parsed_voices[vi]
        tokens = []
        measure_pos = Fraction(0)
        last_dynamic = None
        first_tempo_skipped = False

        for item in events:
            if isinstance(item, tuple) and item[0] == 'tempo':
                t = item[1]
                # Skip the first tempo (already in header Q:)
                if not first_tempo_skipped and t == first_tempo:
                    first_tempo_skipped = True
                    continue
                first_tempo_skipped = True
                tokens.append(f'[Q:1/4={t}]')
                continue

            if not isinstance(item, Note):
                continue

            note = item

            # Dynamics (only emit on change)
            if not note.is_rest:
                dyn = _velocity_to_dynamic(note.velocity)
                if dyn and dyn != last_dynamic:
                    tokens.append(dyn)
                    last_dynamic = dyn

            # Note token
            abc_note = _note_to_abc(note)
            abc_dur = _duration_to_abc(note.duration, abc_default)
            tokens.append(f'{abc_note}{abc_dur}')

            # Track measure position and insert bar lines
            measure_pos += note.duration
            while measure_pos >= measure_duration:
                measure_pos -= measure_duration
                tokens.append('|')

        # Remove trailing bar line if present
        while tokens and tokens[-1] == '|':
            tokens.pop()

        # Add final bar
        tokens.append('|]')

        voice_lines[vi] = tokens

    # Build output
    out_lines = list(header_lines)

    if len(voice_lines) == 1:
        vi = list(voice_lines.keys())[0]
        # Group tokens into lines of ~60 chars
        out_lines.extend(_format_abc_body(voice_lines[vi]))
    else:
        for vi in sorted(voice_lines.keys()):
            out_lines.append(f'V:{vi + 1}')
            out_lines.extend(_format_abc_body(voice_lines[vi]))

    return '\n'.join(out_lines) + '\n'


def _format_abc_body(tokens: List[str]) -> List[str]:
    """Format ABC tokens into lines, breaking at bar lines."""
    lines = []
    current_line = ''
    bars_on_line = 0

    for token in tokens:
        if token == '|':
            current_line += ' |'
            bars_on_line += 1
            # Break line every 4 bars
            if bars_on_line >= 4:
                lines.append(current_line)
                current_line = ''
                bars_on_line = 0
        elif token == '|]':
            current_line += ' |]'
            lines.append(current_line)
            current_line = ''
            bars_on_line = 0
        else:
            if current_line and not current_line.endswith('|'):
                current_line += ' ' + token
            elif current_line:
                current_line += ' ' + token
            else:
                current_line = token
    if current_line:
        lines.append(current_line)

    return lines


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Bidirectional ABC <-> SamBasic converter. "
                    "Direction auto-detected from input file extension."
    )
    parser.add_argument("-i", "--input", required=True,
                        help="Input file (.abc for ABC->SAM, .sam for SAM->ABC)")
    parser.add_argument("-o", "--output",
                        help="Output file (default: stdout)")
    parser.add_argument(
        "--wave", default=None, choices=['SQUARE', 'TRIANGLE', 'SINE', 'SAWTOOTH'],
        help="Force waveform for all voices (ABC->SAM only)"
    )
    parser.add_argument(
        "--no-chords", action="store_true",
        help="Play top note of chords only (ABC->SAM only)"
    )
    parser.add_argument(
        "--transpose", type=int, default=0,
        help="Transpose by N semitones (ABC->SAM only)"
    )
    parser.add_argument(
        "--section-beats", type=int, default=None,
        help="Split into sections of N beats (ABC->SAM only)"
    )
    parser.add_argument(
        "--tune", type=int, default=1,
        help="Select tune N if file has multiple tunes (ABC->SAM only)"
    )
    parser.add_argument(
        "--info", action="store_true",
        help="Print ABC metadata and exit (ABC->SAM only)"
    )
    args = parser.parse_args()

    # Auto-detect direction from input extension
    ext = os.path.splitext(args.input)[1].lower()

    if ext == '.sam':
        # SAM -> ABC direction
        abc_only_flags = []
        if args.wave:
            abc_only_flags.append('--wave')
        if args.no_chords:
            abc_only_flags.append('--no-chords')
        if args.transpose:
            abc_only_flags.append('--transpose')
        if args.section_beats:
            abc_only_flags.append('--section-beats')
        if args.tune != 1:
            abc_only_flags.append('--tune')
        if args.info:
            abc_only_flags.append('--info')
        if abc_only_flags:
            print(f"Note: {', '.join(abc_only_flags)} ignored for SAM->ABC conversion",
                  file=sys.stderr)

        with open(args.input, 'r') as f:
            text = f.read()

        blocks = parse_sam_file(text)
        if not blocks:
            print("No PLAY/PLAYPOLY statements found in SAM file.", file=sys.stderr)
            sys.exit(1)

        output = generate_abc(blocks, args.input)

        if args.output:
            with open(args.output, 'w') as f:
                f.write(output)
            print(f"Wrote {args.output}", file=sys.stderr)
        else:
            print(output, end='')

    elif ext == '.abc':
        # ABC -> SAM direction (existing behavior)
        with open(args.input, 'r') as f:
            text = f.read()

        tunes = parse_abc_file(text)

        if not tunes:
            print("No tunes found in ABC file.", file=sys.stderr)
            sys.exit(1)

        if args.info:
            print_info(args.input, tunes)
            sys.exit(0)

        if args.tune < 1 or args.tune > len(tunes):
            print(f"Tune {args.tune} not found (file has {len(tunes)} tune(s)).",
                  file=sys.stderr)
            sys.exit(1)

        tune = tunes[args.tune - 1]
        voice_notes, tempo = process_tune(tune, no_chords=args.no_chords,
                                          transpose=args.transpose)

        if not voice_notes or all(not v for v in voice_notes.values()):
            print("No notes found in ABC tune.", file=sys.stderr)
            sys.exit(1)

        source_name = os.path.basename(args.input)
        title = tune['headers'].get('T', '')

        output = generate_output(
            voice_notes, tempo, args.wave, args.section_beats,
            source_name, title=title,
        )

        if args.output:
            with open(args.output, 'w') as f:
                f.write(output)
                f.write('\n')
            print(f"Wrote {args.output}", file=sys.stderr)
        else:
            print(output)

    else:
        print(f"Unknown input file extension '{ext}'. Use .abc or .sam.",
              file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
