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

' Multi-dimensional literal
matrix@ = [1, 2, 3][4, 5, 6][7, 8, 9]
```

**Array operations:**

| Statement | Example | Notes |
|-----------|---------|-------|
| `APPEND` | `APPEND items@, value` | Add to end |
| `INSERT` | `INSERT items@, 2, value` | Insert at index (1-based) |
| `REMOVE` | `REMOVE items@, 3` | Remove at index (1-based) |
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
FUNCTION fill arr@, REFERENCE val#
  APPEND arr@, val#
END FUNCTION
```

Arrays, strings, and structs are **deep-copied** by default. Use `REFERENCE` to pass by reference.

### GLOBAL

```
FUNCTION increment
  GLOBAL counter#
  counter# = counter# + 1
END FUNCTION
```

`GLOBAL` must be the **first statement** in the function body. Lists variables from the outer scope to access.

## Output

```
PRINT "Hello"                          ' prints + newline
PRINT "Score: " + score#              ' auto-coerces number
PRINTAT 5, 10, "Hi"                    ' row 5, col 10 (1-indexed)
PRINTAT 1, 1, "Red!" COLOR RED&        ' inline color
MOVECURSOR 3, 1                        ' move cursor (1-indexed)
CLEARSCREEN                            ' clear all text
```

Screen is **80 columns x 25 rows**. Text wraps and scrolls automatically.

## Miscellaneous

- `SLEEP seconds#` — pause execution (supports decimals: `SLEEP 0.016`)
- `BEEP` — plays an 800 Hz tone for 200 ms
- Max recursion depth: 256
