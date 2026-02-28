const EGA_COLORS = {
  BLACK:        '#000000',
  BLUE:         '#0000AA',
  GREEN:        '#00AA00',
  CYAN:         '#00AAAA',
  RED:          '#AA0000',
  MAGENTA:      '#AA00AA',
  BROWN:        '#AA5500',
  LIGHTGRAY:    '#AAAAAA',
  DARKGRAY:     '#555555',
  LIGHTBLUE:    '#5555FF',
  LIGHTGREEN:   '#55FF55',
  LIGHTCYAN:    '#55FFFF',
  LIGHTRED:     '#FF5555',
  LIGHTMAGENTA: '#FF55FF',
  YELLOW:       '#FFFF55',
  WHITE:        '#FFFFFF',
};

const COLOR_NAMES = Object.keys(EGA_COLORS);

const COLS = 80;
const ROWS = 25;

class Screen {
  constructor(el) {
    this.el = el;
    this.cols = COLS;
    this.rows = ROWS;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.globalColor = 'LIGHTGRAY';
    this.buffer = [];
    this.clear();
  }

  clear() {
    this.buffer = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        row.push({ char: ' ', color: this.globalColor });
      }
      this.buffer.push(row);
    }
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.render();
  }

  setColor(colorName) {
    const upper = colorName.toUpperCase();
    if (EGA_COLORS[upper]) {
      this.globalColor = upper;
    }
  }

  scroll() {
    this.buffer.shift();
    const row = [];
    for (let c = 0; c < this.cols; c++) {
      row.push({ char: ' ', color: this.globalColor });
    }
    this.buffer.push(row);
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
    if (this.cursorRow < this.rows && this.cursorCol < this.cols) {
      this.buffer[this.cursorRow][this.cursorCol] = { char: ch, color: c };
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

  printAt(row, col, text, color) {
    // 1-based to 0-based
    const r = row - 1;
    const c = col - 1;
    if (r < 0 || r >= this.rows || c < 0) return;
    this.cursorRow = r;
    this.cursorCol = c;
    const str = String(text);
    for (const ch of str) {
      this.writeChar(ch, color);
    }
  }

  render() {
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
        if (color === 'LIGHTGRAY') {
          line += run;
        } else {
          line += `<span class="c-${color}" style="color:${EGA_COLORS[color]}">${run}</span>`;
        }
      }
      lines.push(line);
    }
    this.el.innerHTML = lines.join('\n');
  }

  escapeHtml(ch) {
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '&') return '&amp;';
    return ch;
  }

  showError(message) {
    this.clear();
    this.globalColor = 'LIGHTRED';
    this.print(message);
    this.globalColor = 'LIGHTGRAY';
    this.render();
  }
}

