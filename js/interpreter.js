class GotoSignal {
  constructor(label) {
    this.label = label;
  }
}

class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}

class BreakSignal {}
class ContinueSignal {}

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
    this.numVars = {};
    this.strVars = {};
    this.arrVars = {};
    this.structVars = {};
    this.boolVars = {};
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
    this.functions = {};
    this.callStack = [];
    this.MAX_RECURSION_DEPTH = 256;
    this.fileHandles = {};
    this.nextFileHandle = 1;
    this.warnedVars = new Set();
    this.scene3d = null;
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
      this.structVars[name] = { 'r#': r, 'g#': g, 'b#': b };
    }
  }

  _ensureScene3D() {
    if (!this.scene3d) this.scene3d = new Scene3D();
    return this.scene3d;
  }

  _renderScene3D() {
    if (!this.scene3d) return;
    this.screen._ensureGraphics();
    this.scene3d.render(
      (x1, y1, x2, y2, color) => {
        const ctx = this.screen._activeCtx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, y1 + 0.5);
        ctx.lineTo(x2 + 0.5, y2 + 0.5);
        ctx.stroke();
      },
      (x, y, color) => {
        const ctx = this.screen._activeCtx;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    );
  }

  async _evalObject3DParams(params, line) {
    const result = {};
    for (const key in params) {
      result[key.toLowerCase()] = Number(await this.evalExpr(params[key]));
    }
    return result;
  }

  async _evalPathPoints(params, line) {
    const pointsExpr = params.POINTS;
    if (!pointsExpr) throw new Error(`PATH requires POINTS parameter at line ${line}`);
    const pointsArr = await this.evalExpr(pointsExpr);
    if (!Array.isArray(pointsArr)) throw new Error(`PATH POINTS must be an array at line ${line}`);
    if (pointsArr.length < 2) throw new Error(`PATH requires at least 2 points at line ${line}`);
    return pointsArr.map((p, i) => {
      if (!Array.isArray(p) || p.length < 3) {
        throw new Error(`PATH point ${i + 1} must be [x, y, z] at line ${line}`);
      }
      return [Number(p[0]), Number(p[1]), Number(p[2])];
    });
  }

  _colorStructToHex(obj, line) {
    if (typeof obj !== 'object' || obj === null) {
      throw new Error(`SETCOLOR/COLOR requires a color struct with .r#, .g#, .b# members${line ? ' at line ' + line : ''}`);
    }
    const r = Math.max(0, Math.min(255, Math.floor(obj['r#'] || 0)));
    const g = Math.max(0, Math.min(255, Math.floor(obj['g#'] || 0)));
    const b = Math.max(0, Math.min(255, Math.floor(obj['b#'] || 0)));
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
  }

  load(ast, labels, functions) {
    this.reset();
    this.ast = ast;
    this.labels = labels;
    this.functions = functions || {};
  }

  async run() {
    this.running = true;
    this.paused = false;
    this.screen.clear();
    this.pc = 0;
    this._stmtCount = 0;
    this._startTime = performance.now();

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
              throw new Error(`Undefined label '${e.label}' at line ${stmt.line}`);
            }
            this.pc = target;
            continue;
          }
          if (e instanceof BreakSignal) {
            throw new Error(`BREAK used outside of a loop at line ${stmt.line}`);
          }
          if (e instanceof ContinueSignal) {
            throw new Error(`CONTINUE used outside of a loop at line ${stmt.line}`);
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

    this._closeAllFiles();
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
    this._closeAllFiles();
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

  _closeAllFiles() {
    for (const handle of Object.keys(this.fileHandles)) {
      const fh = this.fileHandles[handle];
      if (fh.mode === 'write' || fh.mode === 'append') {
        localStorage.setItem('sambasic_file:' + fh.name, fh.content);
      }
    }
    this.fileHandles = {};
  }

  yieldToEventLoop() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  // Evaluate expression AST node
  async evalExpr(node) {
    switch (node.type) {
      case 'number': return node.value;
      case 'string': return node.value;
      case 'boolean': return node.value;
      case 'numvar':
        if (!(node.name in this.numVars)) {
          this._warnUninitialized(node.name, '#', '0');
          return 0;
        }
        return this.numVars[node.name];
      case 'strvar':
        if (!(node.name in this.strVars)) {
          this._warnUninitialized(node.name, '$', '""');
          return '';
        }
        return this.strVars[node.name];
      case 'boolvar':
        if (!(node.name in this.boolVars)) {
          this._warnUninitialized(node.name, '?', 'NO');
          return 0;
        }
        return this.boolVars[node.name];
      case 'arrvar':
        if (!(node.name in this.arrVars)) {
          this._warnUninitialized(node.name, '@', '[]');
          return [];
        }
        return this.arrVars[node.name];
      case 'structvar':
        if (!(node.name in this.structVars)) {
          this._warnUninitialized(node.name, '&', '{}');
          return {};
        }
        return this.structVars[node.name];
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
          const idx = Math.floor(await this.evalExpr(node.indices[0])) - 1; // 1-indexed to 0-indexed
          if (idx < 0 || idx >= arr.length) throw new Error(`Array index out of bounds: ${idx + 1}`);
          return arr[idx];
        } else if (node.indices.length === 2) {
          const i = Math.floor(await this.evalExpr(node.indices[0])) - 1;
          const j = Math.floor(await this.evalExpr(node.indices[1])) - 1;
          if (!arr[i]) throw new Error(`Array index out of bounds: ${i + 1}`);
          return arr[i][j];
        }
        throw new Error(`Too many array dimensions`);
      }
      case 'binop': return await this.evalBinop(node);
      case 'unaryop': return await this.evalUnary(node);
      case 'funccall': return await this.execFunctionCall(node, node.line);
      case 'endoffile': {
        const handle = await this.evalExpr(node.file);
        const fh = this.fileHandles[handle];
        if (!fh) throw new Error(`Invalid file handle at line ${node.line}`);
        if (fh.mode !== 'read') throw new Error(`ENDOFFILE can only be used on files opened for reading at line ${node.line}`);
        return fh.pos >= fh.content.length ? 1 : 0;
      }
      case 'builtin_call':
        return await this.evalBuiltinKeyword(node.keyword, node.params, node.mode, node.line);
      case 'arr_literal': {
        const items = [];
        for (const item of node.items) {
          items.push(await this.evalExpr(item));
        }
        return items;
      }
      case 'struct_literal': {
        const obj = {};
        for (const m of node.members) {
          obj[m.name + m.suffix] = await this.evalExpr(m.value);
        }
        return obj;
      }
      default:
        throw new Error(`Unknown expression type: ${node.type}`);
    }
  }

  async evalBuiltinKeyword(keyword, params, mode, line) {
    switch (keyword) {
      case 'INPUT': {
        if (params.TEXT) {
          const promptText = await this.evalExpr(params.TEXT);
          this.screen.printInline(promptText);
          this.screen.render();
        }
        return await this.waitForInput();
      }
      case 'GETKEY':
        return this.currentKey;
      case 'RANDOM': {
        const max = Math.floor(await this.evalExpr(params.MAX));
        return Math.floor(Math.random() * (max + 1));
      }
      case 'LENGTH': {
        const val = await this.evalExpr(params.VALUE);
        return Array.isArray(val) ? val.length : String(val).length;
      }
      case 'SUBSTRING': {
        const str = String(await this.evalExpr(params.TEXT));
        const start = Math.floor(await this.evalExpr(params.START));
        const len = Math.floor(await this.evalExpr(params.LENGTH));
        if (start < 1 || start > str.length) {
          throw new Error(`SUBSTRING: START index ${start} out of range (1-${str.length}) at line ${line}`);
        }
        return str.substring(start - 1, start - 1 + len);
      }
      case 'UPPERCASE':
        return String(await this.evalExpr(params.TEXT)).toUpperCase();
      case 'LOWERCASE':
        return String(await this.evalExpr(params.TEXT)).toLowerCase();
      case 'CONTAINS': {
        const text = String(await this.evalExpr(params.TEXT));
        const find = String(await this.evalExpr(params.FIND));
        return text.includes(find) ? 1 : 0;
      }
      case 'ABS':
        return Math.abs(await this.evalExpr(params.VALUE));
      case 'SQRT': {
        const val = await this.evalExpr(params.VALUE);
        if (val < 0) throw new Error(`SQRT: cannot take square root of negative number at line ${line}`);
        return Math.sqrt(val);
      }
      case 'ROUND':
        return Math.round(await this.evalExpr(params.VALUE));
      case 'FLOOR':
        return Math.floor(await this.evalExpr(params.VALUE));
      case 'CEIL':
        return Math.ceil(await this.evalExpr(params.VALUE));
      case 'MIN':
        return Math.min(await this.evalExpr(params.A), await this.evalExpr(params.B));
      case 'MAX':
        return Math.max(await this.evalExpr(params.A), await this.evalExpr(params.B));
      case 'SIN':
        return Math.sin(await this.evalExpr(params.VALUE));
      case 'COS':
        return Math.cos(await this.evalExpr(params.VALUE));
      case 'LOG': {
        const val = await this.evalExpr(params.VALUE);
        if (val <= 0) throw new Error(`LOG: value must be positive at line ${line}`);
        return Math.log(val);
      }
      case 'SIGN':
        return Math.sign(await this.evalExpr(params.VALUE));
      case 'OPEN': {
        const fileName = String(await this.evalExpr(params.FILE));
        const fileMode = params.MODE ? String(await this.evalExpr(params.MODE)).toLowerCase() : 'read';
        if (fileMode !== 'read' && fileMode !== 'write' && fileMode !== 'append') {
          throw new Error(`Invalid file mode '${fileMode}' — expected READ, WRITE, or APPEND at line ${line}`);
        }
        let content = '';
        if (fileMode === 'read') {
          const stored = localStorage.getItem('sambasic_file:' + fileName);
          if (stored === null) throw new Error(`File '${fileName}' not found at line ${line}`);
          content = stored;
        } else if (fileMode === 'append') {
          const stored = localStorage.getItem('sambasic_file:' + fileName);
          if (stored !== null) content = stored;
        }
        const handle = this.nextFileHandle++;
        this.fileHandles[handle] = { name: fileName, content, pos: 0, mode: fileMode };
        return handle;
      }
      case 'READFILELINE': {
        const handle = await this.evalExpr(params.FILE);
        const fh = this.fileHandles[handle];
        if (!fh) throw new Error(`Invalid file handle at line ${line}`);
        if (fh.mode !== 'read') throw new Error(`Cannot read from file opened for writing at line ${line}`);
        if (fh.pos >= fh.content.length) throw new Error(`End of file reached at line ${line}`);
        const nlIdx = fh.content.indexOf('\n', fh.pos);
        if (nlIdx === -1) {
          const result = fh.content.substring(fh.pos);
          fh.pos = fh.content.length;
          return result;
        }
        const result = fh.content.substring(fh.pos, nlIdx);
        fh.pos = nlIdx + 1;
        return result;
      }
      case 'READFILECHARACTER': {
        const handle = await this.evalExpr(params.FILE);
        const fh = this.fileHandles[handle];
        if (!fh) throw new Error(`Invalid file handle at line ${line}`);
        if (fh.mode !== 'read') throw new Error(`Cannot read from file opened for writing at line ${line}`);
        if (fh.pos >= fh.content.length) throw new Error(`End of file reached at line ${line}`);
        const ch = fh.content[fh.pos];
        fh.pos++;
        return ch;
      }
      case 'TONUMBER': {
        const val = await this.evalExpr(params.VALUE);
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`TONUMBER: cannot convert '${val}' to number at line ${line}`);
        return num;
      }
      case 'TOSTRING':
        return String(await this.evalExpr(params.VALUE));
      case 'INDEXOF': {
        const text = String(await this.evalExpr(params.TEXT));
        const find = String(await this.evalExpr(params.FIND));
        const idx = text.indexOf(find);
        return idx === -1 ? 0 : idx + 1;
      }
      case 'TRIM': {
        const text = String(await this.evalExpr(params.TEXT));
        if (mode === 'LEFT') return text.trimStart();
        if (mode === 'RIGHT') return text.trimEnd();
        return text.trim();
      }
      case 'RUNNINGTIME':
        return Math.floor(performance.now() - this._startTime);
      case 'FILEEXISTS': {
        const fileName = String(await this.evalExpr(params.FILE));
        return localStorage.getItem('sambasic_file:' + fileName) !== null ? 1 : 0;
      }
      case 'CREATESPRITE': {
        const data = await this.evalExpr(params.DATA);
        if (!Array.isArray(data)) throw new Error(`CREATESPRITE: DATA must be a 2D array at line ${line}`);
        return this.screen.createSprite(data);
      }
      case 'GROUP3D': {
        return this._ensureScene3D().createGroup();
      }
      default:
        throw new Error(`Unknown builtin keyword '${keyword}' at line ${line}`);
    }
  }

  async evalBinop(node) {
    const left = await this.evalExpr(node.left);
    const right = await this.evalExpr(node.right);

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

  async evalUnary(node) {
    const val = await this.evalExpr(node.expr);
    switch (node.op) {
      case '-': return -val;
      case 'NOT': return val ? 0 : 1;
      default:
        throw new Error(`Unknown unary operator: ${node.op}`);
    }
  }

  _warnUninitialized(name, suffix, defaultStr) {
    const key = name + suffix;
    if (!this.warnedVars.has(key)) {
      this.warnedVars.add(key);
      this.screen.print(`Warning: variable '${key}' used before assignment (defaulting to ${defaultStr})`, '#FFFF55');
      this.screen.render();
    }
  }

  // Execute a statement
  async execStmt(stmt) {
    switch (stmt.type) {
      case 'print': {
        const val = await this.evalExpr(stmt.expr);
        let color = null;
        if (stmt.withColor) {
          color = this._colorStructToHex(await this.evalExpr(stmt.withColor), stmt.line);
        }
        this.screen.print(val, color);
        this.screen.render();
        break;
      }
      case 'movecursor': {
        const row = Math.floor(await this.evalExpr(stmt.row));
        const col = Math.floor(await this.evalExpr(stmt.col));
        this.screen.moveCursor(row, col);
        break;
      }
      case 'printat': {
        const row = Math.floor(await this.evalExpr(stmt.row));
        const col = Math.floor(await this.evalExpr(stmt.col));
        const val = await this.evalExpr(stmt.expr);
        let color = null;
        if (stmt.withColor) {
          color = this._colorStructToHex(await this.evalExpr(stmt.withColor), stmt.line);
        }
        this.screen.printAt(row, col, val, color);
        this.screen.render();
        break;
      }
      case 'clearscreen': {
        this.screen.clear();
        break;
      }
      case 'assign_builtin': {
        const result = await this.evalBuiltinKeyword(stmt.keyword, stmt.params, stmt.mode, stmt.line);
        if (result === null && stmt.keyword === 'INPUT') return; // stopped
        // Type coercion based on varType
        switch (stmt.varType) {
          case 'num': {
            const num = parseFloat(result);
            if (isNaN(num)) throw new Error(`${stmt.keyword}: expected a number, got '${result}' at line ${stmt.line}`);
            this.numVars[stmt.name] = num;
            break;
          }
          case 'str':
            this.strVars[stmt.name] = String(result);
            break;
          case 'bool':
            this.boolVars[stmt.name] = result ? 1 : 0;
            break;
          default:
            throw new Error(`Cannot assign ${stmt.keyword} result to ${stmt.varType} variable at line ${stmt.line}`);
        }
        break;
      }
      case 'label': {
        // no-op at runtime; labels are resolved at parse time
        break;
      }
      case 'goto': {
        throw new GotoSignal(stmt.label);
      }
      case 'break': {
        throw new BreakSignal();
      }
      case 'continue': {
        throw new ContinueSignal();
      }
      case 'if': {
        const cond = await this.evalExpr(stmt.condition);
        if (cond) {
          await this.execBlock(stmt.thenBody);
        } else if (stmt.elseBody) {
          await this.execBlock(stmt.elseBody);
        }
        break;
      }
      case 'for': {
        const lower = Math.floor(await this.evalExpr(stmt.lower));
        const upper = Math.floor(await this.evalExpr(stmt.upper));
        const step = stmt.step ? Math.floor(await this.evalExpr(stmt.step)) : 1;
        if (step === 0) throw new Error(`FOR loop step cannot be 0 at line ${stmt.line}`);

        for (let i = lower; step > 0 ? i <= upper : i >= upper; i += step) {
          if (!this.running) break;
          if (stmt.varName) this.numVars[stmt.varName] = i;
          try {
            await this.execBlock(stmt.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) {
              // skip to next iteration
              this._stmtCount++;
              if (this._stmtCount % 100 === 0) await this.yieldToEventLoop();
              continue;
            }
            throw e;
          }

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
        while (this.running && await this.evalExpr(stmt.condition)) {
          try {
            await this.execBlock(stmt.body);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) {
              // skip to condition re-check
              this._stmtCount++;
              if (this._stmtCount % 100 === 0) await this.yieldToEventLoop();
              continue;
            }
            throw e;
          }

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
        const colorVal = await this.evalExpr(stmt.expr);
        this.screen.setColor(this._colorStructToHex(colorVal, stmt.line));
        break;
      }
      case 'beep': {
        if (this.audio) await this.audio.beep();
        break;
      }
      case 'sleep': {
        const seconds = await this.evalExpr(stmt.duration);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        break;
      }
      case 'play': {
        if (this.audio) {
          const musicStr = String(await this.evalExpr(stmt.expr));
          const waveType = stmt.waveExpr ? String(await this.evalExpr(stmt.waveExpr)) : 'square';
          const inBackground = stmt.backgroundExpr ? !!(await this.evalExpr(stmt.backgroundExpr)) : false;
          const onRepeat = stmt.repeatExpr ? !!(await this.evalExpr(stmt.repeatExpr)) : false;
          if (inBackground) {
            this.audio.playSequenceBg(musicStr, waveType, onRepeat);
          } else if (onRepeat) {
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
          const sharedTempo = stmt.tempoExpr ? Number(await this.evalExpr(stmt.tempoExpr)) : null;
          const voices = [];
          for (const v of stmt.voices) {
            let musicStr = String(await this.evalExpr(v.expr));
            if (sharedTempo != null) {
              musicStr = `T${sharedTempo} ` + musicStr;
            }
            voices.push({
              musicStr,
              waveType: v.waveExpr ? String(await this.evalExpr(v.waveExpr)) : null,
              volume: v.volumeExpr ? Number(await this.evalExpr(v.volumeExpr)) : null,
            });
          }
          const inBackground = stmt.backgroundExpr ? !!(await this.evalExpr(stmt.backgroundExpr)) : false;
          const onRepeat = stmt.repeatExpr ? !!(await this.evalExpr(stmt.repeatExpr)) : false;
          if (inBackground) {
            this.audio.playPolyBg(voices, onRepeat);
          } else if (onRepeat) {
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
      case 'bufferenabled': {
        const val = await this.evalExpr(stmt.value);
        this.screen.setBufferEnabled(!!val);
        break;
      }
      case 'showbuffer': {
        this._renderScene3D();
        this.screen.showBuffer();
        break;
      }
      case 'clearbuffer': {
        let colorHex = null;
        if (stmt.color) {
          colorHex = this._colorStructToHex(await this.evalExpr(stmt.color), stmt.line);
        }
        this.screen.clearBuffer(colorHex);
        break;
      }
      case 'drawpixel': {
        const x = Math.floor(await this.evalExpr(stmt.x));
        const y = Math.floor(await this.evalExpr(stmt.y));
        this.screen.drawPixel(x, y);
        break;
      }
      case 'drawline': {
        const x1 = Math.floor(await this.evalExpr(stmt.x1));
        const y1 = Math.floor(await this.evalExpr(stmt.y1));
        const x2 = Math.floor(await this.evalExpr(stmt.x2));
        const y2 = Math.floor(await this.evalExpr(stmt.y2));
        this.screen.drawLine(x1, y1, x2, y2);
        break;
      }
      case 'drawbox': {
        const x1 = Math.floor(await this.evalExpr(stmt.x1));
        const y1 = Math.floor(await this.evalExpr(stmt.y1));
        const x2 = Math.floor(await this.evalExpr(stmt.x2));
        const y2 = Math.floor(await this.evalExpr(stmt.y2));
        const fill = stmt.fill ? !!(await this.evalExpr(stmt.fill)) : false;
        this.screen.drawBox(x1, y1, x2, y2, fill);
        break;
      }
      case 'drawcircle': {
        const x = Math.floor(await this.evalExpr(stmt.x));
        const y = Math.floor(await this.evalExpr(stmt.y));
        const r = Math.floor(await this.evalExpr(stmt.radius));
        const fill = stmt.fill ? !!(await this.evalExpr(stmt.fill)) : false;
        this.screen.drawCircle(x, y, r, fill);
        break;
      }
      case 'drawsprite': {
        const spriteId = Math.floor(await this.evalExpr(stmt.sprite));
        const x = Math.floor(await this.evalExpr(stmt.x));
        const y = Math.floor(await this.evalExpr(stmt.y));
        this.screen.drawSprite(spriteId, x, y);
        break;
      }

      // --- 3D Wireframe ---

      case 'assign_object3d': {
        const scene = this._ensureScene3D();
        const color = this.screen ? this.screen.globalColor : '#00ff00';
        if (stmt.shape === 'PATH') {
          const points = await this._evalPathPoints(stmt.params, stmt.line);
          const id = scene.createObject('PATH', { points }, color);
          this.numVars[stmt.name] = id;
        } else {
          const evalParams = await this._evalObject3DParams(stmt.params, stmt.line);
          const id = scene.createObject(stmt.shape, evalParams, color);
          this.numVars[stmt.name] = id;
        }
        break;
      }
      case 'object3d_stmt': {
        const scene = this._ensureScene3D();
        const color = this.screen ? this.screen.globalColor : '#00ff00';
        if (stmt.shape === 'PATH') {
          const points = await this._evalPathPoints(stmt.params, stmt.line);
          scene.createObject('PATH', { points }, color);
        } else {
          const evalParams = await this._evalObject3DParams(stmt.params, stmt.line);
          scene.createObject(stmt.shape, evalParams, color);
        }
        break;
      }
      case 'assign_path3d': {
        const scene = this._ensureScene3D();
        const color = this.screen ? this.screen.globalColor : '#00ff00';
        const id = scene.createObject('PATH', { points: stmt.points }, color);
        this.numVars[stmt.name] = id;
        break;
      }
      case 'transform3d': {
        const scene = this._ensureScene3D();
        const id = Math.floor(await this.evalExpr(stmt.id));
        const obj = scene.getObject(id);
        const vals = [];
        for (const v of stmt.values) vals.push(Number(await this.evalExpr(v)));
        if (stmt.op === 'TRANSLATE') {
          obj.position = [vals[0], vals[1], vals[2]];
        } else if (stmt.op === 'ROTATE') {
          obj.rotation = [vals[0], vals[1], vals[2]];
        } else if (stmt.op === 'SCALE') {
          obj.scale = vals[0];
        }
        break;
      }
      case 'setcolor3d': {
        const scene = this._ensureScene3D();
        const id = Math.floor(await this.evalExpr(stmt.id));
        const obj = scene.getObject(id);
        const colorVal = await this.evalExpr(stmt.color);
        obj.color = this._colorStructToHex(colorVal, stmt.line);
        break;
      }
      case 'show3d': {
        const scene = this._ensureScene3D();
        const id = Math.floor(await this.evalExpr(stmt.id));
        const obj = scene.getObject(id);
        obj.visible = !!(await this.evalExpr(stmt.value));
        break;
      }
      case 'hiddenedges3d': {
        const scene = this._ensureScene3D();
        const id = Math.floor(await this.evalExpr(stmt.id));
        const obj = scene.getObject(id);
        obj.hiddenEdges = !!(await this.evalExpr(stmt.value));
        break;
      }
      case 'render3d': {
        this._ensureScene3D();
        this._renderScene3D();
        break;
      }
      case 'delete3d': {
        const scene = this._ensureScene3D();
        const id = Math.floor(await this.evalExpr(stmt.id));
        scene.deleteObject(id);
        break;
      }
      case 'clear3d': {
        this.scene3d = null;
        break;
      }
      case 'attach3d': {
        const scene = this._ensureScene3D();
        const parentId = Math.floor(await this.evalExpr(stmt.parent));
        const childId = Math.floor(await this.evalExpr(stmt.child));
        scene.attach(parentId, childId);
        break;
      }
      case 'detach3d': {
        const scene = this._ensureScene3D();
        const childId = Math.floor(await this.evalExpr(stmt.child));
        scene.detach(childId);
        break;
      }
      case 'assign_num': {
        this.numVars[stmt.name] = await this.evalExpr(stmt.value);
        break;
      }
      case 'assign_str': {
        this.strVars[stmt.name] = String(await this.evalExpr(stmt.value));
        break;
      }
      case 'assign_bool': {
        this.boolVars[stmt.name] = (await this.evalExpr(stmt.value)) ? 1 : 0;
        break;
      }
      case 'assign_struct': {
        const obj = {};
        for (const m of stmt.members) {
          obj[m.name + m.suffix] = await this.evalExpr(m.value);
        }
        this.structVars[stmt.name] = obj;
        break;
      }
      case 'assign_struct_member': {
        if (!this.structVars[stmt.name]) {
          this.structVars[stmt.name] = {};
        }
        this.structVars[stmt.name][stmt.memberName + stmt.memberSuffix] = await this.evalExpr(stmt.value);
        break;
      }
      case 'assign_arr_alloc': {
        const size = Math.floor(await this.evalExpr(stmt.size));
        this.arrVars[stmt.name] = new Array(size).fill(0);
        break;
      }
      case 'assign_arr_alloc2d': {
        const rows = Math.floor(await this.evalExpr(stmt.size1));
        const cols = Math.floor(await this.evalExpr(stmt.size2));
        const arr = [];
        for (let r = 0; r < rows; r++) {
          arr.push(new Array(cols).fill(0));
        }
        this.arrVars[stmt.name] = arr;
        break;
      }
      case 'assign_arr_literal': {
        const items = [];
        for (const item of stmt.items) {
          items.push(await this.evalExpr(item));
        }
        this.arrVars[stmt.name] = items;
        break;
      }
      case 'assign_arr_multi': {
        const dims = [];
        for (const dim of stmt.dimensions) {
          const row = [];
          for (const item of dim) {
            row.push(await this.evalExpr(item));
          }
          dims.push(row);
        }
        this.arrVars[stmt.name] = dims;
        break;
      }
      case 'assign_arr_index': {
        const arr = this.arrVars[stmt.name];
        if (!arr) throw new Error(`Array ${stmt.name}@ not initialized at line ${stmt.line}`);
        const val = await this.evalExpr(stmt.value);
        if (stmt.indices.length === 1) {
          const idx = Math.floor(await this.evalExpr(stmt.indices[0])) - 1;
          if (idx < 0 || idx >= arr.length) throw new Error(`Array index out of bounds at line ${stmt.line}`);
          arr[idx] = val;
        } else if (stmt.indices.length === 2) {
          const i = Math.floor(await this.evalExpr(stmt.indices[0])) - 1;
          const j = Math.floor(await this.evalExpr(stmt.indices[1])) - 1;
          if (!arr[i]) throw new Error(`Array index out of bounds at line ${stmt.line}`);
          arr[i][j] = val;
        }
        break;
      }
      case 'arr_append': {
        const arr = this.arrVars[stmt.name];
        if (!arr) throw new Error(`Array ${stmt.name}@ not initialized at line ${stmt.line}`);
        const val = await this.evalExpr(stmt.value);
        arr.push(val);
        break;
      }
      case 'arr_insert': {
        const arr = this.arrVars[stmt.name];
        if (!arr) throw new Error(`Array ${stmt.name}@ not initialized at line ${stmt.line}`);
        const idx = Math.floor(await this.evalExpr(stmt.index)) - 1;
        if (idx < 0 || idx > arr.length) throw new Error(`INSERT index out of bounds at line ${stmt.line}`);
        const val = await this.evalExpr(stmt.value);
        arr.splice(idx, 0, val);
        break;
      }
      case 'arr_remove': {
        const arr = this.arrVars[stmt.name];
        if (!arr) throw new Error(`Array ${stmt.name}@ not initialized at line ${stmt.line}`);
        const idx = Math.floor(await this.evalExpr(stmt.index)) - 1;
        if (idx < 0 || idx >= arr.length) throw new Error(`REMOVE index out of bounds at line ${stmt.line}`);
        arr.splice(idx, 1);
        break;
      }
      case 'sort': {
        const arr = this.arrVars[stmt.name];
        if (!arr) throw new Error(`Array ${stmt.name}@ not initialized at line ${stmt.line}`);
        const cmp = stmt.order === 'DESCENDING'
          ? (a, b) => (a < b ? 1 : a > b ? -1 : 0)
          : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
        arr.sort(cmp);
        break;
      }
      case 'funcdef': {
        // no-op at runtime; function definitions are collected at parse time
        break;
      }
      case 'global_decl': {
        // no-op at runtime; handled at call setup time
        break;
      }
      case 'return': {
        const val = stmt.value ? await this.evalExpr(stmt.value) : null;
        throw new ReturnSignal(val);
      }
      case 'close': {
        const handle = await this.evalExpr(stmt.file);
        const fh = this.fileHandles[handle];
        if (!fh) throw new Error(`Invalid file handle at line ${stmt.line}`);
        if (fh.mode === 'write' || fh.mode === 'append') {
          localStorage.setItem('sambasic_file:' + fh.name, fh.content);
        }
        delete this.fileHandles[handle];
        break;
      }
      case 'writefileline': {
        const handle = await this.evalExpr(stmt.file);
        const fh = this.fileHandles[handle];
        if (!fh) throw new Error(`Invalid file handle at line ${stmt.line}`);
        if (fh.mode === 'read') throw new Error(`Cannot write to file opened for reading at line ${stmt.line}`);
        const text = String(await this.evalExpr(stmt.content));
        fh.content += text + '\n';
        break;
      }
      case 'writefilecharacter': {
        const handle = await this.evalExpr(stmt.file);
        const fh = this.fileHandles[handle];
        if (!fh) throw new Error(`Invalid file handle at line ${stmt.line}`);
        if (fh.mode === 'read') throw new Error(`Cannot write to file opened for reading at line ${stmt.line}`);
        const ch = String(await this.evalExpr(stmt.character));
        if (ch.length > 0) fh.content += ch[0];
        break;
      }
      case 'void_funccall': {
        await this.execFunctionCall(stmt.call, stmt.line);
        break;
      }
      case 'assign_funccall': {
        const result = await this.execFunctionCall(stmt.call, stmt.line);
        if (result === null || result === undefined) {
          throw new Error(`Cannot assign void function at line ${stmt.line}`);
        }
        switch (stmt.varType) {
          case 'num': this.numVars[stmt.name] = result; break;
          case 'str': this.strVars[stmt.name] = String(result); break;
          case 'bool': this.boolVars[stmt.name] = result ? 1 : 0; break;
          case 'arr': this.arrVars[stmt.name] = result; break;
          case 'struct': this.structVars[stmt.name] = result; break;
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
        if (e instanceof GotoSignal) throw e;
        if (e instanceof BreakSignal) throw e;
        if (e instanceof ContinueSignal) throw e;
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

  async execFunctionCall(callNode, line) {
    const func = this.functions[callNode.name];
    if (!func) {
      throw new Error(`Undefined function '${callNode.name}${callNode.suffix || ''}' at line ${line}`);
    }

    if (this.callStack.length >= this.MAX_RECURSION_DEPTH) {
      throw new Error(`Maximum recursion depth (${this.MAX_RECURSION_DEPTH}) exceeded at line ${line}`);
    }

    const resolvedArgs = await this._resolveArgs(func, callNode.args, line);

    // Save current scope
    this.callStack.push({
      numVars: this.numVars,
      strVars: this.strVars,
      arrVars: this.arrVars,
      structVars: this.structVars,
      boolVars: this.boolVars,
    });

    // Fresh local scope
    this.numVars = {};
    this.strVars = {};
    this.arrVars = {};
    this.structVars = {};
    this.boolVars = {};
    this._initBuiltinColors();

    // Set parameter values
    for (const arg of resolvedArgs) {
      const key = arg.varName;
      switch (arg.varSuffix) {
        case '#': this.numVars[key] = arg.value; break;
        case '$': this.strVars[key] = arg.value; break;
        case '@': this.arrVars[key] = arg.value; break;
        case '&': this.structVars[key] = arg.value; break;
        case '?': this.boolVars[key] = arg.value; break;
      }
    }

    // Set up GLOBAL variable proxies
    if (func.globals && func.globals.length > 0) {
      const globalScope = this.callStack[0]; // outermost/main scope
      for (const g of func.globals) {
        const varKey = g.name;
        const suffixToStore = { '#': 'numVars', '$': 'strVars', '@': 'arrVars', '&': 'structVars', '?': 'boolVars' };
        const storeName = suffixToStore[g.suffix];
        const globalStore = globalScope[storeName];
        if (!(varKey in globalStore)) {
          throw new Error(`GLOBAL variable '${varKey}${g.suffix}' does not exist in global scope at line ${line}`);
        }
        Object.defineProperty(this[storeName], varKey, {
          get() { return globalStore[varKey]; },
          set(val) { globalStore[varKey] = val; },
          configurable: true,
          enumerable: true,
        });
      }
    }

    let returnValue = null;
    try {
      await this.execFunctionBody(func.body, func.localLabels);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        returnValue = e.value;
      } else {
        // Write back reference params before restoring scope
        this._writebackRefArgs(resolvedArgs);
        // Restore scope before re-throwing
        const saved = this.callStack.pop();
        this.numVars = saved.numVars;
        this.strVars = saved.strVars;
        this.arrVars = saved.arrVars;
        this.structVars = saved.structVars;
        this.boolVars = saved.boolVars;
        throw e;
      }
    }

    // Write back reference params before restoring scope
    this._writebackRefArgs(resolvedArgs);

    // Restore caller scope
    const saved = this.callStack.pop();
    this.numVars = saved.numVars;
    this.strVars = saved.strVars;
    this.arrVars = saved.arrVars;
    this.structVars = saved.structVars;
    this.boolVars = saved.boolVars;

    // Check typed function returned a value
    if (func.returnType !== 'void' && returnValue === null) {
      throw new Error(`Function '${callNode.name}${callNode.suffix || ''}' must return a value at line ${line}`);
    }

    // Enforce return type
    if (returnValue !== null && func.returnType !== 'void') {
      const nameWithSuffix = callNode.name + (callNode.suffix || '');
      switch (func.returnType) {
        case 'num':
          if (typeof returnValue !== 'number') {
            throw new Error(`Function '${nameWithSuffix}' expected to return a number but got ${typeof returnValue} at line ${line}`);
          }
          break;
        case 'str':
          if (typeof returnValue !== 'string') {
            throw new Error(`Function '${nameWithSuffix}' expected to return a string but got ${typeof returnValue} at line ${line}`);
          }
          break;
        case 'arr':
          if (!Array.isArray(returnValue)) {
            throw new Error(`Function '${nameWithSuffix}' expected to return an array but got ${typeof returnValue} at line ${line}`);
          }
          break;
        case 'struct':
          if (typeof returnValue !== 'object' || Array.isArray(returnValue)) {
            throw new Error(`Function '${nameWithSuffix}' expected to return a struct but got ${typeof returnValue} at line ${line}`);
          }
          break;
        // bool: coerced to 0/1 at call site, no check needed
      }
    }

    return returnValue;
  }

  async _resolveArgs(func, args, line) {
    const params = func.params;
    const assigned = new Array(params.length).fill(false);
    const values = new Array(params.length).fill(undefined);
    let positionalIndex = 0;

    const argNodes = new Array(params.length).fill(null);

    for (let a = 0; a < args.length; a++) {
      const arg = args[a];
      if (arg.label) {
        // Named argument — find matching param by label
        const idx = params.findIndex(p => p.label !== null && p.label === arg.label);
        if (idx === -1) {
          throw new Error(`Unknown parameter '${arg.label}' at line ${line}`);
        }
        if (assigned[idx]) {
          throw new Error(`Parameter '${arg.label}' already provided at line ${line}`);
        }
        assigned[idx] = true;
        argNodes[idx] = arg.value;
        values[idx] = await this.evalExpr(arg.value);
      } else {
        // Positional — find next unassigned param
        while (positionalIndex < params.length && assigned[positionalIndex]) {
          positionalIndex++;
        }
        if (positionalIndex >= params.length) {
          throw new Error(`Too many arguments (expected ${params.length}) at line ${line}`);
        }
        assigned[positionalIndex] = true;
        argNodes[positionalIndex] = arg.value;
        values[positionalIndex] = await this.evalExpr(arg.value);
        positionalIndex++;
      }
    }

    // Validate required params and fill defaults for optional
    const resolved = [];
    for (let i = 0; i < params.length; i++) {
      let callerVarName = null;
      const isRef = params[i].reference;

      if (!assigned[i]) {
        if (!params[i].optional) {
          const paramDisplay = params[i].label || (params[i].varName + params[i].varSuffix);
          throw new Error(`Missing required parameter '${paramDisplay}' at line ${line}`);
        }
        // Default values by type
        const defaults = { '#': 0, '$': '', '@': [], '&': {}, '?': 0 };
        values[i] = defaults[params[i].varSuffix];
      } else if (isRef) {
        // Validate that the AST node is a simple variable
        const node = argNodes[i];
        const validRefTypes = { '@': 'arrvar', '$': 'strvar', '&': 'structvar' };
        const expectedType = validRefTypes[params[i].varSuffix];
        if (!node || node.type !== expectedType) {
          throw new Error(`REFERENCE parameter '${params[i].varName}${params[i].varSuffix}' requires a variable, not an expression at line ${line}`);
        }
        callerVarName = node.name;
      }

      // Deep-copy arrays and structs for pass-by-value (skip for reference params)
      let val = values[i];
      if (!isRef) {
        if (params[i].varSuffix === '@' && Array.isArray(val)) {
          val = JSON.parse(JSON.stringify(val));
        } else if (params[i].varSuffix === '&' && typeof val === 'object' && val !== null) {
          val = JSON.parse(JSON.stringify(val));
        }
      }
      resolved.push({
        varName: params[i].varName,
        varSuffix: params[i].varSuffix,
        value: val,
        reference: isRef,
        callerVarName,
      });
    }

    return resolved;
  }

  _writebackRefArgs(resolvedArgs) {
    const callerScope = this.callStack[this.callStack.length - 1];
    for (const arg of resolvedArgs) {
      if (arg.reference && arg.callerVarName) {
        const suffixToStore = { '$': 'strVars', '@': 'arrVars', '&': 'structVars' };
        const store = suffixToStore[arg.varSuffix];
        if (store) {
          callerScope[store][arg.callerVarName] = this[store][arg.varName];
        }
      }
    }
  }

  async execFunctionBody(body, localLabels) {
    let pc = 0;
    while (this.running && pc < body.length) {
      if (this.paused) {
        await new Promise(resolve => { this._pauseResolve = resolve; });
        if (!this.running) break;
      }

      const stmt = body[pc];
      pc++;

      try {
        await this.execStmt(stmt);
      } catch (e) {
        if (e instanceof GotoSignal) {
          const target = localLabels[e.label];
          if (target === undefined) {
            throw new Error(`Undefined label '${e.label}' at line ${stmt.line}`);
          }
          pc = target;
          continue;
        }
        if (e instanceof ReturnSignal) throw e;
        if (e instanceof BreakSignal) throw e;
        if (e instanceof ContinueSignal) throw e;
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
