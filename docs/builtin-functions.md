# SamBasic Built-in Functions

All built-in functions are **typed keywords** — the function name includes its return-type sigil. They are called as expressions, not statements.

## String Functions

### LENGTH#

Returns the length of a string or array.

```
n# = LENGTH# "Hello"         ' 5
n# = LENGTH# items@          ' number of elements
```

### SUBSTRING$

Extract part of a string. **1-indexed**, takes `(text, start, length)` — not `(text, start, end)`.

```
s$ = SUBSTRING$ "Hello World", 7, 5    ' "World"
s$ = SUBSTRING$ name$, 1, 3            ' first 3 characters
```

### INDEXOF#

Find position of substring. Returns 1-indexed position, or `0` if not found.

```
pos# = INDEXOF# "Hello World", "World"   ' 7
pos# = INDEXOF# "abc", "z"               ' 0
```

### CONTAINS?

Check if a string contains a substring. Returns `1` (YES) or `0` (NO).

```
IF CONTAINS? name$, "@" THEN
  PRINT "Has an @ sign"
END IF
```

### UPPERCASE$ / LOWERCASE$

```
s$ = UPPERCASE$ "hello"    ' "HELLO"
s$ = LOWERCASE$ "HELLO"    ' "hello"
```

### TRIM$

Remove whitespace. Optional direction: `LEFT` or `RIGHT`.

```
s$ = TRIM$ "  hello  "           ' "hello"
s$ = TRIM$ LEFT "  hello  "     ' "hello  "
s$ = TRIM$ RIGHT "  hello  "    ' "  hello"
```

### REPEAT$

```
edge$ = REPEAT$ "═", 78          ' a 78-character rule
blank$ = REPEAT$ " ", 80         ' a full-width blank
```

Repeats `TEXT` `COUNT` times. A `COUNT` of 0 gives `""`. Negative counts are an error, as is a
result over 100,000 characters.

Replaces the usual character-at-a-time loop:

```
edge$ = ""
FOR i# FROM 1 TO 78
  edge$ = edge$ + "═"
END FOR
```

## Math Functions

### ABS#

```
n# = ABS# -5       ' 5
```

### SQRT#

Errors on negative input.

```
n# = SQRT# 16      ' 4
```

### ROUND# / FLOOR# / CEIL#

```
n# = ROUND# 3.7    ' 4
n# = FLOOR# 3.7    ' 3
n# = CEIL# 3.2     ' 4
```

### MIN# / MAX#

Takes exactly two arguments.

```
n# = MIN# a#, b#
n# = MAX# a#, b#
```

### SIN# / COS#

Input in **radians**.

```
y# = SIN# 3.14159         ' ~0
x# = COS# 0               ' 1
```

### LOG#

Natural logarithm. Errors on input <= 0.

```
n# = LOG# 2.71828         ' ~1
```

### SIGN#

Returns -1, 0, or 1.

```
n# = SIGN# -42     ' -1
n# = SIGN# 0       ' 0
n# = SIGN# 7       ' 1
```

## Random

### RANDOM#

Random integer from 0 to max (inclusive).

```
roll# = RANDOM# 5          ' 0, 1, 2, 3, 4, or 5
coinFlip# = RANDOM# 1      ' 0 or 1
```

## Type Conversion

### TONUMBER#

Convert string to number. Errors if string is not numeric.

```
n# = TONUMBER# "42"        ' 42
n# = TONUMBER# "3.14"      ' 3.14
```

### TOSTRING$

Convert any value to its string representation.

```
s$ = TOSTRING$ 42           ' "42"
s$ = TOSTRING$ score#       ' number as text
```

Useful for concatenation: `"Score: " + TOSTRING$ score#`

(Note: `PRINT` auto-coerces, but explicit conversion is needed for string operations like `SUBSTRING$`.)

## Input

### INPUT$

Prompt user for text input. Blocks until Enter is pressed. Shows a blinking cursor.

```
name$ = INPUT$                        ' no prompt text
name$ = INPUT$ "Enter your name: "    ' with prompt
age$ = INPUT$ "Age: "
age# = TONUMBER# age$                ' convert to number
```

The prompt text is optional. Backspace is supported during input.

### GETKEY$

Returns the currently pressed key, or `""` if no key is held. **Non-blocking.**

```
key$ = GETKEY$
IF key$ = "ArrowUp" THEN
  y# = y# - 1
END IF
```

Key names match JavaScript `event.key`:
- Arrow keys: `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"`
- Letters: `"a"`, `"b"`, `"A"` (with shift)
- Space: `" "`
- Enter: `"Enter"`
- Escape: `"Escape"`

### WAITKEY& / GETKEYPRESS&

`GETKEY$` reports the key that is *held right now*. That suits games, but it drops keystrokes
typed faster than the program's loop, never repeats a held key, and reports modifiers through a
separate `GETALLKEYS@` call that can be sampled at a different instant.

`WAITKEY&` and `GETKEYPRESS&` read from a lossless queue of key *presses* instead, and return a
struct so the key and its modifiers arrive together.

```
k& = WAITKEY&                     ' blocks until a key is pressed
k& = WAITKEY& TIMEOUT 0.5         ' blocks up to 0.5 seconds
k& = GETKEYPRESS&                 ' non-blocking: oldest queued key, or empty
```

| Member | Type | Meaning |
|--------|------|---------|
| `.key$` | string | Key name, same as `GETKEY$` (`"a"`, `"ArrowUp"`, `"Enter"`). `""` if nothing arrived |
| `.shift?` | boolean | Modifier state at the moment the key went down |
| `.ctrl?` | boolean | |
| `.alt?` | boolean | |

```
k& = WAITKEY&
IF k&.key$ = "ArrowRight" AND k&.shift? THEN
  PRINT "select right"
END IF
```

Because every keydown is queued, holding a key repeats it, and nothing is lost while your
program is busy drawing. `WAITKEY&` with no `TIMEOUT` blocks until a key arrives, so an
interactive program needs no `SLEEP` loop:

```
LOOP
  k& = WAITKEY& TIMEOUT 0.3       ' wakes up to blink a cursor
END LOOP WHEN k&.key$ = "Escape"
```

The queue holds 64 presses; beyond that further keys are ignored until the program reads some.
It is cleared when a program starts. `GETKEY$` and `GETALLKEYS@` are unaffected — use them when
you want to know what is being held, not what was typed.

## Time

### RUNNINGTIME#

Milliseconds since the program started running.

```
start# = RUNNINGTIME#
' ... do work ...
elapsed# = RUNNINGTIME# - start#
PRINT "Took " + TOSTRING$ elapsed# + " ms"
```

## File I/O

Files are stored in browser localStorage under keys like `sambasic_file:filename`. They persist across sessions but are browser-local.

### OPEN#

```
f# = OPEN# FILE "data.txt" MODE READ
f# = OPEN# FILE "output.txt" MODE WRITE
f# = OPEN# FILE "log.txt" MODE APPEND
```

Returns a numeric file handle. Mode is a keyword: `READ`, `WRITE`, or `APPEND`.

### READFILELINE$ / READFILECHARACTER$

```
line$ = READFILELINE$ FILE f#
ch$ = READFILECHARACTER$ FILE f#
```

Read one line (up to newline) or one character from the file.

### ENDOFFILE?

```
WHILE NOT ENDOFFILE? f#
  line$ = READFILELINE$ FILE f#
  PRINT line$
END WHILE
```

Returns `1` at end of file, `0` otherwise.

### WRITEFILELINE / WRITEFILECHARACTER

```
WRITEFILELINE FILE f#, LINE "Hello World"
WRITEFILECHARACTER FILE f#, CHARACTER "X"
```

These are **statements** (not expressions). `WRITEFILELINE` appends a newline after the text.

### CLOSE

```
CLOSE f#
```

Closes the file handle. For WRITE/APPEND modes, this saves the content to localStorage.

### LISTFILES@

```
names@ = LISTFILES@
FOR i# FROM 1 TO LENGTH# names@
  PRINT names@[i#]
END FOR
```

Every stored file name, sorted, with the `sambasic_file:` prefix stripped. Returns an empty
array when nothing is stored — that is a normal state, not an error.

These are the same files the IDE's file panel shows, so a program can list, open and write
files that the IDE then loads and runs.

### FILEEXISTS?

```
IF FILEEXISTS? "save.txt" THEN
  PRINT "Save file found"
END IF
```

Returns `1` if the file exists in localStorage, `0` otherwise.

## Summary Table

| Function | Returns | Arguments |
|----------|---------|-----------|
| `LENGTH#` | number | string or array |
| `SUBSTRING$` | string | text$, start#, length# |
| `INDEXOF#` | number | text$, find$ |
| `CONTAINS?` | boolean | text$, find$ |
| `UPPERCASE$` | string | text$ |
| `LOWERCASE$` | string | text$ |
| `TRIM$` | string | [LEFT/RIGHT] text$ |
| `ABS#` | number | value# |
| `SQRT#` | number | value# |
| `ROUND#` | number | value# |
| `FLOOR#` | number | value# |
| `CEIL#` | number | value# |
| `MIN#` | number | a#, b# |
| `MAX#` | number | a#, b# |
| `SIN#` | number | radians# |
| `COS#` | number | radians# |
| `LOG#` | number | value# |
| `SIGN#` | number | value# |
| `RANDOM#` | number | max# |
| `TONUMBER#` | number | text$ |
| `TOSTRING$` | string | value |
| `INPUT$` | string | [prompt$] |
| `GETKEY$` | string | (none) |
| `WAITKEY&` | struct | [TIMEOUT seconds#] |
| `GETKEYPRESS&` | struct | (none) |
| `RUNNINGTIME#` | number | (none) |
| `OPEN#` | number | FILE name$, MODE keyword |
| `READFILELINE$` | string | FILE handle# |
| `READFILECHARACTER$` | string | FILE handle# |
| `ENDOFFILE?` | boolean | handle# |
| `FILEEXISTS?` | boolean | name$ |
| `LISTFILES@` | array | (none) |
| `REPEAT$` | string | text$, count# |
| `CREATESPRITE#` | number | data2D@ |
