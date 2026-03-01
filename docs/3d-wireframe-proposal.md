# Proposal: 3D Wireframe Graphics for SamBasic

## Design philosophy

3D rendering projects wireframe edges onto the existing 640x480 canvas using the same `drawLine`/`drawPixel` infrastructure. It works with double buffering and SETCOLOR exactly as they do today — 3D is a layer on top of 2D, not a replacement.

## Coordinate system

- **Right-handed, Y-up**: X goes right, Y goes up, Z comes toward the viewer
- **Origin (0, 0, 0)** at the center of the scene
- This differs from the 2D canvas (Y-down, origin at top-left), but Y-up is standard for 3D and far less confusing when placing objects in space

## Projection

Perspective only. Fixed field of view (~60 degrees). Fixed near/far clip planes (0.1 / 1000). Objects shrink with distance.

## Retained mode with explicit render

Objects are created once and assigned an ID. You set their transform (position, rotation, scale) and call `RENDER3D` to draw everything to the canvas. This avoids forcing users to recompute 3D math each frame and makes animation loops clean.

## No explicit initialization

The 3D scene is lazily initialized the first time any 3D command is used (e.g., the first `OBJECT3D#` call). `CLEAR3D` serves as the reset mechanism if you want to start over.

Default camera: eye at (0, 0, 10), looking at origin (0, 0, 0).

## API

### Creating objects

Each returns a numeric ID:

```
id# = OBJECT3D# CUBE, SIZE 2
id# = OBJECT3D# SPHERE, RADIUS 1, SEGMENTS 12
id# = OBJECT3D# CONE, RADIUS 1, HEIGHT 2, SEGMENTS 8
id# = OBJECT3D# CYLINDER, RADIUS 1, HEIGHT 2, SEGMENTS 8
id# = OBJECT3D# PYRAMID, BASE 2, HEIGHT 3
id# = OBJECT3D# PLANE, WIDTH 5, DEPTH 5, DIVISIONS 4
id# = OBJECT3D# TORUS, RADIUS 2, TUBE 0.5, SEGMENTS 16, TUBESEGMENTS 8
id# = OBJECT3D# LINE, X1 0, Y1 0, Z1 0, X2 1, Y2 1, Z2 1
id# = OBJECT3D# POINT, SIZE 2
```

**Shape definitions:**

| Shape | Parameters | Description |
|-------|-----------|-------------|
| `CUBE` | `SIZE` (side length) | Axis-aligned cube, centered on local origin |
| `SPHERE` | `RADIUS`, `SEGMENTS` (default 12) | Wireframe sphere with latitude/longitude lines |
| `CONE` | `RADIUS`, `HEIGHT`, `SEGMENTS` (default 8) | Circular base centered on local origin, apex at (0, HEIGHT, 0) |
| `CYLINDER` | `RADIUS`, `HEIGHT`, `SEGMENTS` (default 8) | Circular caps centered on local origin, top at (0, HEIGHT, 0) |
| `PYRAMID` | `BASE` (side length), `HEIGHT` | Square base centered on local origin, apex at (0, HEIGHT, 0) |
| `PLANE` | `WIDTH`, `DEPTH`, `DIVISIONS` (default 1) | Flat rectangular grid on the XZ plane, centered on local origin. DIVISIONS=1 is a single quad, higher values add subdivisions |
| `TORUS` | `RADIUS` (center to tube center), `TUBE` (tube radius), `SEGMENTS` (default 16), `TUBESEGMENTS` (default 8) | Donut shape on the XZ plane, centered on local origin |
| `LINE` | `X1 Y1 Z1 X2 Y2 Z2` | Single line segment in local space |
| `POINT` | `SIZE` (pixel radius, default 2) | Rendered as a small cross at the projected position |

`SEGMENTS` controls tessellation for curved surfaces. Higher = smoother wireframe, more lines to draw. `TUBESEGMENTS` independently controls the tube cross-section detail on a torus.

Objects are created at the origin with no rotation and scale 1.0. Shape parameters (radius, size, segments, etc.) are **fixed at creation** — delete and recreate to change geometry. Each object captures the current `SETCOLOR` color at creation time.

### Transforming objects

```
TRANSFORM3D TRANSLATE id#, 1, 2, 0              ' set position to (1, 2, 0)
TRANSFORM3D ROTATE id#, 45, 30, 0               ' set rotation to 45°X, 30°Y, 0°Z
TRANSFORM3D SCALE id#, 1.5                       ' set uniform scale to 1.5
```

Each operation type sets that property **absolutely** (not incrementally). The operation keyword comes first, then the object ID, then the values.

- **TRANSLATE** takes 3 values: X, Y, Z position
- **ROTATE** takes 3 values: X, Y, Z rotation in degrees. Applied in order X → Y → Z
- **SCALE** takes 1 value: uniform scale factor

When rendering, the combined transform is: Scale → Rotate → Translate.

### Object color

```
SETCOLOR3D id#, GREEN&
```

Changes an object's wireframe color after creation.

### Object visibility

```
SHOW3D id#, NO                                   ' hide object
SHOW3D id#, YES                                  ' show object (default)
```

Hidden objects are skipped by `RENDER3D`. Default is `YES` (visible). Useful for toggling objects without deleting/recreating them.

### Hidden edge removal

```
HIDDENEDGES3D id#, YES                           ' enable back-face culling
HIDDENEDGES3D id#, NO                            ' disable (default)
```

Per-object setting. When enabled, back-facing edges are culled so the shape looks opaque rather than see-through. Default is `NO` (classic see-through wireframe). Only meaningful for closed shapes (cube, sphere, cone, pyramid) — lines and points ignore this setting.

### Rendering

```
RENDER3D
```

`RENDER3D` iterates through all visible objects, applies transforms, projects edges with perspective, clips to the view frustum, and draws the resulting 2D lines onto the active canvas context (respecting double buffering).

**It does not clear the canvas** — that's the user's job with `CLEARBUFFER` or `CLEARSCREEN`, same as 2D drawing. This means you can freely mix 2D drawing commands and 3D rendering in the same frame.

**Depth sorting:** Objects are drawn back-to-front by center distance (painter's algorithm). No per-edge Z-buffer — this is wireframe.

### Cleanup

```
DELETE3D id#                                     ' remove one object
CLEAR3D                                          ' remove all objects and reset scene
```

## Examples

### Spinning cube

```
SETCOLOR CYAN&
cube# = OBJECT3D# CUBE, SIZE 2

angle# = 0
BUFFERENABLED YES
WHILE GETKEY$ = ""
  CLEARBUFFER
  TRANSFORM3D ROTATE cube#, angle# * 0.3, angle#, 0
  RENDER3D
  angle# = angle# + 2
  SHOWBUFFER
  SLEEP 0.016
END WHILE
```

### Multi-object scene

```
' Ground grid
SETCOLOR DARKGRAY&
FOR i# FROM -5 TO 5
  OBJECT3D# LINE, X1 i#, Y1 0, Z1 -5, X2 i#, Y2 0, Z2 5
  OBJECT3D# LINE, X1 -5, Y1 0, Z1 i#, X2 5, Y2 0, Z2 i#
END FOR

' Shapes
SETCOLOR GREEN&
cube# = OBJECT3D# CUBE, SIZE 1.5
TRANSFORM3D TRANSLATE cube#, -2, 0.75, 0
HIDDENEDGES3D cube#, YES

SETCOLOR RED&
pyramid# = OBJECT3D# PYRAMID, BASE 2, HEIGHT 2
TRANSFORM3D TRANSLATE pyramid#, 2, 0, 0
HIDDENEDGES3D pyramid#, YES

SETCOLOR LIGHTBLUE&
sphere# = OBJECT3D# SPHERE, RADIUS 1, SEGMENTS 16
TRANSFORM3D TRANSLATE sphere#, 0, 1, 2

RENDER3D
```

### Toggle visibility

```
SETCOLOR YELLOW&
cone# = OBJECT3D# CONE, RADIUS 1, HEIGHT 2, SEGMENTS 12

frame# = 0
BUFFERENABLED YES
WHILE GETKEY$ = ""
  CLEARBUFFER
  ' Blink the cone on/off every 30 frames
  IF frame# % 60 < 30 THEN
    SHOW3D cone#, YES
  ELSE
    SHOW3D cone#, NO
  END IF
  TRANSFORM3D ROTATE cone#, 0, frame# * 3, 0
  RENDER3D
  frame# = frame# + 1
  SHOWBUFFER
  SLEEP 0.016
END WHILE
```

## Implementation scope

| Layer | What's needed |
|-------|---------------|
| **Parser** (`js/parser.js`) | `OBJECT3D#`, `TRANSFORM3D`, `SETCOLOR3D`, `SHOW3D`, `HIDDENEDGES3D`, `RENDER3D`, `DELETE3D`, `CLEAR3D` |
| **Interpreter** (`js/interpreter.js`) | Evaluate args, call into 3D engine, pass current color to object creation |
| **3D engine** (new `js/3d.js`) | Scene state (object list, camera), shape generators for 9 primitives (cube, sphere, cone, cylinder, pyramid, plane, torus, line, point), 4x4 matrix math (rotation, translation, scale, perspective), projection to screen coords, view frustum clipping, back-face culling, depth sorting |
| **Screen** (`js/screen.js`) | No changes — `RENDER3D` calls existing `drawLine`/`drawPixel` |

The 3D engine handles all the math (matrix multiply, projection, clipping) and produces 2D line segments that go through the existing canvas pipeline.

## Statement summary

| Statement | Type | Description |
|-----------|------|-------------|
| `OBJECT3D# shape, params...` | Expression (returns ID) | Create a 3D object |
| `TRANSFORM3D TRANSLATE id#, x, y, z` | Statement | Set object position |
| `TRANSFORM3D ROTATE id#, rx, ry, rz` | Statement | Set object rotation (degrees) |
| `TRANSFORM3D SCALE id#, s` | Statement | Set object uniform scale |
| `SETCOLOR3D id#, color&` | Statement | Change object wireframe color |
| `SHOW3D id#, YES/NO` | Statement | Toggle object visibility |
| `HIDDENEDGES3D id#, YES/NO` | Statement | Toggle back-face culling per object |
| `RENDER3D` | Statement | Project and draw all visible objects |
| `DELETE3D id#` | Statement | Remove one object |
| `CLEAR3D` | Statement | Remove all objects, reset 3D scene |
