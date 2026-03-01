const DEFAULT_COLOR = '#AAAAAA';

const COLS = 80;
const ROWS = 25;

class Screen {
  constructor(el) {
    this.el = el;
    this.cols = COLS;
    this.rows = ROWS;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.globalColor = DEFAULT_COLOR;
    this.buffer = [];

    // Graphics state
    this.graphicsEnabled = false;
    this.bufferEnabled = false;
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
        row.push({ char: ' ', color: DEFAULT_COLOR });
      }
      buf.push(row);
    }
    return buf;
  }

  clear() {
    this.globalColor = DEFAULT_COLOR;
    this.buffer = this._makeEmptyTextBuffer();
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.resetGraphics();
    this.render();
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
    }
    if (!this.backCanvas) {
      this.backCanvas = document.createElement('canvas');
      this.backCanvas.width = 640;
      this.backCanvas.height = 480;
      this.backCtx = this.backCanvas.getContext('2d');
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
          this.buffer[r][c] = {
            char: this.backTextBuffer[r][c].char,
            color: this.backTextBuffer[r][c].color,
          };
        }
      }
    }
    this._doRender();
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

  scroll() {
    const buf = this._activeTextBuffer;
    buf.shift();
    const row = [];
    for (let c = 0; c < this.cols; c++) {
      row.push({ char: ' ', color: this.globalColor });
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

  writeChar(ch, color) {
    const c = color || this.globalColor;
    if (ch === '\n') {
      this.newline();
      return;
    }
    const buf = this._activeTextBuffer;
    if (this.cursorRow < this.rows && this.cursorCol < this.cols) {
      buf[this.cursorRow][this.cursorCol] = { char: ch, color: c };
    }
    this.advanceCursor();
  }

  print(text, color) {
    const str = String(text);
    for (const ch of str) {
      this.writeChar(ch, color);
    }
    this.newline();
  }

  printInline(text, color) {
    const str = String(text);
    for (const ch of str) {
      this.writeChar(ch, color);
    }
  }

  moveCursor(row, col) {
    const r = row - 1;
    const c = col - 1;
    if (r >= 0 && r < this.rows) this.cursorRow = r;
    if (c >= 0 && c < this.cols) this.cursorCol = c;
  }

  printAt(row, col, text, color) {
    const r = row - 1;
    const c = col - 1;
    if (r < 0 || r >= this.rows || c < 0) return;
    const clr = color || this.globalColor;
    const str = String(text);
    const buf = this._activeTextBuffer;
    let writeCol = c;
    for (const ch of str) {
      if (writeCol >= this.cols) break;
      buf[r][writeCol] = { char: ch, color: clr };
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
        let run = '';
        while (i < this.cols && this.buffer[r][i].color === color) {
          run += this.escapeHtml(this.buffer[r][i].char);
          i++;
        }
        if (color === DEFAULT_COLOR) {
          line += run;
        } else {
          line += `<span style="color:${color}">${run}</span>`;
        }
      }
      lines.push(line);
    }
    this.el.innerHTML = lines.join('\n');
  }

  render() {
    if (this.bufferEnabled) return;
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
        // cell should be a color struct with r#, g#, b# keys
        if (typeof cell === 'object' && cell !== null) {
          const red = cell['r#'] !== undefined ? cell['r#'] : (cell['R#'] !== undefined ? cell['R#'] : 0);
          const green = cell['g#'] !== undefined ? cell['g#'] : (cell['G#'] !== undefined ? cell['G#'] : 0);
          const blue = cell['b#'] !== undefined ? cell['b#'] : (cell['B#'] !== undefined ? cell['B#'] : 0);
          ctx.fillStyle = `rgb(${red},${green},${blue})`;
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }

    const id = this.nextSpriteId++;
    this.sprites[id] = { canvas, width, height };
    return id;
  }

  drawSprite(id, x, y) {
    this._ensureGraphics();
    const sprite = this.sprites[id];
    if (!sprite) throw new Error(`Sprite ${id} not found`);
    const ctx = this._activeCtx;
    ctx.drawImage(sprite.canvas, x, y);
  }

  showError(message) {
    this.clear();
    this.globalColor = '#FF5555';
    this.print(message);
    this.globalColor = DEFAULT_COLOR;
    this.render();
  }
}
