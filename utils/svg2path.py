#!/usr/bin/env python3
"""Convert SVG files into SamBasic 3D PATH3D# blocks.

Usage:
    python utils/svg2path.py input.svg [-o output.sam] [--steps 10] [--scale 0.01]
"""

import argparse
import math
import re
import sys
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------------------
# SamBasic built-in CGA colors (name, R, G, B)
# ---------------------------------------------------------------------------
BUILTIN_COLORS = [
    ("BLACK",        0,   0,   0),
    ("BLUE",         0,   0, 170),
    ("GREEN",        0, 170,   0),
    ("CYAN",         0, 170, 170),
    ("RED",        170,   0,   0),
    ("MAGENTA",    170,   0, 170),
    ("BROWN",      170,  85,   0),
    ("LIGHTGRAY",  170, 170, 170),
    ("DARKGRAY",    85,  85,  85),
    ("LIGHTBLUE",   85,  85, 255),
    ("LIGHTGREEN",  85, 255,  85),
    ("LIGHTCYAN",   85, 255, 255),
    ("LIGHTRED",   255,  85,  85),
    ("LIGHTMAGENTA",255, 85, 255),
    ("YELLOW",     255, 255,  85),
    ("WHITE",      255, 255, 255),
]


def nearest_color(r, g, b):
    """Return the SamBasic color name nearest to the given RGB."""
    best_name = "WHITE"
    best_dist = float("inf")
    for name, cr, cg, cb in BUILTIN_COLORS:
        d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
        if d < best_dist:
            best_dist = d
            best_name = name
    return best_name


def parse_color(s):
    """Parse a CSS color string (#rgb, #rrggbb, rgb(...)) into (R, G, B)."""
    if not s:
        return None
    s = s.strip()
    if s == "none":
        return None
    m = re.match(r"^#([0-9a-fA-F]{6})$", s)
    if m:
        h = m.group(1)
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    m = re.match(r"^#([0-9a-fA-F]{3})$", s)
    if m:
        h = m.group(1)
        return int(h[0]*2, 16), int(h[1]*2, 16), int(h[2]*2, 16)
    m = re.match(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", s)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    return None


def extract_fill(elem):
    """Extract fill color from an SVG element's style or fill attribute."""
    # Check style attribute first
    style = elem.get("style", "")
    if style:
        m = re.search(r"fill\s*:\s*([^;]+)", style)
        if m:
            return parse_color(m.group(1).strip())
    # Fall back to fill attribute
    fill = elem.get("fill")
    if fill:
        return parse_color(fill)
    return None


# ---------------------------------------------------------------------------
# SVG transform parsing
# ---------------------------------------------------------------------------

def parse_transform(transform_str):
    """Parse an SVG transform attribute into a list of (type, args) tuples."""
    if not transform_str:
        return []
    transforms = []
    for m in re.finditer(r"(\w+)\s*\(([^)]*)\)", transform_str):
        kind = m.group(1)
        args = [float(x) for x in re.findall(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", m.group(2))]
        transforms.append((kind, args))
    return transforms


def build_transform_matrix(transforms):
    """Build a 3x3 affine matrix from SVG transform list.

    Returns (a, b, c, d, e, f) where the matrix is:
        [a c e]
        [b d f]
        [0 0 1]
    """
    # Start with identity
    a, b, c, d, e, f = 1, 0, 0, 1, 0, 0

    def multiply(a1, b1, c1, d1, e1, f1, a2, b2, c2, d2, e2, f2):
        return (
            a1*a2 + c1*b2,
            b1*a2 + d1*b2,
            a1*c2 + c1*d2,
            b1*c2 + d1*d2,
            a1*e2 + c1*f2 + e1,
            b1*e2 + d1*f2 + f1,
        )

    for kind, args in transforms:
        if kind == "translate":
            tx = args[0] if len(args) > 0 else 0
            ty = args[1] if len(args) > 1 else 0
            a, b, c, d, e, f = multiply(a, b, c, d, e, f, 1, 0, 0, 1, tx, ty)
        elif kind == "scale":
            sx = args[0] if len(args) > 0 else 1
            sy = args[1] if len(args) > 1 else sx
            a, b, c, d, e, f = multiply(a, b, c, d, e, f, sx, 0, 0, sy, 0, 0)
        elif kind == "rotate":
            angle = math.radians(args[0]) if len(args) > 0 else 0
            cos_a, sin_a = math.cos(angle), math.sin(angle)
            if len(args) == 3:
                cx, cy = args[1], args[2]
                a, b, c, d, e, f = multiply(a, b, c, d, e, f, 1, 0, 0, 1, cx, cy)
                a, b, c, d, e, f = multiply(a, b, c, d, e, f, cos_a, sin_a, -sin_a, cos_a, 0, 0)
                a, b, c, d, e, f = multiply(a, b, c, d, e, f, 1, 0, 0, 1, -cx, -cy)
            else:
                a, b, c, d, e, f = multiply(a, b, c, d, e, f, cos_a, sin_a, -sin_a, cos_a, 0, 0)
        elif kind == "matrix":
            if len(args) == 6:
                a, b, c, d, e, f = multiply(a, b, c, d, e, f, *args)
    return (a, b, c, d, e, f)


def apply_matrix(matrix, x, y):
    """Apply affine matrix to a point."""
    a, b, c, d, e, f = matrix
    return (a*x + c*y + e, b*x + d*y + f)


def get_accumulated_transform(elem, parent_map):
    """Walk up the element tree accumulating transforms."""
    chain = []
    node = elem
    while node is not None:
        t = node.get("transform")
        if t:
            chain.append(t)
        node = parent_map.get(node)
    # Apply in reverse order (outermost first)
    chain.reverse()
    combined = (1, 0, 0, 1, 0, 0)
    for t_str in chain:
        transforms = parse_transform(t_str)
        mat = build_transform_matrix(transforms)
        # Multiply combined * mat
        a1, b1, c1, d1, e1, f1 = combined
        a2, b2, c2, d2, e2, f2 = mat
        combined = (
            a1*a2 + c1*b2,
            b1*a2 + d1*b2,
            a1*c2 + c1*d2,
            b1*c2 + d1*d2,
            a1*e2 + c1*f2 + e1,
            b1*e2 + d1*f2 + f1,
        )
    return combined


# ---------------------------------------------------------------------------
# SVG path data tokenizer and parser
# ---------------------------------------------------------------------------

def tokenize_path(d):
    """Tokenize an SVG path d-attribute into commands and numbers."""
    tokens = []
    for tok in re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", d):
        if re.match(r"^[MmLlHhVvCcSsQqTtAaZz]$", tok):
            tokens.append(tok)
        else:
            tokens.append(float(tok))
    return tokens


def cubic_bezier(p0, p1, p2, p3, steps):
    """Flatten a cubic Bezier into line segments using De Casteljau."""
    points = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3*u**2*t * p1[0] + 3*u*t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3*u**2*t * p1[1] + 3*u*t**2 * p2[1] + t**3 * p3[1]
        points.append((x, y))
    return points


def quadratic_bezier(p0, p1, p2, steps):
    """Flatten a quadratic Bezier into line segments."""
    points = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        x = u**2 * p0[0] + 2*u*t * p1[0] + t**2 * p2[0]
        y = u**2 * p0[1] + 2*u*t * p1[1] + t**2 * p2[1]
        points.append((x, y))
    return points


def approximate_arc(cx, cy, rx, ry, start_angle, sweep_angle, x_rotation, steps):
    """Approximate an elliptical arc with line segments."""
    points = []
    cos_rot = math.cos(x_rotation)
    sin_rot = math.sin(x_rotation)
    for i in range(1, steps + 1):
        t = i / steps
        angle = start_angle + sweep_angle * t
        ex = rx * math.cos(angle)
        ey = ry * math.sin(angle)
        x = cos_rot * ex - sin_rot * ey + cx
        y = sin_rot * ex + cos_rot * ey + cy
        points.append((x, y))
    return points


def arc_endpoint_to_center(x1, y1, rx, ry, phi, large_arc, sweep, x2, y2):
    """Convert SVG arc endpoint parameterization to center parameterization."""
    cos_phi = math.cos(phi)
    sin_phi = math.sin(phi)
    dx2 = (x1 - x2) / 2
    dy2 = (y1 - y2) / 2
    x1p = cos_phi * dx2 + sin_phi * dy2
    y1p = -sin_phi * dx2 + cos_phi * dy2

    rx = abs(rx)
    ry = abs(ry)
    if rx == 0 or ry == 0:
        return x2, y2, 0, 0, 0, 0, 0

    # Scale radii if needed
    lam = (x1p**2) / (rx**2) + (y1p**2) / (ry**2)
    if lam > 1:
        s = math.sqrt(lam)
        rx *= s
        ry *= s

    num = max(0, rx**2 * ry**2 - rx**2 * y1p**2 - ry**2 * x1p**2)
    den = rx**2 * y1p**2 + ry**2 * x1p**2
    if den == 0:
        return x2, y2, rx, ry, 0, 0, 0
    sq = math.sqrt(num / den)
    if large_arc == sweep:
        sq = -sq

    cxp = sq * rx * y1p / ry
    cyp = -sq * ry * x1p / rx

    cx = cos_phi * cxp - sin_phi * cyp + (x1 + x2) / 2
    cy = sin_phi * cxp + cos_phi * cyp + (y1 + y2) / 2

    def angle_vec(ux, uy, vx, vy):
        n = math.sqrt(ux*ux + uy*uy) * math.sqrt(vx*vx + vy*vy)
        if n == 0:
            return 0
        c = (ux*vx + uy*vy) / n
        c = max(-1, min(1, c))
        a = math.acos(c)
        if ux*vy - uy*vx < 0:
            a = -a
        return a

    theta1 = angle_vec(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dtheta = angle_vec(
        (x1p - cxp) / rx, (y1p - cyp) / ry,
        (-x1p - cxp) / rx, (-y1p - cyp) / ry
    )

    if not sweep and dtheta > 0:
        dtheta -= 2 * math.pi
    elif sweep and dtheta < 0:
        dtheta += 2 * math.pi

    return cx, cy, rx, ry, phi, theta1, dtheta


def parse_path_d(d, steps):
    """Parse an SVG path d-attribute into a list of subpaths.

    Each subpath is a list of (x, y) points.
    """
    tokens = tokenize_path(d)
    subpaths = []
    current = []
    cx, cy = 0.0, 0.0  # current point
    sx, sy = 0.0, 0.0  # subpath start
    last_cmd = None
    last_cp = None  # last control point for S/T smooth curves
    i = 0

    def num():
        nonlocal i
        if i < len(tokens) and isinstance(tokens[i], float):
            v = tokens[i]
            i += 1
            return v
        return 0.0

    def flag():
        nonlocal i
        if i < len(tokens) and isinstance(tokens[i], float):
            v = int(tokens[i])
            i += 1
            return v
        return 0

    while i < len(tokens):
        tok = tokens[i]
        if isinstance(tok, str):
            cmd = tok
            i += 1
        else:
            # Implicit repeat of previous command
            # M repeats as L, m repeats as l
            cmd = last_cmd
            if cmd == 'M':
                cmd = 'L'
            elif cmd == 'm':
                cmd = 'l'

        if cmd in ('M', 'm'):
            # Start new subpath
            if current:
                subpaths.append(current)
                current = []
            x, y = num(), num()
            if cmd == 'm':
                x += cx
                y += cy
            cx, cy = x, y
            sx, sy = x, y
            current.append((cx, cy))
            last_cmd = cmd
            last_cp = None
            # Implicit L/l for subsequent coordinate pairs
            while i < len(tokens) and isinstance(tokens[i], float):
                x, y = num(), num()
                if cmd == 'm':
                    x += cx
                    y += cy
                cx, cy = x, y
                current.append((cx, cy))

        elif cmd in ('L', 'l'):
            while True:
                x, y = num(), num()
                if cmd == 'l':
                    x += cx
                    y += cy
                cx, cy = x, y
                current.append((cx, cy))
                if not (i < len(tokens) and isinstance(tokens[i], float)):
                    break
            last_cmd = cmd
            last_cp = None

        elif cmd in ('H', 'h'):
            while True:
                x = num()
                if cmd == 'h':
                    x += cx
                cx = x
                current.append((cx, cy))
                if not (i < len(tokens) and isinstance(tokens[i], float)):
                    break
            last_cmd = cmd
            last_cp = None

        elif cmd in ('V', 'v'):
            while True:
                y = num()
                if cmd == 'v':
                    y += cy
                cy = y
                current.append((cx, cy))
                if not (i < len(tokens) and isinstance(tokens[i], float)):
                    break
            last_cmd = cmd
            last_cp = None

        elif cmd in ('C', 'c'):
            while True:
                x1, y1, x2, y2, x, y = num(), num(), num(), num(), num(), num()
                if cmd == 'c':
                    x1 += cx; y1 += cy
                    x2 += cx; y2 += cy
                    x += cx; y += cy
                pts = cubic_bezier((cx, cy), (x1, y1), (x2, y2), (x, y), steps)
                current.extend(pts)
                last_cp = (x2, y2)
                cx, cy = x, y
                if not (i < len(tokens) and isinstance(tokens[i], float)):
                    break
            last_cmd = cmd

        elif cmd in ('S', 's'):
            while True:
                x2, y2, x, y = num(), num(), num(), num()
                if cmd == 's':
                    x2 += cx; y2 += cy
                    x += cx; y += cy
                # Infer first control point
                if last_cp and last_cmd in ('C', 'c', 'S', 's'):
                    x1 = 2 * cx - last_cp[0]
                    y1 = 2 * cy - last_cp[1]
                else:
                    x1, y1 = cx, cy
                pts = cubic_bezier((cx, cy), (x1, y1), (x2, y2), (x, y), steps)
                current.extend(pts)
                last_cp = (x2, y2)
                cx, cy = x, y
                if not (i < len(tokens) and isinstance(tokens[i], float)):
                    break
            last_cmd = cmd

        elif cmd in ('Q', 'q'):
            while True:
                x1, y1, x, y = num(), num(), num(), num()
                if cmd == 'q':
                    x1 += cx; y1 += cy
                    x += cx; y += cy
                pts = quadratic_bezier((cx, cy), (x1, y1), (x, y), steps)
                current.extend(pts)
                last_cp = (x1, y1)
                cx, cy = x, y
                if not (i < len(tokens) and isinstance(tokens[i], float)):
                    break
            last_cmd = cmd

        elif cmd in ('T', 't'):
            while True:
                x, y = num(), num()
                if cmd == 't':
                    x += cx; y += cy
                if last_cp and last_cmd in ('Q', 'q', 'T', 't'):
                    x1 = 2 * cx - last_cp[0]
                    y1 = 2 * cy - last_cp[1]
                else:
                    x1, y1 = cx, cy
                pts = quadratic_bezier((cx, cy), (x1, y1), (x, y), steps)
                current.extend(pts)
                last_cp = (x1, y1)
                cx, cy = x, y
                if not (i < len(tokens) and isinstance(tokens[i], float)):
                    break
            last_cmd = cmd

        elif cmd in ('A', 'a'):
            while True:
                rx_a, ry_a = num(), num()
                x_rot = math.radians(num())
                la, sw = flag(), flag()
                x, y = num(), num()
                if cmd == 'a':
                    x += cx; y += cy
                acx, acy, arx, ary, aphi, theta1, dtheta = arc_endpoint_to_center(
                    cx, cy, rx_a, ry_a, x_rot, la, sw, x, y
                )
                if arx == 0 or ary == 0:
                    current.append((x, y))
                else:
                    arc_steps = max(steps, int(abs(dtheta) / (math.pi / 4) * steps))
                    pts = approximate_arc(acx, acy, arx, ary, theta1, dtheta, aphi, arc_steps)
                    current.extend(pts)
                cx, cy = x, y
                if not (i < len(tokens) and isinstance(tokens[i], float)):
                    break
            last_cmd = cmd
            last_cp = None

        elif cmd in ('Z', 'z'):
            # Close path — return to subpath start
            if current and (cx != sx or cy != sy):
                current.append((sx, sy))
            cx, cy = sx, sy
            if current:
                subpaths.append(current)
                current = []
            last_cmd = cmd
            last_cp = None

        else:
            i += 1

    if current:
        subpaths.append(current)

    return subpaths


# ---------------------------------------------------------------------------
# SVG file processing
# ---------------------------------------------------------------------------

def strip_ns(tag):
    """Remove XML namespace prefix from a tag."""
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def build_parent_map(tree):
    """Build a child->parent map for the element tree."""
    parent_map = {}
    for parent in tree.iter():
        for child in parent:
            parent_map[child] = parent
    return parent_map


def collect_paths(svg_file, steps):
    """Parse SVG and return list of (color_rgb, subpaths) for each <path>."""
    tree = ET.parse(svg_file)
    root = tree.getroot()
    parent_map = build_parent_map(root)

    results = []

    for elem in root.iter():
        if strip_ns(elem.tag) != "path":
            continue

        d = elem.get("d")
        if not d:
            continue

        # Get fill color — walk up to parents if not on element
        color = extract_fill(elem)
        if color is None:
            node = parent_map.get(elem)
            while node is not None and color is None:
                color = extract_fill(node)
                node = parent_map.get(node)

        # Default to white if no fill found
        if color is None:
            color = (255, 255, 255)

        # Get accumulated transform
        matrix = get_accumulated_transform(elem, parent_map)

        # Parse the path data
        subpaths = parse_path_d(d, steps)

        # Apply transform to all points
        transformed = []
        for sp in subpaths:
            tsp = [apply_matrix(matrix, x, y) for x, y in sp]
            if len(tsp) >= 2:
                transformed.append(tsp)

        if transformed:
            results.append((color, transformed))

    return results


def compute_bounds(all_paths):
    """Compute bounding box of all points (in SVG coords, before Y-flip)."""
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for _color, subpaths in all_paths:
        for sp in subpaths:
            for x, y in sp:
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
    return min_x, min_y, max_x, max_y


def auto_scale(all_paths, target=5.0):
    """Compute (scale, cx, cy) to center and fit within ±target units."""
    min_x, min_y, max_x, max_y = compute_bounds(all_paths)
    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    half_w = (max_x - min_x) / 2
    half_h = (max_y - min_y) / 2
    max_extent = max(half_w, half_h)
    if max_extent == 0:
        return 1.0, cx, cy
    return target / max_extent, cx, cy


def emit_sambasic(all_paths, scale, center_x, center_y, source_name):
    """Generate SamBasic code from processed paths."""
    lines = []
    lines.append(f"' Converted from: {source_name}")
    lines.append("")

    counter = 1
    for color_rgb, subpaths in all_paths:
        color_name = nearest_color(*color_rgb)
        for sp in subpaths:
            lines.append(f"SETCOLOR {color_name}&")
            lines.append(f"p{counter}# = PATH3D#")
            for x, y in sp:
                # Center, flip Y (SVG Y-down -> SamBasic Y-up), then scale
                sx = round((x - center_x) * scale, 2)
                sy = round(-(y - center_y) * scale, 2)
                lines.append(f"  {sx}, {sy}, 0")
            lines.append("END PATH3D")
            lines.append("")
            counter += 1

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Convert SVG files into SamBasic PATH3D# blocks."
    )
    parser.add_argument("input", help="Input SVG file")
    parser.add_argument("-o", "--output", help="Output .sam file (default: stdout)")
    parser.add_argument(
        "--steps", type=int, default=10,
        help="Line segments per Bezier curve (default: 10)"
    )
    parser.add_argument(
        "--scale", type=float, default=None,
        help="Scale factor (default: auto-fit to ±5 units)"
    )
    args = parser.parse_args()

    all_paths = collect_paths(args.input, args.steps)

    if not all_paths:
        print("No paths found in SVG.", file=sys.stderr)
        sys.exit(1)

    if args.scale is not None:
        _, cx, cy = auto_scale(all_paths)
        scale = args.scale
    else:
        scale, cx, cy = auto_scale(all_paths)

    source_name = args.input.rsplit("/", 1)[-1] if "/" in args.input else args.input
    output = emit_sambasic(all_paths, scale, cx, cy, source_name)

    if args.output:
        with open(args.output, "w") as f:
            f.write(output)
            f.write("\n")
        print(f"Wrote {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
