class Repl {
  constructor(screen, interpreter) {
    this.screen = screen;
    this.interpreter = interpreter;
    this.focused = false;
    this.active = false;
    this.executing = false;
    this.hasState = false;

    this._inputBuffer = '';
    this._accumulatedLines = [];
    this._history = [];
    this._historyIndex = -1;
    this._cursorVisible = false;
    this._cursorInterval = null;
    this._keydownHandler = this._onKeydown.bind(this);
    this._promptCol = 0;
    this.onExecutingChange = null;
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this._accumulatedLines = [];
    this._inputBuffer = '';
    this._historyIndex = -1;
    this._showPrompt();
    this._startCursorBlink();
    document.addEventListener('keydown', this._keydownHandler);
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this._stopCursorBlink();
    this._clearCursor();
    this._accumulatedLines = [];
    this._inputBuffer = '';
    document.removeEventListener('keydown', this._keydownHandler);
  }

  resetState() {
    this.interpreter.reset();
    this.hasState = false;
    this._history = [];
    this._historyIndex = -1;
    this._accumulatedLines = [];
  }

  onMonitorFocus() {
    if (!this.active) return;
    this.focused = true;
    const monitorEl = document.getElementById('monitor-screen');
    if (monitorEl) monitorEl.classList.add('repl-focused');
    this._startCursorBlink();
  }

  onEditorFocus() {
    this.focused = false;
    const monitorEl = document.getElementById('monitor-screen');
    if (monitorEl) monitorEl.classList.remove('repl-focused');
    this._stopCursorBlink();
    this._clearCursor();
    this.screen.render();
  }

  _showPrompt() {
    const prompt = this._accumulatedLines.length > 0 ? '.. ' : '> ';
    this.screen.printInline(prompt);
    this.screen.render();
    this._promptCol = this.screen.cursorCol;
  }

  _startCursorBlink() {
    this._stopCursorBlink();
    if (!this.focused || !this.active) return;
    this._cursorVisible = true;
    this._renderCursor();
    this._cursorInterval = setInterval(() => {
      this._cursorVisible = !this._cursorVisible;
      this._renderCursor();
    }, 530);
  }

  _stopCursorBlink() {
    if (this._cursorInterval) {
      clearInterval(this._cursorInterval);
      this._cursorInterval = null;
    }
    this._cursorVisible = false;
  }

  _renderCursor() {
    const row = this.screen.cursorRow;
    const col = this._promptCol + this._inputBuffer.length;
    if (col >= this.screen.cols) return;
    if (this._cursorVisible) {
      this.screen.buffer[row][col] = { char: '\u2588', color: this.screen.globalColor };
    } else {
      this.screen.buffer[row][col] = { char: ' ', color: this.screen.globalColor };
    }
    this.screen.render();
  }

  _clearCursor() {
    const row = this.screen.cursorRow;
    const col = this._promptCol + this._inputBuffer.length;
    if (col < this.screen.cols) {
      this.screen.buffer[row][col] = { char: ' ', color: this.screen.globalColor };
    }
  }

  _onKeydown(e) {
    if (!this.focused || !this.active || this.executing) return;

    // Ctrl+C: cancel multi-line or just show new prompt
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      this._clearCursor();
      if (this._accumulatedLines.length > 0 || this._inputBuffer.length > 0) {
        this.screen.newline();
        this.screen.printInline('(cancelled)');
        this.screen.newline();
      }
      this._accumulatedLines = [];
      this._inputBuffer = '';
      this._historyIndex = -1;
      this._showPrompt();
      this._startCursorBlink();
      return;
    }

    // Escape: cancel multi-line input
    if (e.key === 'Escape') {
      e.preventDefault();
      this._clearCursor();
      if (this._accumulatedLines.length > 0) {
        this.screen.newline();
        this.screen.printInline('(cancelled)');
        this.screen.newline();
        this._accumulatedLines = [];
      }
      this._inputBuffer = '';
      this._historyIndex = -1;
      this._showPrompt();
      this._startCursorBlink();
      return;
    }

    // Up arrow: history navigation
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this._history.length === 0) return;
      if (this._historyIndex < this._history.length - 1) {
        this._historyIndex++;
        this._replaceInput(this._history[this._history.length - 1 - this._historyIndex]);
      }
      return;
    }

    // Down arrow: history navigation
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this._historyIndex > 0) {
        this._historyIndex--;
        this._replaceInput(this._history[this._history.length - 1 - this._historyIndex]);
      } else if (this._historyIndex === 0) {
        this._historyIndex = -1;
        this._replaceInput('');
      }
      return;
    }

    // Enter: submit line
    if (e.key === 'Enter') {
      e.preventDefault();
      this._clearCursor();
      this._stopCursorBlink();
      const line = this._inputBuffer;
      this._inputBuffer = '';
      this.screen.newline();
      this.screen.render();
      this._handleSubmit(line);
      return;
    }

    // Backspace
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (this._inputBuffer.length > 0) {
        this._clearCursor();
        this._inputBuffer = this._inputBuffer.slice(0, -1);
        // Clear the character that was there
        const col = this._promptCol + this._inputBuffer.length;
        if (col < this.screen.cols) {
          this.screen.buffer[this.screen.cursorRow][col] = { char: ' ', color: this.screen.globalColor };
        }
        // Also clear the position after (where cursor was)
        const nextCol = col + 1;
        if (nextCol < this.screen.cols) {
          this.screen.buffer[this.screen.cursorRow][nextCol] = { char: ' ', color: this.screen.globalColor };
        }
        this._renderCursor();
      }
      return;
    }

    // Printable character
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const col = this._promptCol + this._inputBuffer.length;
      if (col < this.screen.cols - 1) {
        this._clearCursor();
        this.screen.buffer[this.screen.cursorRow][col] = { char: e.key, color: this.screen.globalColor };
        this._inputBuffer += e.key;
        this._renderCursor();
      }
    }
  }

  _replaceInput(text) {
    // Clear old input from screen
    this._clearCursor();
    const row = this.screen.cursorRow;
    for (let c = this._promptCol; c < this.screen.cols; c++) {
      this.screen.buffer[row][c] = { char: ' ', color: this.screen.globalColor };
    }
    // Write new input
    this._inputBuffer = text.slice(0, this.screen.cols - this._promptCol - 1);
    for (let i = 0; i < this._inputBuffer.length; i++) {
      this.screen.buffer[row][this._promptCol + i] = { char: this._inputBuffer[i], color: this.screen.globalColor };
    }
    this._renderCursor();
  }

  async _handleSubmit(line) {
    this._accumulatedLines.push(line);
    const source = this._accumulatedLines.join('\n');

    // Try to parse
    let ast, labels, functions;
    let parseError = null;
    let isBareExpr = false;

    try {
      const tokens = tokenize(source);
      const result = parse(tokens, this.interpreter.functions);
      ast = result.ast;
      labels = result.labels;
      functions = result.functions;
    } catch (e) {
      parseError = e;
    }

    // Check if it's a continuation (missing END)
    if (parseError && this._isContinuationError(parseError)) {
      this._showPrompt();
      this._startCursorBlink();
      return;
    }

    // If parse failed, try as bare expression: PRINT <source>
    if (parseError) {
      try {
        const tokens = tokenize('PRINT ' + source);
        const result = parse(tokens, this.interpreter.functions);
        ast = result.ast;
        labels = result.labels;
        functions = result.functions;
        parseError = null;
        isBareExpr = true;
      } catch (e2) {
        // Show original error
        this.screen.printInline('ERROR: ' + parseError.message, '#FF5555');
        this.screen.newline();
        this.screen.render();
        this._accumulatedLines = [];
        this._showPrompt();
        this._startCursorBlink();
        return;
      }
    }

    // Add to history (original source, not with PRINT prepended)
    const historyEntry = this._accumulatedLines.join('\n');
    if (historyEntry.trim()) {
      this._history.push(historyEntry);
    }
    this._accumulatedLines = [];
    this._historyIndex = -1;

    // Execute
    this.executing = true;
    if (this.onExecutingChange) this.onExecutingChange(true);
    try {
      await this.interpreter.execRepl(ast, labels, functions);
      this.hasState = true;
    } catch (e) {
      this.screen.printInline('ERROR: ' + e.message, '#FF5555');
      this.screen.newline();
      this.screen.render();
    }
    this.executing = false;
    if (this.onExecutingChange) this.onExecutingChange(false);

    // Ensure we're on a fresh line for the next prompt
    if (this.screen.cursorCol > 0) {
      this.screen.newline();
    }
    this.screen.render();
    this._showPrompt();
    this._startCursorBlink();
  }

  _isContinuationError(err) {
    const msg = err.message || '';
    // Parser throws "Expected KEYWORD 'END...'" or "Missing END..." when blocks are incomplete
    if (/Missing END/i.test(msg)) return true;
    if (/Expected.*END/i.test(msg)) return true;
    // Unexpected EOF while inside a block
    if (/Unexpected.*EOF/i.test(msg)) return true;
    if (/Expected.*but got.*EOF/i.test(msg)) return true;
    return false;
  }
}
