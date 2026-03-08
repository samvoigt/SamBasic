class Inspector {
  constructor(containerEl, interpreter) {
    this._container = containerEl;
    this._list = containerEl.querySelector('.inspector-list');
    this._interp = interpreter;
    this._timer = null;
    this._lastSnapshot = '';
    this._BUILTIN_COLORS = new Set([
      'BLACK', 'BLUE', 'GREEN', 'CYAN', 'RED', 'MAGENTA', 'BROWN',
      'LIGHTGRAY', 'DARKGRAY', 'LIGHTBLUE', 'LIGHTGREEN', 'LIGHTCYAN',
      'LIGHTRED', 'LIGHTMAGENTA', 'YELLOW', 'WHITE',
    ]);
  }

  show() {
    this._container.style.display = 'flex';
    this.update();
    this._timer = setInterval(() => this.update(), 200);
  }

  hide() {
    this._container.style.display = 'none';
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  update() {
    const interp = this._interp;
    const inFunction = interp.callStack.length > 0;
    const stores = [
      { map: interp.numVars, suffix: '#' },
      { map: interp.strVars, suffix: '$' },
      { map: interp.boolVars, suffix: '?' },
      { map: interp.arrVars, suffix: '@' },
      { map: interp.structVars, suffix: '&' },
    ];

    const globalVars = [];
    const localVars = [];

    for (const { map, suffix } of stores) {
      if (inFunction) {
        const localTarget = map[Interpreter.LOCAL_TARGET];
        const globalScope = interp.callStack[0][this._storeKey(suffix)];
        // Local variables
        if (localTarget) {
          for (const name of Object.keys(localTarget)) {
            if (suffix === '&' && this._BUILTIN_COLORS.has(name)) continue;
            localVars.push({ name, suffix, value: localTarget[name] });
          }
        }
        // Global variables (not shadowed by local)
        if (globalScope) {
          for (const name of Object.keys(globalScope)) {
            if (suffix === '&' && this._BUILTIN_COLORS.has(name)) continue;
            globalVars.push({ name, suffix, value: globalScope[name] });
          }
        }
      } else {
        const keys = Object.keys(map);
        for (const name of keys) {
          if (suffix === '&' && this._BUILTIN_COLORS.has(name)) continue;
          globalVars.push({ name, suffix, value: map[name] });
        }
      }
    }

    // Build snapshot for change detection
    const snapshot = this._snapshot(globalVars, localVars);
    if (snapshot === this._lastSnapshot) return;
    this._lastSnapshot = snapshot;

    // Render
    this._list.innerHTML = '';

    if (globalVars.length === 0 && localVars.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inspector-empty';
      empty.textContent = 'No variables';
      this._list.appendChild(empty);
      return;
    }

    if (inFunction && localVars.length > 0) {
      this._renderSection('Local', localVars);
    }
    if (globalVars.length > 0) {
      this._renderSection('Global', globalVars);
    }
  }

  _storeKey(suffix) {
    switch (suffix) {
      case '#': return 'numVars';
      case '$': return 'strVars';
      case '?': return 'boolVars';
      case '@': return 'arrVars';
      case '&': return 'structVars';
    }
  }

  _renderSection(title, vars) {
    const header = document.createElement('div');
    header.className = 'inspector-section';
    header.textContent = title;
    this._list.appendChild(header);

    for (const v of vars) {
      const row = document.createElement('div');
      row.className = 'inspector-var';
      row.innerHTML = this._formatVar(v.name, v.suffix, v.value);
      this._list.appendChild(row);

      // Expanded sub-rows for arrays and structs
      if (v.suffix === '@') {
        this._renderArraySub(v.value);
      } else if (v.suffix === '&') {
        this._renderStructSub(v.value);
      }
    }
  }

  _formatVar(name, suffix, value) {
    const nameHtml = `<span class="inspector-var-name">${this._esc(name)}${suffix}</span>`;
    const eq = `<span class="inspector-var-eq"> = </span>`;
    const valHtml = this._formatValueInline(suffix, value);
    return nameHtml + eq + valHtml;
  }

  _formatValueInline(suffix, value) {
    switch (suffix) {
      case '#':
        return `<span class="inspector-var-num">${this._esc(String(value))}</span>`;
      case '$':
        return `<span class="inspector-var-str">"${this._esc(String(value))}"</span>`;
      case '?':
        return `<span class="inspector-var-bool">${value ? 'TRUE' : 'FALSE'}</span>`;
      case '@':
        if (!value || typeof value !== 'object') return `<span class="inspector-var-arr">[]</span>`;
        const len = Array.isArray(value) ? value.length - 1 : Object.keys(value).length;
        return `<span class="inspector-var-arr">(${len < 0 ? 0 : len} items)</span>`;
      case '&':
        if (!value || typeof value !== 'object') return `<span class="inspector-var-struct">{}</span>`;
        const fields = Object.keys(value).length;
        return `<span class="inspector-var-struct">{${fields} fields}</span>`;
      default:
        return this._esc(String(value));
    }
  }

  _renderArraySub(arr) {
    if (!arr || typeof arr !== 'object') return;
    const keys = Array.isArray(arr)
      ? arr.map((_, i) => i).filter(i => i > 0)
      : Object.keys(arr);
    for (const k of keys) {
      const idx = Array.isArray(arr) ? k : k;
      const val = arr[k];
      const row = document.createElement('div');
      row.className = 'inspector-sub';
      row.innerHTML = `<span class="inspector-var-eq">[${this._esc(String(idx))}]</span> ${this._formatScalar(val)}`;
      this._list.appendChild(row);
    }
  }

  _renderStructSub(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const row = document.createElement('div');
      row.className = 'inspector-sub';
      row.innerHTML = `<span class="inspector-var-name">${this._esc(key)}</span><span class="inspector-var-eq"> = </span>${this._formatScalar(val)}`;
      this._list.appendChild(row);
    }
  }

  _formatScalar(value) {
    if (typeof value === 'number') {
      return `<span class="inspector-var-num">${value}</span>`;
    } else if (typeof value === 'string') {
      return `<span class="inspector-var-str">"${this._esc(value)}"</span>`;
    } else if (typeof value === 'boolean') {
      return `<span class="inspector-var-bool">${value ? 'TRUE' : 'FALSE'}</span>`;
    } else if (Array.isArray(value)) {
      const items = value.slice(1).map(v => this._formatScalar(v)).join(', ');
      return `<span class="inspector-var-arr">[${items}]</span>`;
    } else if (value && typeof value === 'object') {
      const entries = Object.entries(value).map(([k, v]) =>
        `${this._esc(k)}: ${this._stripTags(this._formatScalar(v))}`
      ).join(', ');
      return `<span class="inspector-var-struct">{${entries}}</span>`;
    }
    return this._esc(String(value));
  }

  _stripTags(html) {
    return html.replace(/<[^>]+>/g, '');
  }

  _snapshot(globalVars, localVars) {
    const snap = (vars) => vars.map(v => v.name + v.suffix + '=' + JSON.stringify(v.value)).join('|');
    return snap(globalVars) + '||' + snap(localVars);
  }

  _esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
