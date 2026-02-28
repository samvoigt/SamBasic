# SamBasic

A BASIC/QBASIC-inspired programming language with a retro CRT monitor interface. Write and run programs directly in your browser — no server required, just open `index.html`.

The output display emulates a classic **Voigtlectrics 9000** monitor, complete with scanlines, phosphor glow, and a beige bezel.

## Getting Started

Open `index.html` in any modern browser. Type code in the editor on the left, press **Run**, and watch the output on the CRT screen.

- **Run** — Execute the program
- **Pause / Resume** — Pause or resume execution
- **Step** — Execute one statement at a time
- **Stop** — Halt the program
- **Save / Load** — Save or load `.sam` program files

## Language Quick Reference

### Variables

Variables end with a sigil to indicate their type:

| Suffix | Type      | Example            |
|--------|-----------|---------------------|
| `#`    | Number    | `score# = 100`     |
| `$`    | String    | `name$ = "Sam"`    |
| `@`    | Array     | `data@ = [1,2,3]`  |
| `&`    | Structure | `pt& = {.x# = 0}` |
| `!`    | Boolean   | `done! = YES`      |

Keywords must be **UPPERCASE**.

### String Escape Sequences

Strings support backslash escape sequences:

| Escape | Character       |
|--------|-----------------|
| `\"`   | Literal `"`     |
| `\\`   | Literal `\`     |
| `\n`   | Newline         |
| `\t`   | Tab             |

```
PRINT "She said \"hello\""
PRINT "line1\nline2"
PRINT "col1\tcol2"
```

### Operators

**Arithmetic:** `+`, `-`, `*`, `/`, `%` (modulo), `^` (exponent)

**Comparison:** `=`, `<>` (not equal), `<`, `>`, `<=`, `>=`

**Logical:** `AND`, `OR`, `NOT`

String concatenation uses `+`.

### Output

```
PRINT "hello"                             ' Print with newline
PRINT TEXT "alert!", COLOR RED&           ' Print with color (named params)
PRINT "alert!", COLOR RED&               ' Positional text + named color
PRINTAT 1, 1, "top-left"                 ' Print at screen position (1-indexed)
PRINTAT ROW 5, COL 10, TEXT "hi", COLOR GREEN&
CLEARSCREEN                               ' Clear the screen
```

### Input

```
name$ = INPUT "What is your name? "  ' Prompt and store result
x# = INPUT                          ' Input with no prompt
k$ = GETKEY                          ' Read currently pressed key (non-blocking)
```

### String Functions

```
x# = LENGTH "hello"                           ' 5 (VALUE param)
n# = LENGTH items@                             ' Array length
s$ = SUBSTRING "hello world", 2, 4            ' "ello"
s$ = SUBSTRING TEXT "abcdef", START 3, LENGTH 2  ' "cd"
s$ = UPPERCASE "hello"                         ' "HELLO"
s$ = LOWERCASE "HELLO"                         ' "hello"
found! = CONTAINS "hello world", "world"       ' YES (1)
```

All string indices are **1-based**. `SUBSTRING` throws an error if the index is out of range. Use `SUBSTRING text, index, 1` to get a single character. `LENGTH` also works on arrays, returning the number of elements.

### Math Functions

```
x# = ABS -5                  ' 5
x# = SQRT 16                 ' 4
x# = ROUND 3.7               ' 4
x# = FLOOR 3.9               ' 3
x# = CEIL 3.1                ' 4
x# = MIN 3, 7                ' 3
x# = MAX 3, 7                ' 7
x# = SIN 3.14159             ' ~0 (radians)
x# = COS 0                   ' 1
x# = LOG 2.71828             ' ~1 (natural log)
x# = SIGN -42                ' -1
```

`SQRT` errors if the value is negative. `LOG` errors if the value is not positive. `SIN` and `COS` use radians. `SIGN` returns -1, 0, or 1.

### Control Flow

**If / Else If / Else:**
```
IF x# > 10 THEN
  PRINT "big"
ELSE IF x# > 5 THEN
  PRINT "medium"
ELSE
  PRINT "small"
ENDIF
```

**For Loop:**
```
FOR i# GOESFROM 1 TO 10 WITHSTEP 2
  PRINT i#
ENDFOR
```
The loop variable and `WITHSTEP` are optional (step defaults to 1).

**While Loop:**
```
WHILE x# < 100
  x# = x# * 2
ENDWHILE
```

**Labels and Goto:**
```
LABEL start
PRINT "looping"
GOTO start
```

### Functions

Define reusable functions with `FUNCTION`/`ENDFUNCTION`. Function names can have a return type suffix:

```
FUNCTION add# X a# Y b#
  RETURN a# + b#
ENDFUNCTION

result# = add# 3, 4
PRINT result#
```

**Return types:** Append a type suffix to the function name for typed returns (`name#` returns number, `name$` returns string, etc.). Omit the suffix for void functions.

**Parameters:** Each parameter is a typed variable, optionally preceded by a label (uppercase identifier). Labels enable named arguments at call sites. If omitted, arguments are positional only:
```
' With labels:
FUNCTION add# X a# Y b#
result# = add# Y 10, X 5     ' Named arguments (any order)
result# = add# 5, 10         ' Positional arguments
result# = add# X 5, 10       ' Mixed: X=5, Y=10

' Without labels (positional only):
FUNCTION mul# a# b#
x# = mul# 6, 7
```

**Void functions** (no return type suffix) are called as statements:
```
FUNCTION greet name$
  PRINT "Hello, " + name$
ENDFUNCTION
greet "World"
```

**Optional parameters** — use `OPTIONAL` before parameters that have defaults (0 for numbers, "" for strings, empty for arrays/structs):
```
FUNCTION repeat TEXT msg$ OPTIONAL TIMES count#
  IF count# = 0 THEN
    count# = 1
  ENDIF
  FOR i# GOESFROM 1 TO count#
    PRINT msg$
  ENDFOR
ENDFUNCTION
repeat "hi", 3
repeat "once"
```

**Function calls in expressions** — wrap a function call in parentheses to use its return value inside an expression:
```
PRINT (add# 3, 4)
x# = (add# 1, 2) + (mul# 3, 4)
IF (add# 1, 1) = 2 THEN
  PRINT "math works"
ENDIF
```

**Recursion** is supported (max depth 256):
```
FUNCTION fact# n#
  IF n# <= 1 THEN
    RETURN 1
  ENDIF
  prev# = fact# n# - 1
  RETURN n# * prev#
ENDFUNCTION
x# = fact# 5
PRINT x#          ' 120
```

**Scoping:** Functions have their own local variables. Global variables are not visible inside a function. Built-in color constants (e.g., `RED&`) are available in every scope. Labels inside functions are local and don't conflict with global labels. Function names shadow variable names — if you define `FUNCTION add#`, then `add#` always refers to the function.

### Arrays

```
items@ = SIZE 10                  ' Allocate array of size 10 (filled with 0)
items@ = [1, 2, 3]               ' Array literal
grid@ = SIZE 5, 5                ' 2D array (5x5)
grid@ = [1,2,3][4,5,6][7,8,9]   ' 2D array literal

items@[1] = 42                   ' Set element (1-indexed)
PRINT items@[1]                  ' Get element
PRINT grid@[2][3]                ' 2D access
```

Arrays are untyped — they can hold both numbers and strings.

### Structures

```
STRUCT person&
  .height# = 72
  .name$ = "Sam"
ENDSTRUCT

PRINT person&.name$              ' Access a member
PRINT person&.height#

person&.name$ = "Alex"           ' Assign to a member
```

The one-liner form also works: `person& = {.height# = 72, .name$ = "Sam"}`

Members are prefixed with `.` and must include a type suffix (`#`, `$`, `@`, `&`, or `!`).

### Color

```
SETCOLOR GREEN&                   ' Set global text color
SETCOLOR COLOR myColor&           ' Named parameter form
```

Colors are structs with `.red#`, `.green#`, `.blue#` members (0–255). The 16 EGA colors are built-in:

`BLACK&`, `BLUE&`, `GREEN&`, `CYAN&`, `RED&`, `MAGENTA&`, `BROWN&`, `LIGHTGRAY&`, `DARKGRAY&`, `LIGHTBLUE&`, `LIGHTGREEN&`, `LIGHTCYAN&`, `LIGHTRED&`, `LIGHTMAGENTA&`, `YELLOW&`, `WHITE&`

You can define custom colors:
```
myColor& = {.red# = 255, .green# = 128, .blue# = 0}
SETCOLOR myColor&
```

### Sound

```
BEEP                                       ' Short beep
PLAY "O4 L4 C D E F G A B > C"            ' Play notes (QBASIC PLAY syntax)
PLAY NOTES "C D E", WAVE SINE             ' Wave types: SINE, SQUARE, SAWTOOTH, TRIANGLE
PLAY "C D E", BACKGROUND YES              ' Play in background (non-blocking)
PLAY "C D E", BACKGROUND YES, REPEAT YES  ' Loop in background
```

**Polyphonic playback** — play multiple voices simultaneously with `PLAYPOLY`. Each voice is a bracketed group with its own note string and optional `WAVE`:
```
PLAYPOLY ["O4 L4 C E G" WAVE SINE] ["O3 L2 C G" WAVE TRIANGLE]
PLAYPOLY ["C E G"] ["C G"], BACKGROUND YES, REPEAT YES
```

**Playback control** — control background audio:
```
PAUSEPLAY                         ' Pause background audio
RESUMEPLAY                        ' Resume paused audio
STOPPLAY                          ' Stop background audio
```

**PLAY string syntax:** Notes `A`-`G`, sharps `#`/`+`, flats `-`, octave `O4`, length `L8`, tempo `T120`, rest `R4`, percussion `P4` (white noise hit), dotted notes `.`, octave up/down `>`/`<`.

### Data

```
DATA 10, 20, 30, "hello"
x# = READ                        ' Reads 10 into x#
y# = READ                        ' Reads 20 into y#
msg$ = READ                      ' Reads "hello" into msg$
```

### Other

```
x# = RANDOM 100                  ' Random int between 0 and 100
x# = RANDOM MAX 50               ' Named parameter form
SLEEP 2                           ' Pause execution for 2 seconds
SLEEP 0.5                         ' Pause for 500ms (fractional seconds)
```

### Comments

```
' This is a comment
```

### Screen

The screen is 80 columns by 25 rows. Printing past line 25 scrolls the screen up.
