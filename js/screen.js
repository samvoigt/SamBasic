const DEFAULT_COLOR = '#33FF33';

// xterm-256 palette: 16 CGA colors + 6x6x6 color cube + 24-step grayscale
const VGA_PALETTE = (() => {
  const p = [];
  // 0-15: CGA colors (matching SamBasic's built-in color constants)
  const cga = [
    [0,0,0], [0,0,170], [0,170,0], [0,170,170],
    [170,0,0], [170,0,170], [170,85,0], [170,170,170],
    [85,85,85], [85,85,255], [85,255,85], [85,255,255],
    [255,85,85], [255,85,255], [255,255,85], [255,255,255],
  ];
  for (const c of cga) p.push(c);
  // 16-231: 6x6x6 color cube
  const levels = [0, 51, 102, 153, 204, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++)
        p.push([levels[r], levels[g], levels[b]]);
  // 232-255: 24-step grayscale ramp (8 to 238 in steps of 10)
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    p.push([v, v, v]);
  }
  return p;
})();

const COLS = 80;
const ROWS = 25;

// All screen cells are built here so new fields can't be missed by a caller.
// bg === null means transparent: the screen background shows through.
function makeCell(char = ' ', color = DEFAULT_COLOR, bg = null) {
  return { char, color, bg };
}

class Screen {
  constructor(el) {
    this.el = el;
    this.cols = COLS;
    this.rows = ROWS;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.globalColor = DEFAULT_COLOR;
    this.globalBg = null;    // SETBACKGROUND - default bg for subsequent prints
    this.screenBg = null;    // SETSCREENBACKGROUND - the field behind transparent cells
    this.buffer = [];

    // Graphics state
    this.graphicsEnabled = false;
    this.bufferEnabled = false;

    // Render coalescing: many writes per frame, one DOM rebuild.
    this._renderPending = false;
    this._renderFrame = null;
    this.frontCanvas = null;
    this.frontCtx = null;
    this.backCanvas = null;
    this.backCtx = null;
    this.backTextBuffer = null;
    this.sprites = {};
    this.nextSpriteId = 1;
    this.monitorEl = null;

    this.clear();
  }

  _makeEmptyTextBuffer() {
    const buf = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        row.push(makeCell());
      }
      buf.push(row);
    }
    return buf;
  }

  // CLEARSCREEN. Deliberately preserves screenBg: the field is a property of the
  // screen, not of the text on it, so clearing fills with the field rather than
  // wiping it. Use reset() to drop the field as well.
  clear() {
    this.globalColor = DEFAULT_COLOR;
    this.globalBg = null;
    this.buffer = this._makeEmptyTextBuffer();
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.resetGraphics();
    this.render();
  }

  // Full reset for a new program run or a machine reset: clear() plus the field.
  reset() {
    this.screenBg = null;
    if (this.el) this.el.style.background = '';
    this.clear();
  }

  resetGraphics() {
    this.bufferEnabled = false;
    this.backTextBuffer = null;
    this.sprites = {};
    this.nextSpriteId = 1;

    if (this.frontCanvas) {
      this.frontCanvas.style.display = 'none';
      this.frontCtx.clearRect(0, 0, 640, 480);
    }
    if (this.backCanvas) {
      this.backCtx.clearRect(0, 0, 640, 480);
    }
    if (this.monitorEl) {
      this.monitorEl.classList.remove('graphics-enabled');
    }
    this.graphicsEnabled = false;
  }

  _ensureGraphics() {
    if (this.graphicsEnabled) return;

    if (!this.frontCanvas) {
      this.frontCanvas = document.getElementById('graphics-canvas');
      this.frontCtx = this.frontCanvas.getContext('2d');
      this.frontCtx.imageSmoothingEnabled = false;
    }
    if (!this.backCanvas) {
      this.backCanvas = document.createElement('canvas');
      this.backCanvas.width = 640;
      this.backCanvas.height = 480;
      this.backCtx = this.backCanvas.getContext('2d');
      this.backCtx.imageSmoothingEnabled = false;
    }
    if (!this.monitorEl) {
      this.monitorEl = this.el.closest('.monitor-screen');
    }

    this.frontCanvas.style.display = 'block';
    this.monitorEl.classList.add('graphics-enabled');
    this.graphicsEnabled = true;
  }

  get _activeTextBuffer() {
    return this.bufferEnabled ? this.backTextBuffer : this.buffer;
  }

  get _activeCtx() {
    return this.bufferEnabled ? this.backCtx : this.frontCtx;
  }

  setBufferEnabled(enabled) {
    if (enabled) {
      this._ensureGraphics();
      this.bufferEnabled = true;
      if (!this.backTextBuffer) {
        this.backTextBuffer = this._makeEmptyTextBuffer();
      }
      // Initialize back canvas to black
      this.backCtx.fillStyle = '#000000';
      this.backCtx.fillRect(0, 0, 640, 480);
    } else {
      this.bufferEnabled = false;
    }
  }

  showBuffer() {
    if (!this.backCanvas) return;
    // Copy back canvas to front canvas
    this.frontCtx.clearRect(0, 0, 640, 480);
    this.frontCtx.drawImage(this.backCanvas, 0, 0);
    // Deep-copy back text buffer to front buffer
    if (this.backTextBuffer) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          this.buffer[r][c] = makeCell(
            this.backTextBuffer[r][c].char,
            this.backTextBuffer[r][c].color,
            this.backTextBuffer[r][c].bg,
          );
        }
      }
    }
    this.renderNow();
  }

  clearBuffer(colorHex) {
    const color = colorHex || '#000000';
    if (this.backCtx) {
      this.backCtx.fillStyle = color;
      this.backCtx.fillRect(0, 0, 640, 480);
    }
    this.backTextBuffer = this._makeEmptyTextBuffer();
  }

  setColor(hexStr) {
    this.globalColor = hexStr;
  }

  // SETBACKGROUND - default background for subsequent prints. null = transparent.
  setBackground(hexOrNull) {
    this.globalBg = hexOrNull;
  }

  // SETSCREENBACKGROUND - the field. Not stored per cell: one inline CSS background
  // that shows through wherever a cell's bg is null. Must repaint itself, since it
  // changes no cell.
  setScreenBackground(hexOrNull) {
    this.screenBg = hexOrNull;
    if (this.el) this.el.style.background = hexOrNull || '';
    this.render();
  }

  // Overwrite a cell's character while preserving whatever background is under it.
  // Used by INPUT$ and the REPL, which would otherwise punch holes in a colored field.
  setCellChar(row, col, ch, color) {
    const rowCells = this.buffer[row];
    if (!rowCells) return;
    const cell = rowCells[col];
    if (!cell) return;
    cell.char = ch;
    cell.color = color || this.globalColor;
  }

  scroll() {
    const buf = this._activeTextBuffer;
    buf.shift();
    const row = [];
    for (let c = 0; c < this.cols; c++) {
      row.push(makeCell(' ', this.globalColor));
    }
    buf.push(row);
  }

  advanceCursor() {
    this.cursorCol++;
    if (this.cursorCol >= this.cols) {
      this.cursorCol = 0;
      this.cursorRow++;
    }
    if (this.cursorRow >= this.rows) {
      this.scroll();
      this.cursorRow = this.rows - 1;
    }
  }

  newline() {
    this.cursorCol = 0;
    this.cursorRow++;
    if (this.cursorRow >= this.rows) {
      this.scroll();
      this.cursorRow = this.rows - 1;
    }
  }

  writeChar(ch, color, bg) {
    const c = color || this.globalColor;
    const b = bg === undefined ? this.globalBg : bg;
    if (ch === '\n') {
      this.newline();
      return;
    }
    const buf = this._activeTextBuffer;
    if (this.cursorRow < this.rows && this.cursorCol < this.cols) {
      buf[this.cursorRow][this.cursorCol] = makeCell(ch, c, b);
    }
    this.advanceCursor();
  }

  print(text, color, bg) {
    const str = String(text);
    for (const ch of str) {
      this.writeChar(ch, color, bg);
    }
    this.newline();
  }

  printInline(text, color, bg) {
    const str = String(text);
    for (const ch of str) {
      this.writeChar(ch, color, bg);
    }
  }

  moveCursor(row, col) {
    const r = row - 1;
    const c = col - 1;
    if (r >= 0 && r < this.rows) this.cursorRow = r;
    if (c >= 0 && c < this.cols) this.cursorCol = c;
  }

  printAt(row, col, text, color, bg) {
    const r = row - 1;
    const c = col - 1;
    if (r < 0 || r >= this.rows || c < 0) return;
    const clr = color || this.globalColor;
    const bgc = bg === undefined ? this.globalBg : bg;
    const str = String(text);
    const buf = this._activeTextBuffer;
    let writeCol = c;
    for (const ch of str) {
      if (writeCol >= this.cols) break;
      buf[r][writeCol] = makeCell(ch, clr, bgc);
      writeCol++;
    }
    this.cursorRow = r;
    this.cursorCol = Math.min(writeCol, this.cols - 1);
  }

  _doRender() {
    const lines = [];
    for (let r = 0; r < this.rows; r++) {
      let line = '';
      let i = 0;
      while (i < this.cols) {
        const cell = this.buffer[r][i];
        const color = cell.color;
        const bg = cell.bg;
        let run = '';
        while (i < this.cols &&
               this.buffer[r][i].color === color &&
               this.buffer[r][i].bg === bg) {
          run += this.escapeHtml(this.buffer[r][i].char);
          i++;
        }
        if (color === DEFAULT_COLOR && bg === null) {
          line += run;
        } else {
          let style = '';
          if (color !== DEFAULT_COLOR) style += `color:${color};`;
          if (bg !== null) style += `background-color:${bg};`;
          line += `<span style="${style}">${run}</span>`;
        }
      }
      lines.push(line);
    }
    this.el.innerHTML = lines.join('\n');
  }

  // "The screen changed." Cheap and idempotent: at most one rebuild per frame,
  // however many times this is called. The browser only paints when JavaScript
  // yields, so rebuilding on every write just discarded work nobody saw.
  render() {
    if (this.bufferEnabled) return;
    this._scheduleRender();
  }

  _scheduleRender() {
    if (this._renderPending) return;
    if (typeof requestAnimationFrame !== 'function') {
      this._doRender();
      return;
    }
    this._renderPending = true;
    const flush = () => {
      this._renderPending = false;
      this._renderFrame = null;
      this._doRender();
    };
    // Browsers pause requestAnimationFrame in hidden tabs. Frames are deferred,
    // not dropped, so the screen would still catch up on return - but until then
    // the DOM would not reflect the buffer, which is a surprising contract for
    // anything reading the screen. Fall back to a timer while hidden.
    if (typeof document !== 'undefined' && document.hidden) {
      this._renderFrame = null;
      setTimeout(flush, 0);
      return;
    }
    this._renderFrame = requestAnimationFrame(flush);
  }

  // "The screen must be correct right now." Cancels any pending frame so the
  // rebuild happens once, not twice.
  renderNow() {
    if (this._renderPending && this._renderFrame !== null &&
        typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._renderFrame);
    }
    this._renderPending = false;
    this._renderFrame = null;
    this._doRender();
  }

  escapeHtml(ch) {
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '&') return '&amp;';
    return ch;
  }

  // --- Drawing methods ---

  drawPixel(x, y) {
    this._ensureGraphics();
    const ctx = this._activeCtx;
    ctx.fillStyle = this.globalColor;
    ctx.fillRect(x, y, 1, 1);
  }

  drawLine(x1, y1, x2, y2) {
    this._ensureGraphics();
    const ctx = this._activeCtx;
    ctx.strokeStyle = this.globalColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1 + 0.5, y1 + 0.5);
    ctx.lineTo(x2 + 0.5, y2 + 0.5);
    ctx.stroke();
  }

  drawBox(x1, y1, x2, y2, fill) {
    this._ensureGraphics();
    const ctx = this._activeCtx;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    if (fill) {
      ctx.fillStyle = this.globalColor;
      ctx.fillRect(left, top, w, h);
    } else {
      ctx.strokeStyle = this.globalColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, w, h);
    }
  }

  drawCircle(x, y, radius, fill) {
    this._ensureGraphics();
    const ctx = this._activeCtx;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = this.globalColor;
      ctx.fill();
    } else {
      ctx.strokeStyle = this.globalColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  drawPath(points, fill, close) {
    this._ensureGraphics();
    const ctx = this._activeCtx;
    ctx.beginPath();
    ctx.moveTo(points[0][0] + 0.5, points[0][1] + 0.5);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0] + 0.5, points[i][1] + 0.5);
    }
    if (fill || close) {
      ctx.closePath();
    }
    if (fill) {
      ctx.fillStyle = this.globalColor;
      ctx.fill();
    }
    ctx.strokeStyle = this.globalColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  createSprite(data2D) {
    if (!Array.isArray(data2D) || data2D.length === 0) {
      throw new Error('CREATESPRITE: DATA must be a non-empty 2D array');
    }
    const height = data2D.length;
    const width = Array.isArray(data2D[0]) ? data2D[0].length : 0;
    if (width === 0) {
      throw new Error('CREATESPRITE: DATA rows must be non-empty arrays');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    for (let r = 0; r < height; r++) {
      const row = data2D[r];
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell === 0 || cell === null || cell === undefined) continue;
        // Numeric palette index (1-256): look up VGA_PALETTE
        if (typeof cell === 'number') {
          const idx = Math.round(cell) - 1;
          if (idx >= 0 && idx < VGA_PALETTE.length) {
            const [pr, pg, pb] = VGA_PALETTE[idx];
            ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
            ctx.fillRect(c, r, 1, 1);
          }
          continue;
        }
        // Color struct with r#, g#, b# (and optional a#) keys
        if (typeof cell === 'object' && cell !== null) {
          const red = cell['r#'] !== undefined ? cell['r#'] : (cell['R#'] !== undefined ? cell['R#'] : 0);
          const green = cell['g#'] !== undefined ? cell['g#'] : (cell['G#'] !== undefined ? cell['G#'] : 0);
          const blue = cell['b#'] !== undefined ? cell['b#'] : (cell['B#'] !== undefined ? cell['B#'] : 0);
          const alpha = cell['a#'] !== undefined ? cell['a#'] : (cell['A#'] !== undefined ? cell['A#'] : 255);
          ctx.fillStyle = `rgba(${red},${green},${blue},${alpha / 255})`;
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }

    const id = this.nextSpriteId++;
    this.sprites[id] = { canvas, width, height };
    return id;
  }

  drawSprite(id, x, y, opts = {}) {
    this._ensureGraphics();
    const sprite = this.sprites[id];
    if (!sprite) throw new Error(`Sprite ${id} not found`);
    const ctx = this._activeCtx;
    const { flipH = false, flipV = false, scaleX = 1, scaleY = 1, angle = 0 } = opts;

    const w = sprite.width * scaleX;
    const h = sprite.height * scaleY;
    const needsTransform = flipH || flipV || angle !== 0;

    if (needsTransform) {
      ctx.save();
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.translate(cx, cy);
      if (angle !== 0) {
        ctx.rotate(angle * Math.PI / 180);
      }
      if (flipH || flipV) {
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      }
      ctx.drawImage(sprite.canvas, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else if (scaleX !== 1 || scaleY !== 1) {
      ctx.drawImage(sprite.canvas, x, y, w, h);
    } else {
      ctx.drawImage(sprite.canvas, x, y);
    }
  }

  showError(message) {
    this.clear();
    this.globalColor = '#FF5555';
    this.print(message);
    this.globalColor = DEFAULT_COLOR;
    this.render();
  }
}
