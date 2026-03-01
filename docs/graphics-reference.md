# SamBasic Graphics Reference

## Canvas

The graphics canvas is **640 x 480 pixels**. Coordinates are 0-indexed: `(0, 0)` is top-left, `(639, 479)` is bottom-right.

Graphics mode activates automatically when any drawing command is used. Graphics and text can coexist on the same screen.

## Drawing Primitives

All drawing uses the current color set by `SETCOLOR`. See [color-reference.md](color-reference.md).

### DRAWPIXEL

```
SETCOLOR RED&
DRAWPIXEL 100, 200
```

Draws a single pixel at `(x, y)`. Arguments are positional: `x, y`.

### DRAWLINE

```
DRAWLINE 0, 0, 640, 480
```

Draws a line from `(x1, y1)` to `(x2, y2)`. Arguments: `x1, y1, x2, y2`.

Lines are drawn with 0.5px offset for crisp single-pixel rendering.

### DRAWBOX

```
DRAWBOX 10, 10, 200, 150, NO      ' outline only
DRAWBOX 10, 10, 200, 150, YES     ' filled
DRAWBOX 10, 10, 200, 150          ' outline (default)
```

Arguments: `x1, y1, x2, y2 [, fill?]`. Coordinate order doesn't matter — min/max is computed internally.

### DRAWCIRCLE

```
DRAWCIRCLE 320, 240, 50, YES      ' filled circle
DRAWCIRCLE 320, 240, 50, NO       ' outline only
DRAWCIRCLE 320, 240, 50           ' outline (default)
```

Arguments: `x, y, radius [, fill?]`. Center at `(x, y)` with given radius.

## Double Buffering

Without buffering, every draw command immediately appears on screen — this causes flickering in animations. Double buffering solves this:

```
BUFFERENABLED YES          ' start drawing to back buffer

' ... draw everything for one frame ...

SHOWBUFFER                 ' copy back buffer to screen (one fast flip)
CLEARBUFFER                ' clear back buffer for next frame
```

### Commands

| Command | Effect |
|---------|--------|
| `BUFFERENABLED YES` | All drawing goes to hidden back buffer |
| `BUFFERENABLED NO` | All drawing goes directly to screen |
| `SHOWBUFFER` | Copy back buffer to visible screen |
| `CLEARBUFFER` | Clear back buffer to black |
| `CLEARBUFFER COLOR RED&` | Clear back buffer to a color struct |

Text (PRINT, PRINTAT) also respects buffering — when enabled, text renders to the back buffer too.

## Sprites

Sprites are small images created from 2D arrays of color data.

### Creating a Sprite

Build a 2D array where each cell is either `0` (transparent) or a struct with `.r#`, `.g#`, `.b#` members (0-255):

```
rows@ = SIZE 4
FOR y# FROM 1 TO 4
  row@ = SIZE 4
  FOR x# FROM 1 TO 4
    row@[x#] = {.r# = 255, .g# = 0, .b# = x# * 60}
  END FOR
  rows@[y#] = row@
END FOR

id# = CREATESPRITE# rows@
```

`CREATESPRITE#` returns a numeric sprite ID. Each sprite is rasterized once to an internal canvas.

**Note:** Sprite color structs use short keys `.r#`, `.g#`, `.b#` — not `.r#`, `.g#`, `.b#` (which are used by `SETCOLOR`). This is a quirk of the implementation.

### Drawing a Sprite

```
DRAWSPRITE SPRITE id#, X 100, Y 200
```

Draws the sprite at pixel position (100, 200). Uses keyword syntax: `SPRITE`, `X`, `Y`.

The sprite's `0`/null cells are transparent. Sprites respect double buffering.

## Game Loop Pattern

```
BUFFERENABLED YES

' Initialize game state
x# = 320
y# = 240
speed# = 3

WHILE 1 = 1
  ' Input
  key$ = GETKEY$
  IF key$ = "ArrowLeft" THEN
    x# = x# - speed#
  END IF
  IF key$ = "ArrowRight" THEN
    x# = x# + speed#
  END IF

  ' Draw
  CLEARBUFFER
  SETCOLOR WHITE&
  DRAWCIRCLE x#, y#, 10, YES
  PRINTAT 1, 1, "X: " + TOSTRING$ x#
  SHOWBUFFER

  ' Frame timing (~60 FPS)
  SLEEP 0.016
END WHILE
```

### Key points:
- `GETKEY$` returns the currently held key (empty string if none). Key names match JavaScript `event.key`: `"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"`, `"a"`, `" "` (space), etc.
- `SLEEP 0.016` gives roughly 60 FPS.
- `RUNNINGTIME#` returns milliseconds since program start — useful for delta-time calculations.
- `CLEARBUFFER` each frame prevents ghosting.

## Text on the Graphics Canvas

When graphics mode is active, PRINT and PRINTAT still work. Text is rendered as HTML overlaying the canvas. In buffered mode, text goes to the back text buffer and appears on `SHOWBUFFER`.

Screen coordinates for text are still **row, column** (1-indexed, 80x25 grid), while graphics coordinates are **x, y** pixels (0-indexed, 640x480).

## Coordinate Summary

| System | Origin | Size | Indexing | Used by |
|--------|--------|------|----------|---------|
| Text | top-left | 80 x 25 | 1-indexed (row, col) | PRINTAT, MOVECURSOR |
| Graphics | top-left | 640 x 480 | 0-indexed (x, y) | DRAWPIXEL, DRAWLINE, etc. |
| Arrays | — | — | 1-indexed | All array access |
