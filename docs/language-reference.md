# SamBasic Language Reference

## General Rules

- **Keywords must be UPPERCASE.** `print` will error; use `PRINT`.
- One statement per line. No semicolons or statement separators.
- Comments start with `'` (single quote) — everything after is ignored.
- Strings use double quotes: `"Hello"`. Escape sequences: `\"`, `\\`, `\n`, `\t`.
- Boolean values: `YES` (truthy/1) and `NO` (falsy/0). Any non-zero number is truthy.

## Variable Types

Every variable name ends with a **type sigil**:

| Sigil | Type | Example | Zero value |
|-------|------|---------|------------|
| `#` | Number (float) | `score#` | `0` |
| `$` | String | `name$` | `""` |
| `@` | Array | `items@` | `[]` |
| `&` | Struct | `player&` | `{}` |
| `?` | Boolean | `alive?` | `0` (NO) |

`x#`, `x$`, `x@` are **three different variables**. The sigil is part of the name.

Variables are implicitly declared on first use (initialized to their zero value).

## Operators

**Arithmetic** (highest to lowest precedence):
- `^` — power
- `*`, `/`, `%` — multiply, divide, modulo
- `+`, `-` — add/subtract (unary `-` supported)
- String concatenation: `"Hello " + name$` (auto-coerces numbers)

**Comparison** (return 1 or 0):
`=`, `<>` (not equal), `<`, `>`, `<=`, `>=`

**Logical:**
`AND`, `OR`, `NOT` — work on truthy/falsy values

**Precedence (low to high):** OR → AND → NOT → comparisons → add/sub → mul/div/mod → power → unary minus

## Control Flow

### IF / THEN / ELSE / END IF

```
IF condition THEN
  ...
ELSE IF other_condition THEN
  ...
ELSE
  ...
END IF
```

Single-branch form (no ELSE) still needs `END IF`.

### FOR / END FOR

```
FOR i# FROM 1 TO 10
  PRINT i#
END FOR

FOR i# FROM 10 TO 1 STEP -1
  PRINT i#
END FOR
```

- The loop variable (`i#`) is optional but recommended: `FOR # FROM 1 TO 5` works (anonymous loop).
- `STEP` is optional; defaults to 1.
- `BREAK` exits the loop. `CONTINUE` skips to next iteration.

### WHILE / END WHILE

```
WHILE condition
  ...
END WHILE
```

`BREAK` and `CONTINUE` work here too.

### LABEL / GOTO

```
LABEL start
PRINT "Hello"
GOTO start
```

Labels are global at the top level, function-scoped inside functions.

### Calling a function inside an expression

A call with arguments needs parentheses anywhere other than a bare statement or the right-hand
side of an assignment:

```
x# = add# 3, 4              ' assignment - bare call is fine
sortItems data@             ' statement - bare call is fine

PRINT (add# 3, 4)           ' inside an expression - parentheses required
RETURN n# * (factorial# n# - 1)
IF (add# 1, 1) = 2 THEN
```

Function names may not be language keywords, so a sorting helper cannot be called `sort`.

## Arrays

**1-indexed** (first element is `[1]`, not `[0]`).

```
' Array literal
scores@ = [10, 20, 30]
PRINT scores@[1]       ' prints 10

' Allocate with SIZE
grid@ = SIZE 10         ' 1D array of 10 zeros
grid@ = SIZE 10, 5      ' 2D array: 10 rows x 5 cols

' 2D access
grid@[3][2] = 42

' Multi-dimensional literal (single line)
matrix@ = [1, 2, 3][4, 5, 6][7, 8, 9]

' Multi-dimensional literal (multi-line with parens)
matrix@ = ([1, 2, 3]
           [4, 5, 6]
           [7, 8, 9])
```

### Multi-line Syntax

Wrapping code in `()` suppresses newlines, allowing array literals and `PLAYPOLY` voices to span multiple lines. This only works for array literal assignments and `PLAYPOLY` — the opening `(` must come immediately before `[`.

```
grid@ = ([1, 0, 1]
         [0, 1, 0]
         [1, 0, 1])

PLAYPOLY (
  ["T72 O5 L4 D D D" WAVE SINE]
  ["T72 O4 L4 G G B" WAVE TRIANGLE]
)
```

Single-line syntax continues to work unchanged.

**Array operations:**

| Statement | Example | Notes |
|-----------|---------|-------|
| `APPEND` | `APPEND items@ value` | Add to end |
| `INSERT` | `INSERT items@ 2, value` | Insert at index (1-based) |
| `REMOVE` | `REMOVE items@ 3` | Remove at index (1-based) |
| `SORT` | `SORT items@` | Sort ascending in place |
| `SORT` | `SORT DESCENDING items@` | Sort descending |
| `LENGTH#` | `n# = LENGTH# items@` | Number of elements |

## Structs

```
' Struct literal
player& = {.name$ = "Sam", .score# = 0, .alive? = YES}

' Member access
PRINT player&.name$
player&.score# = player&.score# + 10
```

Member names include their type sigil (`.name$`, `.score#`, etc.).

## Functions

```
FUNCTION add# a#, b#
  RETURN a# + b#
END FUNCTION

result# = add# 3, 5
```

- Function names have a return-type sigil: `add#` returns number, `greet$` returns string, `make&` returns struct, etc.
- Functions without a useful return value use `IDENT` (no sigil): `FUNCTION doStuff ...`.

### Named parameters

```
FUNCTION move# SPEED s#, DIRECTION d$
  ...
END FUNCTION

move# SPEED 5, DIRECTION "north"
```

### OPTIONAL parameters

```
FUNCTION greet$ name$, OPTIONAL greeting$
  ...
END FUNCTION

greet$ "Sam"               ' greeting$ defaults to ""
greet$ "Sam", "Howdy"
```

Defaults: `#` → 0, `$` → `""`, `@` → `[]`, `&` → `{}`, `?` → 0.

### REFERENCE parameters

```
FUNCTION fill REFERENCE arr@, val#
  APPEND arr@ val#
END FUNCTION
```

Arrays, strings, and structs are **deep-copied** by default. Use `REFERENCE` to pass by reference.

## Built-in Calls Inside Other Calls

A built-in used inside another call's argument list takes only its own parameters, and leaves
everything after them to the enclosing call:

```
PRINTAT 1, 1, REPEAT$ "═", 78 COLOR WHITE&     ' COLOR belongs to PRINTAT
PRINTAT 5, 3 + LENGTH# line$, "_" COLOR YELLOW&
FILLTEXT 3, 1, 3, LENGTH# s$, "░"
```

`REPEAT$` takes two arguments and stops, so `COLOR` reaches `PRINTAT`. `LENGTH#` takes one, so
the comma after it separates `PRINTAT`'s arguments rather than starting a second argument to
`LENGTH#`.

A statement is different: it owns its whole line, so `PRINT "x" COLOR RED&` reads to the end.

## Output

```
PRINT "Hello"                          ' prints + newline
PRINT "Score: " + score#              ' auto-coerces number
PRINTAT 5, 10, "Hi"                    ' row 5, col 10 (1-indexed)
PRINTAT 1, 1, "Red!" COLOR RED&        ' inline color
PRINTAT 1, 1, "Bar" BACKGROUND BLUE&   ' inline background color
MOVECURSOR 3, 1                        ' move cursor (1-indexed)
CLEARSCREEN                            ' clear all text (keeps the screen background)
```

Filling a region:

```
FILLTEXT 3, 2, 22, 79, "░"                     ' rows 3-22, columns 2-79
FILLTEXT 1, 1, 25, 80 BACKGROUND BLUE&         ' spaces: clears to a color
FILLTEXT 1, 1, 1, 80, " " COLOR BLACK& BACKGROUND LIGHTGRAY&
```

Arguments are `row1, col1, row2, col2 [, CHARACTER] [COLOR c&] [BACKGROUND b&]`. Corners are
inclusive and their order does not matter. Regions off the edge of the screen are clipped
rather than reported as errors. `CHARACTER` defaults to a space, and only its first character
is used.

Backgrounds:

```
SETSCREENBACKGROUND BLUE&              ' fill the whole screen
SETBACKGROUND LIGHTGRAY&               ' default background for later prints
SETBACKGROUND NONE                     ' back to transparent
```

Cells with no background of their own are transparent, so the screen background shows
through. See [color-reference.md](color-reference.md) for the full model.

Screen is **80 columns x 25 rows**. Text wraps and scrolls automatically.

## Miscellaneous

- `SLEEP seconds#` — pause execution (supports decimals: `SLEEP 0.016`)
- `BEEP` — plays an 800 Hz tone for 200 ms
- Max recursion depth: 256
