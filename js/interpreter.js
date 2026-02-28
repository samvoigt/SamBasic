class GotoSignal {
  constructor(label) {
    this.label = label;
  }
}

class Interpreter {
  constructor(screen, audio) {
    this.screen = screen;
    this.audio = audio;
    this.reset();

    // Key state for GETKEY
    this.currentKey = '';
    this._keydownHandler = (e) => { this.currentKey = e.key; };
    this._keyupHandler = () => { this.currentKey = ''; };
    document.addEventListener('keydown', this._keydownHandler);
    document.addEventListener('keyup', this._keyupHandler);
  }

  reset() {
    this.ast = [];
    this.labels = {};
    this.dataPool = [];
    this.dataPointer = 0;
    this.numVars = {};
    this.strVars = {};
    this.arrVars = {};
    this.structVars = {};
    this._initBuiltinColors();
    this.pc = 0;
    this.running = false;
    this.paused = false;
    this.stepping = false;
    this._pauseResolve = null;
    this._inputResolve = null;
    this._inputBuffer = '';
    this._inputHandler = null;
    this._stmtCount = 0;
  }

  _initBuiltinColors() {
    const colors = {
      BLACK:        [0, 0, 0],
      BLUE:         [0, 0, 170],
      GREEN:        [0, 170, 0],
      CYAN:         [0, 170, 170],
      RED:          [170, 0, 0],
      MAGENTA:      [170, 0, 170],
      BROWN:        [170, 85, 0],
      LIGHTGRAY:    [170, 170, 170],
      DARKGRAY:     [85, 85, 85],
      LIGHTBLUE:    [85, 85, 255],
      LIGHTGREEN:   [85, 255, 85],
      LIGHTCYAN:    [85, 255, 255],
      LIGHTRED:     [255, 85, 85],
      LIGHTMAGENTA: [255, 85, 255],
      YELLOW:       [255, 255, 85],
      WHITE:        [255, 255, 255],
    };
    for (const [name, [r, g, b]] of Object.entries(colors)) {
      this.structVars[name] = { 'red#': r, 'green#': g, 'blue#': b };
    }
  }

  _colorStructToHex(obj, line) {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error(`SETCOLOR/WITHCOLOR requires a color struct with .red#, .green#, .blue# members${line ? ' at line ' + line : ''}`);
    }
    const r = Math.max(0, Math.min(255, Math.floor(obj['red#'] || 0)));
    const g = Math.max(0, Math.min(255, Math.floor(obj['green#'] || 0)));
    const b = Math.max(0, Math.min(255, Math.floor(obj['blue#'] || 0)));
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
  }

  load(ast, dataPool, labels) {
    this.reset();
    this.ast = ast;
    this.dataPool = dataPool;
    this.labels = labels;
  }

  async run() {
    this.running = true;
    this.paused = false;
    this.screen.clear();
    this.pc = 0;
    this._stmtCount = 0;

    try {
      while (this.running && this.pc < this.ast.length) {
        if (this.paused) {
          await new Promise(resolve => { this._pauseResolve = resolve; });
          if (!this.running) break;
        }

        const stmt = this.ast[this.pc];
        this.pc++;

        try {
          await this.execStmt(stmt);
        } catch (e) {
          if (e instanceof GotoSignal) {
            const target = this.labels[e.label];
            if (target === undefined) {
              throw new Error(`Undefined label '${e.label}$' at line ${stmt.line}`);
            }
            this.pc = target;
            continue;
          }
          throw e;
        }

        this._stmtCount++;
        if (this._stmtCount % 100 === 0) {
          await this.yieldToEventLoop();
        }

        if (this.stepping) {
          this.paused = true;
          this.stepping = false;
        }
      }
    } catch (e) {
      this.screen.showError(`ERROR: ${e.message}`);
    }

    this.running = false;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (this._pauseResolve) {
      this.paused = false;
      this._pauseResolve();
      this._pauseResolve = null;
    }
  }

  step() {
    this.stepping = true;
    this.resume();
  }

  stop() {
    this.running = false;
    this.paused = false;
    if (this.audio) this.audio.stopAll();
    if (this._pauseResolve) {
      this._pauseResolve();
      this._pauseResolve = null;
    }
    if (this._inputHandler) {
      document.removeEventListener('keydown', this._inputHandler);
      this._inputHandler = null;
    }
    if (this._inputResolve) {
      this._inputResolve(null);
      this._inputResolve = null;
    }
  }

  yieldToEventLoop() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  // Evaluate expression AST node
  evalExpr(node) {
    switch (node.type) {
      case 'number': return node.value;
      case 'string': return node.value;
      case 'numvar': return this.numVars[node.name] ?? 0;
      case 'strvar': return this.strVars[node.name] ?? '';
      case 'arrvar': return this.arrVars[node.name] ?? [];
      case 'structvar': return this.structVars[node.name] ?? {};
      case 'structmember': {
        const struct = this.structVars[node.structName];
        if (!struct) throw new Error(`Struct ${node.structName}& not initialized`);
        const key = node.memberName + node.memberSuffix;
        if (!(key in struct)) throw new Error(`Member .${key} not found in ${node.structName}&`);
        return struct[key];
      }
      case 'arrindex': {
        const arr = this.arrVars[node.name];
        if (!arr) throw new Error(`Array ${node.name}@ not initialized`);
        if (node.indices.length === 1) {
          const idx = Math.floor(this.evalExpr(node.indices[0])) - 1; // 1-indexed to 0-indexed
          if (idx < 0 || idx >= arr.length) throw new Error(`Array index out of bounds: ${idx + 1}`);
          return arr[idx];
        } else if (node.indices.length === 2) {
          const i = Math.floor(this.evalExpr(node.indices[0])) - 1;
          const j = Math.floor(this.evalExpr(node.indices[1])) - 1;
          if (!arr[i]) throw new Error(`Array index out of bounds: ${i + 1}`);
          return arr[i][j];
        }
        throw new Error(`Too many array dimensions`);
      }
      case 'binop': return this.evalBinop(node);
      case 'unaryop': return this.evalUnary(node);
      default:
        throw new Error(`Unknown expression type: ${node.type}`);
    }
  }

  evalBinop(node) {
    const left = this.evalExpr(node.left);
    const right = this.evalExpr(node.right);

    switch (node.op) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left) + String(right);
        }
        return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/':
        if (right === 0) throw new Error('Division by zero');
        return left / right;
      case '%':
        if (right === 0) throw new Error('Division by zero');
        return left % right;
      case '^': return Math.pow(left, right);
      case '=':
        return (left === right) ? 1 : 0;
      case '<>': return (left !== right) ? 1 : 0;
      case '<': return (left < right) ? 1 : 0;
      case '>': return (left > right) ? 1 : 0;
      case '<=': return (left <= right) ? 1 : 0;
      case '>=': return (left >= right) ? 1 : 0;
      case 'AND': return (left && right) ? 1 : 0;
      case 'OR': return (left || right) ? 1 : 0;
      default:
        throw new Error(`Unknown operator: ${node.op}`);
    }
  }

  evalUnary(node) {
    const val = this.evalExpr(node.expr);
    switch (node.op) {
      case '-': return -val;
      case 'NOT': return val ? 0 : 1;
      default:
        throw new Error(`Unknown unary operator: ${node.op}`);
    }
  }

  // Execute a statement
  async execStmt(stmt) {
    switch (stmt.type) {
      case 'print': {
        const val = this.evalExpr(stmt.expr);
        let color = null;
        if (stmt.withColor) {
          color = this._colorStructToHex(this.evalExpr(stmt.withColor), stmt.line);
        }
        this.screen.print(val, color);
        this.screen.render();
        break;
      }
      case 'printat': {
        const row = Math.floor(this.evalExpr(stmt.row));
        const col = Math.floor(this.evalExpr(stmt.col));
        const val = this.evalExpr(stmt.expr);
        let color = null;
        if (stmt.withColor) {
          color = this._colorStructToHex(this.evalExpr(stmt.withColor), stmt.line);
        }
        this.screen.printAt(row, col, val, color);
        this.screen.render();
        break;
      }
      case 'clearscreen': {
        this.screen.clear();
        break;
      }
      case 'input': {
        const promptText = this.evalExpr(stmt.prompt);
        this.screen.printInline(promptText);
        this.screen.render();
        const result = await this.waitForInput();
        if (result === null) return; // stopped
        if (stmt.varType === 'number') {
          const num = parseFloat(result);
          if (isNaN(num)) throw new Error(`INPUT: expected a number, got '${result}' at line ${stmt.line}`);
          this.numVars[stmt.varName] = num;
        } else {
          this.strVars[stmt.varName] = result;
        }
        break;
      }
      case 'getkey': {
        this.strVars[stmt.varName] = this.currentKey;
        break;
      }
      case 'random': {
        const n = this.numVars[stmt.varName] ?? 0;
        this.numVars[stmt.varName] = Math.floor(Math.random() * (Math.floor(n) + 1));
        break;
      }
      case 'label': {
        // no-op at runtime; labels are resolved at parse time
        break;
      }
      case 'goto': {
        throw new GotoSignal(stmt.label);
      }
case 'if': {
        const cond = this.evalExpr(stmt.condition);
        if (cond) {
          await this.execBlock(stmt.thenBody);
        } else if (stmt.elseBody) {
          await this.execBlock(stmt.elseBody);
        }
        break;
      }
      case 'for': {
        const lower = Math.floor(this.evalExpr(stmt.lower));
        const upper = Math.floor(this.evalExpr(stmt.upper));
        const step = stmt.step ? Math.floor(this.evalExpr(stmt.step)) : 1;
        if (step === 0) throw new Error(`FOR loop step cannot be 0 at line ${stmt.line}`);

        for (let i = lower; step > 0 ? i <= upper : i >= upper; i += step) {
          if (!this.running) break;
          if (stmt.varName) this.numVars[stmt.varName] = i;
          await this.execBlock(stmt.body);

          this._stmtCount++;
          if (this._stmtCount % 100 === 0) {
            await this.yieldToEventLoop();
          }
          if (this.paused) {
            await new Promise(resolve => { this._pauseResolve = resolve; });
            if (!this.running) break;
          }
        }
        break;
      }
      case 'while': {
        while (this.running && this.evalExpr(stmt.condition)) {
          await this.execBlock(stmt.body);

          this._stmtCount++;
          if (this._stmtCount % 100 === 0) {
            await this.yieldToEventLoop();
          }
          if (this.paused) {
            await new Promise(resolve => { this._pauseResolve = resolve; });
            if (!this.running) break;
          }
        }
        break;
      }
      case 'setcolor': {
        const colorVal = this.evalExpr(stmt.expr);
        this.screen.setColor(this._colorStructToHex(colorVal, stmt.line));
        break;
      }
      case 'beep': {
        if (this.audio) await this.audio.beep();
        break;
      }
      case 'play': {
        if (this.audio) {
          const musicStr = String(this.evalExpr(stmt.expr));
          const waveType = stmt.waveType || 'square';
          if (stmt.inBackground) {
            this.audio.playSequenceBg(musicStr, waveType, stmt.onRepeat);
          } else if (stmt.onRepeat) {
            while (this.running) {
              await this.audio.playSequence(musicStr, waveType);
            }
          } else {
            await this.audio.playSequence(musicStr, waveType);
          }
        }
        break;
      }
      case 'playpoly': {
        if (this.audio) {
          const voices = stmt.voices.map(v => ({
            musicStr: String(this.evalExpr(v.expr)),
            waveType: v.waveType,
          }));
          if (stmt.inBackground) {
            this.audio.playPolyBg(voices, stmt.onRepeat);
          } else if (stmt.onRepeat) {
            while (this.running) {
              await this.audio.playPoly(voices);
            }
          } else {
            await this.audio.playPoly(voices);
          }
        }
        break;
      }
      case 'pauseplay': {
        if (this.audio) this.audio.pauseBackground();
        break;
      }
      case 'resumeplay': {
        if (this.audio) this.audio.resumeBackground();
        break;
      }
      case 'stopplay': {
        if (this.audio) this.audio.stopBackground();
        break;
      }
      case 'data': {
        // no-op at runtime; data is collected at parse time
        break;
      }
      case 'read': {
        if (this.dataPointer >= this.dataPool.length) {
          throw new Error(`READ: no more DATA at line ${stmt.line}`);
        }
        let val = this.dataPool[this.dataPointer++];
        // If val is an AST node (expression), evaluate it
        if (val && typeof val === 'object' && val.type) {
          val = this.evalExpr(val);
        }
        if (stmt.varType === 'number') {
          this.numVars[stmt.varName] = typeof val === 'number' ? val : parseFloat(val);
        } else {
          this.strVars[stmt.varName] = String(val);
        }
        break;
      }
      case 'assign_num': {
        this.numVars[stmt.name] = this.evalExpr(stmt.value);
        break;
      }
      case 'assign_str': {
        this.strVars[stmt.name] = String(this.evalExpr(stmt.value));
        break;
      }
      case 'assign_struct': {
        const obj = {};
        for (const m of stmt.members) {
          obj[m.name + m.suffix] = this.evalExpr(m.value);
        }
        this.structVars[stmt.name] = obj;
        break;
      }
      case 'assign_struct_member': {
        if (!this.structVars[stmt.name]) {
          this.structVars[stmt.name] = {};
        }
        this.structVars[stmt.name][stmt.memberName + stmt.memberSuffix] = this.evalExpr(stmt.value);
        break;
      }
      case 'assign_arr_alloc': {
        const size = Math.floor(this.evalExpr(stmt.size));
        this.arrVars[stmt.name] = new Array(size).fill(0);
        break;
      }
      case 'assign_arr_alloc2d': {
        const rows = Math.floor(this.evalExpr(stmt.size1));
        const cols = Math.floor(this.evalExpr(stmt.size2));
        const arr = [];
        for (let r = 0; r < rows; r++) {
          arr.push(new Array(cols).fill(0));
        }
        this.arrVars[stmt.name] = arr;
        break;
      }
      case 'assign_arr_literal': {
        this.arrVars[stmt.name] = stmt.items.map(item => this.evalExpr(item));
        break;
      }
      case 'assign_arr_multi': {
        this.arrVars[stmt.name] = stmt.dimensions.map(dim =>
          dim.map(item => this.evalExpr(item))
        );
        break;
      }
      case 'assign_arr_index': {
        const arr = this.arrVars[stmt.name];
        if (!arr) throw new Error(`Array ${stmt.name}@ not initialized at line ${stmt.line}`);
        const val = this.evalExpr(stmt.value);
        if (stmt.indices.length === 1) {
          const idx = Math.floor(this.evalExpr(stmt.indices[0])) - 1;
          if (idx < 0 || idx >= arr.length) throw new Error(`Array index out of bounds at line ${stmt.line}`);
          arr[idx] = val;
        } else if (stmt.indices.length === 2) {
          const i = Math.floor(this.evalExpr(stmt.indices[0])) - 1;
          const j = Math.floor(this.evalExpr(stmt.indices[1])) - 1;
          if (!arr[i]) throw new Error(`Array index out of bounds at line ${stmt.line}`);
          arr[i][j] = val;
        }
        break;
      }
      default:
        throw new Error(`Unknown statement type: ${stmt.type}`);
    }
  }

  async execBlock(stmts) {
    for (let i = 0; i < stmts.length; i++) {
      if (!this.running) break;

      if (this.paused) {
        await new Promise(resolve => { this._pauseResolve = resolve; });
        if (!this.running) break;
      }

      try {
        await this.execStmt(stmts[i]);
      } catch (e) {
        if (e instanceof GotoSignal) throw e; // propagate to main loop
        throw e;
      }

      this._stmtCount++;
      if (this._stmtCount % 100 === 0) {
        await this.yieldToEventLoop();
      }

      if (this.stepping) {
        this.paused = true;
        this.stepping = false;
      }
    }
  }

  async waitForInput() {
    return new Promise(resolve => {
      this._inputResolve = resolve;
      this._inputBuffer = '';

      // Show blinking cursor
      const cursorRow = this.screen.cursorRow;
      const cursorStartCol = this.screen.cursorCol;
      this._showInputCursor(cursorRow, cursorStartCol);

      const cleanup = () => {
        document.removeEventListener('keydown', handler);
        this._inputHandler = null;
        this._inputResolve = null;
      };

      const handler = (e) => {
        if (!this.running) {
          cleanup();
          resolve(null);
          return;
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          cleanup();
          // Clear cursor
          this._clearInputCursor(cursorRow, cursorStartCol + this._inputBuffer.length);
          this.screen.newline();
          this.screen.render();
          resolve(this._inputBuffer);
          return;
        }

        if (e.key === 'Backspace') {
          e.preventDefault();
          if (this._inputBuffer.length > 0) {
            this._inputBuffer = this._inputBuffer.slice(0, -1);
            // Clear the character
            const col = cursorStartCol + this._inputBuffer.length;
            this.screen.buffer[cursorRow][col] = { char: ' ', color: this.screen.globalColor };
            this._showInputCursor(cursorRow, col);
            this.screen.render();
          }
          return;
        }

        if (e.key.length === 1) {
          e.preventDefault();
          const col = cursorStartCol + this._inputBuffer.length;
          if (col < this.screen.cols - 1) {
            this._inputBuffer += e.key;
            this.screen.buffer[cursorRow][col] = { char: e.key, color: this.screen.globalColor };
            this._showInputCursor(cursorRow, col + 1);
            this.screen.render();
          }
        }
      };

      this._inputHandler = handler;
      document.addEventListener('keydown', handler);
    });
  }

  _showInputCursor(row, col) {
    if (col < this.screen.cols) {
      this.screen.buffer[row][col] = { char: '\u2588', color: this.screen.globalColor };
      this.screen.render();
    }
  }

  _clearInputCursor(row, col) {
    if (col < this.screen.cols) {
      this.screen.buffer[row][col] = { char: ' ', color: this.screen.globalColor };
    }
  }

  destroy() {
    document.removeEventListener('keydown', this._keydownHandler);
    document.removeEventListener('keyup', this._keyupHandler);
  }
}
