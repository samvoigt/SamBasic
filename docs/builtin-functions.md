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
| `RUNNINGTIME#` | number | (none) |
| `OPEN#` | number | FILE name$, MODE keyword |
| `READFILELINE$` | string | FILE handle# |
| `READFILECHARACTER$` | string | FILE handle# |
| `ENDOFFILE?` | boolean | handle# |
| `FILEEXISTS?` | boolean | name$ |
| `CREATESPRITE#` | number | data2D@ |
