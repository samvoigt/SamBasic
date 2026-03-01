# SamBasic 3D Wireframe Reference

## Overview

SamBasic includes a retained-mode 3D wireframe engine. Objects are created, transformed, and rendered onto the existing 640x480 2D canvas. It works with double buffering, `SETCOLOR`, and all existing 2D drawing — 3D is a layer on top of 2D, not a replacement.

## Coordinate System

- **Right-handed, Y-up**: X goes right, Y goes up, Z comes toward the viewer
- **Origin (0, 0, 0)** at the center of the scene
- This differs from the 2D canvas (Y-down, origin at top-left), but Y-up is standard for 3D

## Projection

Perspective projection with fixed ~60° field of view. Near/far clip planes at 0.1 / 1000. Objects shrink with distance.

Default camera: eye at (0, 0, 10), looking at origin.

## Initialization

No explicit initialization needed. The 3D scene is lazily created the first time any 3D command is used. `CLEAR3D` resets the scene.

## Creating Objects

`OBJECT3D#` creates a primitive and returns a numeric ID. Objects inherit the current `SETCOLOR` at creation time. Shape parameters are fixed at creation — delete and recreate to change geometry.

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
id# = OBJECT3D# PATH, POINTS myPoints@
```

When the return value isn't needed (e.g., for grid lines), you can omit the assignment:

```
OBJECT3D# LINE, X1 -5, Y1 0, Z1 0, X2 5, Y2 0, Z2 0
```

### Shape Reference

| Shape | Parameters | Description |
|-------|-----------|-------------|
| `CUBE` | `SIZE` (side length) | Cube centered on local origin |
| `SPHERE` | `RADIUS`, `SEGMENTS` (default 12) | Wireframe sphere with latitude/longitude lines |
| `CONE` | `RADIUS`, `HEIGHT`, `SEGMENTS` (default 8) | Circular base at origin, apex at (0, HEIGHT, 0) |
| `CYLINDER` | `RADIUS`, `HEIGHT`, `SEGMENTS` (default 8) | Circular caps, bottom at origin, top at (0, HEIGHT, 0) |
| `PYRAMID` | `BASE` (side length), `HEIGHT` | Square base at origin, apex at (0, HEIGHT, 0) |
| `PLANE` | `WIDTH`, `DEPTH`, `DIVISIONS` (default 1) | Flat grid on the XZ plane, centered on origin |
| `TORUS` | `RADIUS`, `TUBE`, `SEGMENTS` (default 16), `TUBESEGMENTS` (default 8) | Donut on the XZ plane, centered on origin |
| `LINE` | `X1 Y1 Z1 X2 Y2 Z2` | Single line segment in local space |
| `POINT` | `SIZE` (pixel radius, default 2) | Rendered as a small cross |
| `PATH` | `POINTS` (array of [x, y, z]) | Connected line segments through points |

`SEGMENTS` controls tessellation for curved surfaces. Higher values = smoother wireframe, more lines to draw.

### Paths

Paths draw connected line segments through an arbitrary number of 3D points. There are two ways to create them:

**Array form** — pass an array of `[x, y, z]` triples via `OBJECT3D#`:

```
pts@ = [[0, 0, 0], [1, 2, 1], [3, 0, -1]]
id# = OBJECT3D# PATH, POINTS pts@
```

This form supports dynamic/computed paths (built in loops, using variables, etc.).

**Block form** — `PATH3D#` with literal coordinates:

```
id# = PATH3D#
  0, 0, 0
  1, 2, 1
  3, 0, -1
  5, 2, 0
END PATH3D
```

Each line is one `x, y, z` point (literal numbers only, no variables or expressions). The block requires at least 2 points.

Both forms create the same kind of 3D object — fully transformable, colorable, attachable to groups. Paths are always open; to close a path, repeat the first point at the end.

## Transforming Objects

```
TRANSFORM3D TRANSLATE id#, 1, 2, 0              ' set position to (1, 2, 0)
TRANSFORM3D ROTATE id#, 45, 30, 0               ' set rotation to 45°X, 30°Y, 0°Z
TRANSFORM3D SCALE id#, 1.5                       ' set uniform scale to 1.5
```

All values are **absolute** (not incremental). The operation keyword comes first, then the object ID, then the values.

- **TRANSLATE** — 3 values: X, Y, Z position
- **ROTATE** — 3 values: X, Y, Z rotation in degrees. Applied in order X → Y → Z
- **SCALE** — 1 value: uniform scale factor

When rendering, the combined transform is: Scale → Rotate → Translate.

## Object Properties

### Color

```
SETCOLOR3D id#, GREEN&
```

Changes an object's wireframe color after creation.

### Visibility

```
SHOW3D id#, NO                                   ' hide object
SHOW3D id#, YES                                  ' show object (default)
```

Hidden objects are skipped by `RENDER3D`. On a group, hides the entire subtree.

### Hidden Edge Removal

```
HIDDENEDGES3D id#, YES                           ' enable back-face culling
HIDDENEDGES3D id#, NO                            ' disable (default)
```

Per-object. When enabled, back-facing edges are culled so the shape looks opaque. Only meaningful for closed shapes (cube, sphere, cone, cylinder, pyramid, torus) — lines, points, and planes ignore this setting.

## Groups

Groups compose objects into hierarchies with relative transforms. A group is a transform node with no geometry of its own.

```
figure# = GROUP3D#
```

### Attaching and Detaching

```
ATTACH3D figure#, head#                          ' add child to group
ATTACH3D figure#, body#
DETACH3D head#                                   ' remove from parent (becomes root-level)
```

An object can only belong to one parent. `ATTACH3D` automatically detaches from any previous parent. After attaching, the child's transform becomes relative to the parent's local space.

### How Group Transforms Work

Transforming a group transforms everything inside it:

```
TRANSFORM3D ROTATE figure#, 0, 45, 0            ' rotates entire group
TRANSFORM3D ROTATE head#, 15, 0, 0              ' head tilts independently within group
```

The child's local transform is applied first, then the parent's, then the grandparent's, etc. This means rotating a group rotates all children around the group's origin, and each child can still move/rotate independently within the group.

### Nesting

Groups can contain other groups for articulated hierarchies:

```
' Arm: shoulder → elbow → wrist
upperArm# = GROUP3D#
forearm# = GROUP3D#
hand# = OBJECT3D# CUBE, SIZE 0.3

ATTACH3D upperArm#, forearm#
ATTACH3D forearm#, hand#

TRANSFORM3D TRANSLATE forearm#, 0, -1.5, 0       ' elbow offset from shoulder
TRANSFORM3D TRANSLATE hand#, 0, -1.2, 0          ' wrist offset from elbow

TRANSFORM3D ROTATE forearm#, 45, 0, 0            ' bend elbow — moves forearm + hand
```

### Deleting Groups

`DELETE3D` on a group recursively deletes all children. To keep children, `DETACH3D` them first.

## Rendering

```
RENDER3D
```

Walks the scene graph depth-first, accumulates parent/child transforms, projects all visible primitives with perspective, and draws wireframe lines onto the active canvas context (front canvas or back buffer).

**Does not clear the canvas** — use `CLEARBUFFER` or `CLEARSCREEN` before rendering. This lets you mix 2D and 3D drawing in the same frame.

**Depth sorting:** Primitives are drawn back-to-front by world-space center distance (painter's algorithm).

## Cleanup

```
DELETE3D id#                                     ' remove object (and children if group)
CLEAR3D                                          ' remove all objects, reset scene
```

## Examples

### Spinning Cube

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

### Multi-Object Scene

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

### Animated Stick Figure (Groups)

```
figure# = GROUP3D#

SETCOLOR CYAN&
body# = OBJECT3D# LINE, X1 0, Y1 0, Z1 0, X2 0, Y2 2, Z2 0
head# = OBJECT3D# SPHERE, RADIUS 0.4, SEGMENTS 8
TRANSFORM3D TRANSLATE head#, 0, 2.4, 0

leftArmGroup# = GROUP3D#
TRANSFORM3D TRANSLATE leftArmGroup#, 0, 2, 0
leftArm# = OBJECT3D# LINE, X1 0, Y1 0, Z1 0, X2 -1, Y2 -1, Z2 0
ATTACH3D leftArmGroup#, leftArm#

rightArmGroup# = GROUP3D#
TRANSFORM3D TRANSLATE rightArmGroup#, 0, 2, 0
rightArm# = OBJECT3D# LINE, X1 0, Y1 0, Z1 0, X2 1, Y2 -1, Z2 0
ATTACH3D rightArmGroup#, rightArm#

ATTACH3D figure#, body#
ATTACH3D figure#, head#
ATTACH3D figure#, leftArmGroup#
ATTACH3D figure#, rightArmGroup#

angle# = 0
BUFFERENABLED YES
WHILE GETKEY$ = ""
  CLEARBUFFER
  TRANSFORM3D ROTATE figure#, 0, angle# * 0.5, 0
  swing# = (SIN# angle# * 0.05) * 30
  TRANSFORM3D ROTATE leftArmGroup#, swing#, 0, 0
  TRANSFORM3D ROTATE rightArmGroup#, 0 - swing#, 0, 0
  RENDER3D
  angle# = angle# + 2
  SHOWBUFFER
  SLEEP 0.016
END WHILE
```

## Quick Reference

| Statement | Type | Description |
|-----------|------|-------------|
| `OBJECT3D# shape, params...` | Expression (returns ID) | Create a 3D primitive |
| `OBJECT3D# PATH, POINTS arr@` | Expression (returns ID) | Create a path from array |
| `PATH3D# ... END PATH3D` | Expression (returns ID) | Create a path from literal points |
| `GROUP3D#` | Expression (returns ID) | Create an empty group |
| `TRANSFORM3D TRANSLATE id#, x, y, z` | Statement | Set position |
| `TRANSFORM3D ROTATE id#, rx, ry, rz` | Statement | Set rotation (degrees) |
| `TRANSFORM3D SCALE id#, s` | Statement | Set uniform scale |
| `SETCOLOR3D id#, color&` | Statement | Change wireframe color |
| `SHOW3D id#, YES/NO` | Statement | Toggle visibility |
| `HIDDENEDGES3D id#, YES/NO` | Statement | Toggle back-face culling |
| `ATTACH3D parentId#, childId#` | Statement | Add child to group |
| `DETACH3D childId#` | Statement | Remove child from parent |
| `RENDER3D` | Statement | Project and draw all visible objects |
| `DELETE3D id#` | Statement | Remove object (recursive for groups) |
| `CLEAR3D` | Statement | Remove all objects, reset scene |
