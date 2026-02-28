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
| `?`    | Boolean   | `done? = YES`      |

Keywords must be **UPPERCASE**.

**Uninitialized variable warnings:** If you use a variable before assigning it a value, SamBasic prints a yellow warning on the CRT screen (e.g., `Warning: variable 'x#' used before assignment (defaulting to 0)`). Each variable only triggers the warning once. Variables default to `0` for numbers, `""` for strings, `NO` for booleans, `[]` for arrays, and `{}` for structs.

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
name$ = INPUT$ "What is your name? "  ' Prompt and store result
x# = INPUT$                           ' Input with no prompt
k$ = GETKEY$                           ' Read currently pressed key (non-blocking)
```

### String Functions

```
x# = LENGTH# "hello"                            ' 5 (VALUE param)
n# = LENGTH# items@                              ' Array length
s$ = SUBSTRING$ "hello world", 2, 4             ' "ello"
s$ = SUBSTRING$ TEXT "abcdef", START 3, LENGTH 2 ' "cd"
s$ = UPPERCASE$ "hello"                          ' "HELLO"
s$ = LOWERCASE$ "HELLO"                          ' "hello"
found? = CONTAINS? "hello world", "world"        ' YES (1)
```

All string indices are **1-based**. `SUBSTRING$` throws an error if the index is out of range. Use `SUBSTRING$ text, index, 1` to get a single character. `LENGTH#` also works on arrays, returning the number of elements.

### Conversion Functions

```
x# = TONUMBER# "42.5"                          ' 42.5
x# = TONUMBER# "hello"                         ' ERROR: cannot convert
s$ = TOSTRING$ 42                              ' "42"
s$ = TOSTRING$ 3.14                            ' "3.14"
```

`TONUMBER#` converts a string to a number. It throws an error if the value cannot be parsed. `TOSTRING$` converts any value to its string representation.

### String Search

```
i# = INDEXOF# "hello world", "world"           ' 7
i# = INDEXOF# "hello", "xyz"                   ' 0 (not found)
i# = INDEXOF# TEXT "abcabc", FIND "b"          ' 2
```

`INDEXOF#` returns the **1-based** position of the first occurrence of `FIND` within `TEXT`, or `0` if not found.

### Math Functions

```
x# = ABS# -5                  ' 5
x# = SQRT# 16                 ' 4
x# = ROUND# 3.7               ' 4
x# = FLOOR# 3.9               ' 3
x# = CEIL# 3.1                ' 4
x# = MIN# 3, 7                ' 3
x# = MAX# 3, 7                ' 7
x# = SIN# 3.14159             ' ~0 (radians)
x# = COS# 0                   ' 1
x# = LOG# 2.71828             ' ~1 (natural log)
x# = SIGN# -42                ' -1
```

`SQRT#` errors if the value is negative. `LOG#` errors if the value is not positive. `SIN#` and `COS#` use radians. `SIGN#` returns -1, 0, or 1.

### Control Flow

**If / Else If / Else:**
```
IF x# > 10 THEN
  PRINT "big"
ELSE IF x# > 5 THEN
  PRINT "medium"
ELSE
  PRINT "small"
END IF
```

**For Loop:**
```
FOR i# FROM 1 TO 10 STEP 2
  PRINT i#
END FOR
```
The loop variable and `STEP` are optional (step defaults to 1).

**While Loop:**
```
WHILE x# < 100
  x# = x# * 2
END WHILE
```

**Labels and Goto:**
```
LABEL start
PRINT "looping"
GOTO start
```

### Functions

Define reusable functions with `FUNCTION` / `END FUNCTION`. Function names can have a return type suffix:

```
FUNCTION add# X a# Y b#
  RETURN a# + b#
END FUNCTION

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
END FUNCTION
greet "World"
```

**Optional parameters** — use `OPTIONAL` before parameters that have defaults (0 for numbers, "" for strings, empty for arrays/structs):
```
FUNCTION repeat TEXT msg$ OPTIONAL TIMES count#
  IF count# = 0 THEN
    count# = 1
  END IF
  FOR i# FROM 1 TO count#
    PRINT msg$
  END FOR
END FUNCTION
repeat "hi", 3
repeat "once"
```

**Function calls in expressions** — wrap a function call in parentheses to use its return value inside an expression:
```
PRINT (add# 3, 4)
x# = (add# 1, 2) + (mul# 3, 4)
IF (add# 1, 1) = 2 THEN
  PRINT "math works"
END IF
```

**Recursion** is supported (max depth 256):
```
FUNCTION fact# n#
  IF n# <= 1 THEN
    RETURN 1
  END IF
  prev# = fact# n# - 1
  RETURN n# * prev#
END FUNCTION
x# = fact# 5
PRINT x#          ' 120
```

**Scoping:** Functions have their own local variables. Global variables are not visible inside a function unless explicitly declared with `GLOBAL`. Built-in color constants (e.g., `RED&`) are available in every scope. Labels inside functions are local and don't conflict with global labels. Function names shadow variable names — if you define `FUNCTION add#`, then `add#` always refers to the function.

**Global variables** — use `GLOBAL` at the top of a function body to read and write specific global variables:
```
score# = 0
name$ = "Player 1"
items@ = [10, 20, 30]

FUNCTION addScore points#
  GLOBAL score#, name$, items@
  score# = score# + points#
  name$ = UPPERCASE$ name$
  items@[1] = 99
END FUNCTION

addScore 10
PRINT score#        ' 10
PRINT name$         ' PLAYER 1
PRINT items@[1]     ' 99
```

Rules:
- `GLOBAL` must appear before other statements in the function body
- Listed variables must already exist in the global scope when the function is called
- A `GLOBAL` variable cannot share a name with a parameter

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
END STRUCT

PRINT person&.name$              ' Access a member
PRINT person&.height#

person&.name$ = "Alex"           ' Assign to a member
```

The one-liner form also works: `person& = {.height# = 72, .name$ = "Sam"}`

Members are prefixed with `.` and must include a type suffix (`#`, `$`, `@`, `&`, or `?`).

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

### Other

```
x# = RANDOM# 100                  ' Random int between 0 and 100
x# = RANDOM# MAX 50               ' Named parameter form
SLEEP 2                            ' Pause execution for 2 seconds
SLEEP 0.5                          ' Pause for 500ms (fractional seconds)
```

### File I/O

Files are stored in `localStorage` and persist across sessions.

**Open a file:**
```
f# = OPEN# FILE "data.txt" MODE READ       ' Open for reading (file must exist)
f# = OPEN# FILE "out.txt" MODE WRITE       ' Open for writing (truncates/creates)
f# = OPEN# FILE "log.txt" MODE APPEND      ' Open for appending (creates or preserves)
f# = OPEN# FILE "data.txt"                 ' MODE defaults to READ
```

**Read from a file:**
```
line$ = READFILELINE$ FILE f#               ' Read one line (without trailing newline)
ch$ = READFILECHARACTER$ FILE f#            ' Read one character
eof? = ENDOFFILE? FILE f#                   ' Check for end of file (YES/NO)
```

**Write to a file:**
```
WRITEFILELINE FILE f# LINE "Hello"          ' Write text + newline
WRITEFILECHARACTER FILE f# CHARACTER "X"    ' Write a single character
```

**Close a file:**
```
CLOSE f#                                    ' Saves write/append files to localStorage
```

Files are automatically closed (and saved) when the program ends or is stopped.

**Complete example — copy a file:**
```
out# = OPEN# FILE "copy.txt" MODE WRITE
in# = OPEN# FILE "source.txt"
WHILE NOT (ENDOFFILE? in#)
  line$ = READFILELINE$ FILE in#
  WRITEFILELINE FILE out# LINE line$
END WHILE
CLOSE in#
CLOSE out#
```

### Comments

```
' This is a comment
```

### Screen

The screen is 80 columns by 25 rows. Printing past line 25 scrolls the screen up.
