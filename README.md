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

Variables are prefixed with a sigil to indicate their type:

| Prefix | Type   | Example          |
|--------|--------|------------------|
| `#`    | Number | `#score = 100`   |
| `$`    | String | `$name = "Sam"`  |
| `@`    | Array  | `@data = [1,2,3]`|

Keywords must be **UPPERCASE**.

### Operators

**Arithmetic:** `+`, `-`, `*`, `/`, `%` (modulo), `^` (exponent)

**Comparison:** `=`, `<>` (not equal), `<`, `>`, `<=`, `>=`

**Logical:** `AND`, `OR`, `NOT`

String concatenation uses `+`.

### Output

```
PRINT expr                         ' Print with newline
PRINTAT row, col, expr             ' Print at screen position (1-indexed)
CLEARSCREEN                        ' Clear the screen
```

Both `PRINT` and `PRINTAT` support `WITHCOLOR`:
```
PRINT "alert!" WITHCOLOR RED
```

### Input

```
INPUT "What is your name? ", $name  ' Prompt and store input
GETKEY $k                           ' Read currently pressed key (non-blocking)
```

### Control Flow

**If / Else:**
```
IF #x > 10 THEN
  PRINT "big"
ELSE
  PRINT "small"
ENDIF
```

**For Loop:**
```
FOR #i GOESFROM 1 TO 10 WITHSTEP 2
  PRINT #i
ENDFOR
```
The loop variable and `WITHSTEP` are optional (step defaults to 1).

**While Loop:**
```
WHILE #x < 100
  #x = #x * 2
ENDWHILE
```

**Labels and Goto:**
```
LABEL $start
PRINT "looping"
GOTO $start
```

**Blocks (subroutines):**
```
BLOCK greet
  COLOR LIGHTGREEN
  PRINT "Hello from the block!"
  COLOR LIGHTGRAY
ENDBLOCK

PRINT "Before block"
RUNBLOCK greet
PRINT "After block"
```

Define reusable blocks of code with `BLOCK name` / `ENDBLOCK`. Call them with `RUNBLOCK name`. Block names are plain identifiers (no sigil prefix). Blocks can be called multiple times and from anywhere in the program. Execution returns to the line after `RUNBLOCK` when the block finishes.

### Arrays

```
@items = 10                       ' Allocate array of size 10 (filled with 0)
@items = [1, 2, 3]               ' Array literal
@grid = 5, 5                     ' 2D array (5x5)
@grid = [1,2,3][4,5,6][7,8,9]   ' 2D array literal

@items[1] = 42                   ' Set element (1-indexed)
PRINT @items[1]                  ' Get element
PRINT @grid[2][3]                ' 2D access
```

Arrays are untyped — they can hold both numbers and strings.

### Color

```
COLOR GREEN                       ' Set global text color
```

Uses the 16-color EGA palette:

`BLACK`, `BLUE`, `GREEN`, `CYAN`, `RED`, `MAGENTA`, `BROWN`, `LIGHTGRAY`, `DARKGRAY`, `LIGHTBLUE`, `LIGHTGREEN`, `LIGHTCYAN`, `LIGHTRED`, `LIGHTMAGENTA`, `YELLOW`, `WHITE`

### Sound

```
BEEP                              ' Short beep
PLAY "O4 L4 C D E F G A B > C"   ' Play notes (QBASIC PLAY syntax)
PLAY "C D E" WITHWAVE SINE       ' Wave types: SINE, SQUARE, SAWTOOTH, TRIANGLE
PLAY "C D E" INBACKGROUND        ' Play in background (non-blocking)
PLAY "C D E" ONREPEAT            ' Loop until program stops (blocking)
PLAY "C D E" INBACKGROUND ONREPEAT ' Loop in background
```

**Polyphonic playback** — play multiple voices simultaneously with `PLAYPOLY`. Each voice is a bracketed group with its own note string and optional wave type:
```
PLAYPOLY ["O4 L4 C E G" WITHWAVE SINE] ["O3 L2 C G" WITHWAVE TRIANGLE]
PLAYPOLY ["C E G"] ["C G"] INBACKGROUND ONREPEAT
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
READ #x                          ' Reads 10 into #x
READ #y                          ' Reads 20 into #y
READ $msg                        ' Reads "hello" into $msg
```

### Other

```
RANDOM #x                        ' Set #x to random int between 0 and current value of #x
```

### Comments

```
' This is a comment
```

### Screen

The screen is 80 columns by 25 rows. Printing past line 25 scrolls the screen up.

## Example

```
COLOR GREEN
PRINT "=== FizzBuzz ==="
COLOR LIGHTGRAY

FOR #i GOESFROM 1 TO 20
  IF #i % 15 = 0 THEN
    COLOR YELLOW
    PRINT "FizzBuzz"
  ELSE
    IF #i % 3 = 0 THEN
      COLOR LIGHTCYAN
      PRINT "Fizz"
    ELSE
      IF #i % 5 = 0 THEN
        COLOR LIGHTMAGENTA
        PRINT "Buzz"
      ELSE
        COLOR LIGHTGRAY
        PRINT #i
      ENDIF
    ENDIF
  ENDIF
ENDFOR
```
