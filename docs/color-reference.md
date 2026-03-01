# SamBasic Color Reference

## How Colors Work

Colors are **struct variables** with three numeric members: `.r#`, `.g#`, `.b#` (each 0-255).

```
SETCOLOR RED&                               ' use a predefined color
SETCOLOR {.r# = 255, .g# = 128, .b# = 0}   ' custom orange
```

`SETCOLOR` applies to all subsequent `PRINT`, `PRINTAT`, and drawing commands until changed.

## Predefined Colors

These are built-in struct variables available in every program:

| Name | `.r#` | `.g#` | `.b#` | Hex |
|------|---------|-----------|----------|-----|
| `BLACK&` | 0 | 0 | 0 | `#000000` |
| `BLUE&` | 0 | 0 | 170 | `#0000AA` |
| `GREEN&` | 0 | 170 | 0 | `#00AA00` |
| `CYAN&` | 0 | 170 | 170 | `#00AAAA` |
| `RED&` | 170 | 0 | 0 | `#AA0000` |
| `MAGENTA&` | 170 | 0 | 170 | `#AA00AA` |
| `BROWN&` | 170 | 85 | 0 | `#AA5500` |
| `LIGHTGRAY&` | 170 | 170 | 170 | `#AAAAAA` |
| `DARKGRAY&` | 85 | 85 | 85 | `#555555` |
| `LIGHTBLUE&` | 85 | 85 | 255 | `#5555FF` |
| `LIGHTGREEN&` | 85 | 255 | 85 | `#55FF55` |
| `LIGHTCYAN&` | 85 | 255 | 255 | `#55FFFF` |
| `LIGHTRED&` | 255 | 85 | 85 | `#FF5555` |
| `LIGHTMAGENTA&` | 255 | 85 | 255 | `#FF55FF` |
| `YELLOW&` | 255 | 255 | 85 | `#FFFF55` |
| `WHITE&` | 255 | 255 | 255 | `#FFFFFF` |

These are CGA-style colors. The default text color is `#AAAAAA` (LIGHTGRAY).

## Usage Patterns

### Setting the global color

```
SETCOLOR YELLOW&
PRINT "This is yellow"
PRINT "This is also yellow"
SETCOLOR WHITE&
PRINT "Now it's white"
```

### Inline COLOR on PRINT/PRINTAT

Override the color for a single print without changing the global color:

```
PRINT "Warning!" COLOR RED&
PRINT "This uses the previous global color"

PRINTAT 5, 10, "Score: 100" COLOR LIGHTGREEN&
```

### Custom colors

```
' Create a custom color struct
orange& = {.r# = 255, .g# = 165, .b# = 0}
SETCOLOR orange&

' Or inline
SETCOLOR {.r# = 100, .g# = 200, .b# = 255}
```

### Colors in graphics

`SETCOLOR` affects all drawing primitives:

```
SETCOLOR RED&
DRAWCIRCLE 320, 240, 50, YES       ' red filled circle

SETCOLOR {.r# = 0, .g# = 128, .b# = 255}
DRAWLINE 0, 0, 640, 480            ' custom blue line
```

### CLEARBUFFER color

`CLEARBUFFER` takes an optional color struct:

```
CLEARBUFFER                         ' clear to black
CLEARBUFFER COLOR {.r# = 26, .g# = 26, .b# = 46}   ' clear to dark blue
CLEARBUFFER COLOR RED&              ' clear to red
```

## Sprite Colors

Sprites accept either color structs or **palette indices** (integers 1-256). Use `0` for transparent pixels.

### Color struct method

```
pixel& = {.r# = 255, .g# = 0, .b# = 128}
```

### Palette index method (recommended for sprites)

Palette indices are 1-based and follow the xterm-256 color palette:

| Index | Color | RGB |
|-------|-------|-----|
| 1 | Black | 0, 0, 0 |
| 2 | Blue | 0, 0, 170 |
| 3 | Green | 0, 170, 0 |
| 4 | Cyan | 0, 170, 170 |
| 5 | Red | 170, 0, 0 |
| 6 | Magenta | 170, 0, 170 |
| 7 | Brown | 170, 85, 0 |
| 8 | Light Gray | 170, 170, 170 |
| 9 | Dark Gray | 85, 85, 85 |
| 10 | Light Blue | 85, 85, 255 |
| 11 | Light Green | 85, 255, 85 |
| 12 | Light Cyan | 85, 255, 255 |
| 13 | Light Red | 255, 85, 85 |
| 14 | Light Magenta | 255, 85, 255 |
| 15 | Yellow | 255, 255, 85 |
| 16 | White | 255, 255, 255 |
| 17-232 | 6x6x6 color cube | R/G/B levels: 0, 51, 102, 153, 204, 255 |
| 233-256 | Grayscale ramp | 24 shades from near-black (8) to near-white (238) |

Indices 1-16 match the built-in CGA color constants (`BLACK&` through `WHITE&`).

```
' A sprite using palette indices
sprite@ = ([0,  5,  5,  0]
           [5, 15, 15,  5]
           [5, 15, 15,  5]
           [0,  5,  5,  0])
id# = CREATESPRITE# sprite@
```

See [graphics-reference.md](graphics-reference.md) for full sprite details.
