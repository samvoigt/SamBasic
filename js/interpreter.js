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
      throw new Error(`SETCOLOR/COLOR requires a color struct with .red#, .green#, .blue# members${line ? ' at line ' + line : ''}`);
    }
    const r = Math.max(0, Math.min(255, Math.floor(obj['red#'] || 0)));
    const g = Math.max(0, Math.min(255, Math.floor(obj['green#'] || 0)));
    const b = Math.max(0, Math.min(255, Math.floor(obj['blue#'] || 0)));
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
      case 'numvar': return this.numVars[node.name] ?? 0;
      case 'strvar': return this.strVars[node.name] ?? '';
      case 'boolvar': return this.boolVars[node.name] ?? 0;
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
      default:
        throw new Error(`Unknown expression type: ${node.type}`);
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
        let result;
        switch (stmt.keyword) {
          case 'INPUT': {
            if (stmt.params.TEXT) {
              const promptText = await this.evalExpr(stmt.params.TEXT);
              this.screen.printInline(promptText);
              this.screen.render();
            }
            result = await this.waitForInput();
            if (result === null) return; // stopped
            break;
          }
          case 'GETKEY': {
            result = this.currentKey;
            break;
          }
          case 'RANDOM': {
            const max = Math.floor(await this.evalExpr(stmt.params.MAX));
            result = Math.floor(Math.random() * (max + 1));
            break;
          }
          case 'LENGTH': {
            const val = await this.evalExpr(stmt.params.VALUE);
            if (Array.isArray(val)) {
              result = val.length;
            } else {
              result = String(val).length;
            }
            break;
          }
          case 'SUBSTRING': {
            const str = String(await this.evalExpr(stmt.params.TEXT));
            const start = Math.floor(await this.evalExpr(stmt.params.START));
            const len = Math.floor(await this.evalExpr(stmt.params.LENGTH));
            if (start < 1 || start > str.length) {
              throw new Error(`SUBSTRING: START index ${start} out of range (1-${str.length}) at line ${stmt.line}`);
            }
            result = str.substring(start - 1, start - 1 + len);
            break;
          }
          case 'UPPERCASE': {
            result = String(await this.evalExpr(stmt.params.TEXT)).toUpperCase();
            break;
          }
          case 'LOWERCASE': {
            result = String(await this.evalExpr(stmt.params.TEXT)).toLowerCase();
            break;
          }
          case 'CONTAINS': {
            const text = String(await this.evalExpr(stmt.params.TEXT));
            const find = String(await this.evalExpr(stmt.params.FIND));
            result = text.includes(find) ? 1 : 0;
            break;
          }
          case 'ABS': {
            result = Math.abs(await this.evalExpr(stmt.params.VALUE));
            break;
          }
          case 'SQRT': {
            const val = await this.evalExpr(stmt.params.VALUE);
            if (val < 0) throw new Error(`SQRT: cannot take square root of negative number at line ${stmt.line}`);
            result = Math.sqrt(val);
            break;
          }
          case 'ROUND': {
            result = Math.round(await this.evalExpr(stmt.params.VALUE));
            break;
          }
          case 'FLOOR': {
            result = Math.floor(await this.evalExpr(stmt.params.VALUE));
            break;
          }
          case 'CEIL': {
            result = Math.ceil(await this.evalExpr(stmt.params.VALUE));
            break;
          }
          case 'MIN': {
            result = Math.min(await this.evalExpr(stmt.params.A), await this.evalExpr(stmt.params.B));
            break;
          }
          case 'MAX': {
            result = Math.max(await this.evalExpr(stmt.params.A), await this.evalExpr(stmt.params.B));
            break;
          }
          case 'SIN': {
            result = Math.sin(await this.evalExpr(stmt.params.VALUE));
            break;
          }
          case 'COS': {
            result = Math.cos(await this.evalExpr(stmt.params.VALUE));
            break;
          }
          case 'LOG': {
            const val = await this.evalExpr(stmt.params.VALUE);
            if (val <= 0) throw new Error(`LOG: value must be positive at line ${stmt.line}`);
            result = Math.log(val);
            break;
          }
          case 'SIGN': {
            result = Math.sign(await this.evalExpr(stmt.params.VALUE));
            break;
          }
          case 'OPEN': {
            const fileName = String(await this.evalExpr(stmt.params.FILE));
            const mode = stmt.params.MODE ? String(await this.evalExpr(stmt.params.MODE)).toLowerCase() : 'read';
            if (mode !== 'read' && mode !== 'write' && mode !== 'append') {
              throw new Error(`Invalid file mode '${mode}' — expected 'read', 'write', or 'append' at line ${stmt.line}`);
            }
            let content = '';
            if (mode === 'read') {
              const stored = localStorage.getItem('sambasic_file:' + fileName);
              if (stored === null) throw new Error(`File '${fileName}' not found at line ${stmt.line}`);
              content = stored;
            } else if (mode === 'append') {
              const stored = localStorage.getItem('sambasic_file:' + fileName);
              if (stored !== null) content = stored;
            }
            const handle = this.nextFileHandle++;
            this.fileHandles[handle] = { name: fileName, content, pos: 0, mode };
            result = handle;
            break;
          }
          case 'READFILELINE': {
            const handle = await this.evalExpr(stmt.params.FILE);
            const fh = this.fileHandles[handle];
            if (!fh) throw new Error(`Invalid file handle at line ${stmt.line}`);
            if (fh.mode !== 'read') throw new Error(`Cannot read from file opened for writing at line ${stmt.line}`);
            if (fh.pos >= fh.content.length) throw new Error(`End of file reached at line ${stmt.line}`);
            const nlIdx = fh.content.indexOf('\n', fh.pos);
            if (nlIdx === -1) {
              result = fh.content.substring(fh.pos);
              fh.pos = fh.content.length;
            } else {
              result = fh.content.substring(fh.pos, nlIdx);
              fh.pos = nlIdx + 1;
            }
            break;
          }
          case 'READFILECHARACTER': {
            const handle = await this.evalExpr(stmt.params.FILE);
            const fh = this.fileHandles[handle];
            if (!fh) throw new Error(`Invalid file handle at line ${stmt.line}`);
            if (fh.mode !== 'read') throw new Error(`Cannot read from file opened for writing at line ${stmt.line}`);
            if (fh.pos >= fh.content.length) throw new Error(`End of file reached at line ${stmt.line}`);
            result = fh.content[fh.pos];
            fh.pos++;
            break;
          }
          case 'ENDOFFILE': {
            const handle = await this.evalExpr(stmt.params.FILE);
            const fh = this.fileHandles[handle];
            if (!fh) throw new Error(`Invalid file handle at line ${stmt.line}`);
            if (fh.mode !== 'read') throw new Error(`ENDOFFILE can only be used on files opened for reading at line ${stmt.line}`);
            result = fh.pos >= fh.content.length ? 1 : 0;
            break;
          }
          default:
            throw new Error(`Unknown builtin keyword '${stmt.keyword}' at line ${stmt.line}`);
        }
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
        while (this.running && await this.evalExpr(stmt.condition)) {
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
          const voices = [];
          for (const v of stmt.voices) {
            voices.push({
              musicStr: String(await this.evalExpr(v.expr)),
              waveType: v.waveExpr ? String(await this.evalExpr(v.waveExpr)) : null,
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
        case '!': this.boolVars[key] = arg.value; break;
      }
    }

    // Set up GLOBAL variable proxies
    if (func.globals && func.globals.length > 0) {
      const globalScope = this.callStack[0]; // outermost/main scope
      for (const g of func.globals) {
        const varKey = g.name;
        const suffixToStore = { '#': 'numVars', '$': 'strVars', '@': 'arrVars', '&': 'structVars', '!': 'boolVars' };
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

    for (const arg of args) {
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
        values[positionalIndex] = await this.evalExpr(arg.value);
        positionalIndex++;
      }
    }

    // Validate required params and fill defaults for optional
    const resolved = [];
    for (let i = 0; i < params.length; i++) {
      if (!assigned[i]) {
        if (!params[i].optional) {
          const paramDisplay = params[i].label || (params[i].varName + params[i].varSuffix);
          throw new Error(`Missing required parameter '${paramDisplay}' at line ${line}`);
        }
        // Default values by type
        const defaults = { '#': 0, '$': '', '@': [], '&': {}, '!': 0 };
        values[i] = defaults[params[i].varSuffix];
      }
      // Deep-copy arrays and structs for pass-by-value
      let val = values[i];
      if (params[i].varSuffix === '@' && Array.isArray(val)) {
        val = JSON.parse(JSON.stringify(val));
      } else if (params[i].varSuffix === '&' && typeof val === 'object' && val !== null) {
        val = JSON.parse(JSON.stringify(val));
      }
      resolved.push({ varName: params[i].varName, varSuffix: params[i].varSuffix, value: val });
    }

    return resolved;
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
