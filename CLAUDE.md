# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SamBasic is a browser-based BASIC/QBASIC-inspired language interpreter. No build tools, bundlers, or dependencies — open `index.html` in a browser. All JS files are loaded via `<script>` tags in dependency order.

## Running

Open `index.html` directly in any modern browser. There is no build step, no package.json, no test runner.

The `utils/svg2path.py` script converts SVG files to SamBasic path commands (Python 3, stdlib only). Defaults to 2D `DRAWPATH` output; use `--3d` for `PATH3D#` blocks:
```
python utils/svg2path.py input.svg [-o output.sam] [--steps 10] [--scale 0.01]
python utils/svg2path.py input.svg --3d [-o output.sam]
```

## Architecture

### Interpreter Pipeline: Source → Tokens → AST → Execution

1. **Lexer** (`js/lexer.js`) — Tokenizes source into typed tokens. Merges `END + KEYWORD` pairs (e.g. `END_IF`). Variables use type suffixes: `#` number, `$` string, `@` array, `&` struct, `?` boolean.

2. **Parser** (`js/parser.js`) — Recursive descent parser producing AST nodes. Expression precedence climbing from `parseExpr()` down through `parseOr/And/Not/Comparison/AddSub/MulDiv/Power/Unary/Atom`. Pre-pass collects function names for forward references. Built-in function params defined in `BUILTIN_KEYWORD_PARAMS`.

3. **Interpreter** (`js/interpreter.js`) — Async execution loop with `execStmt()`/`evalExpr()`. Control flow via exception signals (`GotoSignal`, `BreakSignal`, `ContinueSignal`, `ReturnSignal`). Yields to event loop every 100 statements. Variables stored in separate maps by type (`numVars`, `strVars`, `arrVars`, `structVars`, `boolVars`).

### Subsystems

- **Screen** (`js/screen.js`) — 80×25 text grid + 640×480 graphics canvas. Double buffering: `SHOWBUFFER` copies back→front and auto-renders 3D if a scene exists. Text and graphics are separate layers composited together.

- **3D Engine** (`js/3d.js`) — Retained-mode scene graph (`Scene3D` class). Objects have position/rotation/scale transforms. Groups enable hierarchies. Rendering: depth-first traversal → MVP matrix per object → perspective projection → painter's algorithm depth sort → wireframe draw via callbacks. `SHOWBUFFER` implicitly calls `_renderScene3D()`.

- **Audio** (`js/audio.js`) — Web Audio synthesis. QBASIC PLAY string parser (notes, octaves, tempo, rests, percussion). Separate audio contexts for foreground (blocking) and background (non-blocking/looping) playback.

- **Editor** (`js/editor.js`) — Real-time syntax highlighting via transparent textarea over highlighted `<pre>`.

- **App** (`js/app.js`) — DOM event wiring, file I/O (localStorage with `sambasic_file:` prefix), power button toggle.

## Key Conventions

- Keywords are UPPERCASE in SamBasic source (`PRINT`, `FOR`, `END IF`)
- All array/string indices are 1-based in the language
- The 16 built-in colors are CGA/EGA palette constants (see `docs/color-reference.md`)
- 3D coordinate system: right-handed Y-up, perspective projection with 60° FOV
- Transforms are absolute, not incremental
