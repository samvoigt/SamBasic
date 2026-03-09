const editorBreakpoints = new Set();
let highlightedLine = 0;
let _prevLineCount = 0;
let _editLine = 0;
let _editCol = 0;

function setupEditor(textarea, lineNumbersEl, highlightEl) {
  const TOKEN_CLASS = {
    KEYWORD: 'hl-keyword',
    TYPED_KW: 'hl-typedkw',
    STRING_LIT: 'hl-string',
    NUMBER_LIT: 'hl-number',
    COMMENT: 'hl-comment',
    OP: 'hl-operator',
    COMPARE: 'hl-operator',
    NUM_VAR: 'hl-variable',
    STR_VAR: 'hl-variable',
    ARR_VAR: 'hl-variable',
    STRUCT_VAR: 'hl-variable',
    BOOL_VAR: 'hl-variable',
    LPAREN: 'hl-punct',
    RPAREN: 'hl-punct',
    LBRACKET: 'hl-punct',
    RBRACKET: 'hl-punct',
    LBRACE: 'hl-punct',
    RBRACE: 'hl-punct',
    COMMA: 'hl-punct',
    DOT: 'hl-punct',
  };

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight() {
    const source = textarea.value;
    const lines = source.split('\n');
    const tokens = tokenizeForHighlight(source);

    // Group tokens by line
    const tokensByLine = {};
    for (const tok of tokens) {
      if (!tokensByLine[tok.line]) tokensByLine[tok.line] = [];
      tokensByLine[tok.line].push(tok);
    }

    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const lineTokens = tokensByLine[lineNum] || [];
      let col = 0;

      const hlClass = lineNum === highlightedLine ? ' hl-break' : '';
      html += '<div class="hl-line' + hlClass + '">';

      for (const tok of lineTokens) {
        // Emit gap (whitespace) before this token
        if (tok.col > col) {
          html += escapeHtml(line.slice(col, tok.col));
        }
        const cls = TOKEN_CLASS[tok.type];
        const text = escapeHtml(line.slice(tok.col, tok.end));
        if (cls) {
          html += '<span class="' + cls + '">' + text + '</span>';
        } else {
          html += text;
        }
        col = tok.end;
      }

      // Emit any remaining text on the line
      if (col < line.length) {
        html += escapeHtml(line.slice(col));
      }

      // Ensure empty lines still have height
      if (line.length === 0) html += '\n';

      html += '</div>';
    }

    highlightEl.innerHTML = html;
    // Textareas allow scrolling the last line to near the top of the
    // view; <pre> stops when content ends.  Add bottom padding so the
    // pre's scrollable range matches the textarea's.
    highlightEl.style.paddingBottom = highlightEl.clientHeight + 'px';
    syncScroll();
  }

  updateLineNumbers();
  highlight();

  // All keywords that should auto-capitalize
  const ALL_KEYWORDS = new Set([...KEYWORDS, ...Object.keys(TYPED_KEYWORDS)]);

  // Auto-capitalize the keyword immediately before the cursor.
  // `atEnd` means the cursor is at the end of a word (e.g. Enter pressed)
  // rather than after a delimiter character.
  function autoCapitalize(atEnd) {
    const pos = textarea.selectionStart;
    const val = textarea.value;
    const before = val.slice(0, pos);
    const pattern = atEnd
      ? /([a-zA-Z]+[#$@&?]?)$/
      : /([a-zA-Z]+[#$@&?]?)(?:\W)$/;
    const match = before.match(pattern);
    if (!match) return;
    const word = match[1];
    const base = word.replace(/[#$@&?]$/, '');
    const suffix = word.slice(base.length);
    const upper = base.toUpperCase();
    if (ALL_KEYWORDS.has(upper) && word !== upper + suffix) {
      const wordStart = pos - word.length - (atEnd ? 0 : 1);
      const sep = atEnd ? '' : val[pos - 1];
      textarea.value = val.substring(0, wordStart) + upper + suffix + sep + val.substring(pos);
      textarea.selectionStart = textarea.selectionEnd = pos;
    }
  }

  // === Autocomplete ===
  const acDropdown = document.getElementById('autocomplete-dropdown');
  let acItems = [];
  let acIndex = 0;
  let acPrefix = '';
  let acActive = false;

  // Build keyword list with types for display
  const AC_KEYWORD_LIST = [...KEYWORDS].map(k => ({ name: k, type: 'keyword' }));
  const AC_TYPED_KW_LIST = Object.keys(TYPED_KEYWORDS).map(k => ({ name: k + TYPED_KEYWORDS[k], type: 'function' }));
  const AC_BUILTINS = AC_KEYWORD_LIST.concat(AC_TYPED_KW_LIST);

  function getUserIdentifiers() {
    const seen = new Set();
    const results = [];
    try {
      const tokens = tokenizeForHighlight(textarea.value);
      for (const tok of tokens) {
        if (['NUM_VAR', 'STR_VAR', 'ARR_VAR', 'STRUCT_VAR', 'BOOL_VAR', 'IDENT'].includes(tok.type)) {
          const name = tok.value;
          if (name && !seen.has(name)) {
            seen.add(name);
            const type = tok.type === 'IDENT' ? 'ident' : 'variable';
            results.push({ name, type });
          }
        }
      }
    } catch (e) { /* ignore parse errors */ }
    return results;
  }

  function getWordBeforeCursor() {
    const pos = textarea.selectionStart;
    const val = textarea.value;
    let start = pos;
    while (start > 0 && /[a-zA-Z0-9_#$@&?]/.test(val[start - 1])) start--;
    return { word: val.slice(start, pos), start, end: pos };
  }

  function updateAutocomplete() {
    const { word } = getWordBeforeCursor();
    if (word.length < 2) {
      closeAutocomplete();
      return;
    }
    const prefix = word.toUpperCase();
    const allItems = AC_BUILTINS.concat(getUserIdentifiers());
    // Filter: prefix match, case-insensitive, deduplicate
    const seen = new Set();
    const matches = [];
    for (const item of allItems) {
      const upper = item.name.toUpperCase();
      if (upper.startsWith(prefix) && upper !== prefix && !seen.has(upper)) {
        seen.add(upper);
        matches.push(item);
        if (matches.length >= 8) break;
      }
    }
    if (matches.length === 0) {
      closeAutocomplete();
      return;
    }
    acItems = matches;
    acPrefix = word;
    acIndex = 0;
    acActive = true;
    renderAutocomplete();
    positionAutocomplete();
  }

  function renderAutocomplete() {
    let html = '';
    for (let i = 0; i < acItems.length; i++) {
      const sel = i === acIndex ? ' selected' : '';
      const typeLabel = acItems[i].type === 'keyword' ? 'kw' :
                        acItems[i].type === 'function' ? 'fn' :
                        acItems[i].type === 'variable' ? 'var' : '';
      html += '<div class="autocomplete-item' + sel + '" data-index="' + i + '">';
      html += escapeHtml(acItems[i].name);
      if (typeLabel) html += '<span class="ac-type">' + typeLabel + '</span>';
      html += '</div>';
    }
    acDropdown.innerHTML = html;
    acDropdown.classList.add('open');
    // Scroll selected item into view
    const selEl = acDropdown.querySelector('.selected');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  function positionAutocomplete() {
    const pos = textarea.selectionStart;
    const val = textarea.value;
    const before = val.slice(0, pos);
    const lines = before.split('\n');
    const row = lines.length - 1;
    const col = lines[row].length;
    // 14px font, 1.5 line-height = 21px per line; ~8.4px per char for Courier New 14px
    const lineHeight = 21;
    const charWidth = 8.4;
    const padding = 12;
    const lineNumWidth = 48;
    const top = (row + 1) * lineHeight + padding - textarea.scrollTop;
    const left = col * charWidth + padding + lineNumWidth - textarea.scrollLeft;
    acDropdown.style.top = top + 'px';
    acDropdown.style.left = left + 'px';
  }

  function closeAutocomplete() {
    acActive = false;
    acItems = [];
    acDropdown.classList.remove('open');
    acDropdown.innerHTML = '';
  }

  function acceptAutocomplete() {
    if (!acActive || acItems.length === 0) return false;
    const item = acItems[acIndex];
    const { start, end } = getWordBeforeCursor();
    const val = textarea.value;
    // Insert the completed name, auto-capitalizing keywords
    const completion = item.name;
    textarea.value = val.substring(0, start) + completion + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + completion.length;
    closeAutocomplete();
    updateLineNumbers();
    highlight();
    return true;
  }

  // Mouse interaction with dropdown
  acDropdown.addEventListener('mousedown', (e) => {
    e.preventDefault(); // prevent textarea blur
    const itemEl = e.target.closest('.autocomplete-item');
    if (itemEl) {
      acIndex = parseInt(itemEl.dataset.index);
      acceptAutocomplete();
    }
  });

  let _saveTimer = null;
  let _dirty = false;
  window.addEventListener('beforeunload', () => {
    if (_dirty) localStorage.setItem('sambasic_editor_content', textarea.value);
  });
  function debouncedSave() {
    _dirty = true;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      localStorage.setItem('sambasic_editor_content', textarea.value);
      _dirty = false;
    }, 10000);
  }

  textarea.addEventListener('input', () => {
    const pos = textarea.selectionStart;
    // Only auto-capitalize when cursor follows a non-word char (word just ended)
    if (pos === 0 || /\w/.test(textarea.value[pos - 1])) {
      // Still inside a word, skip
    } else {
      autoCapitalize(false);
    }
    updateLineNumbers();
    highlight();
    updateAutocomplete();
    debouncedSave();
  });
  textarea.addEventListener('scroll', () => {
    syncScroll();
    if (acActive) positionAutocomplete();
  });
  textarea.addEventListener('blur', () => closeAutocomplete());

  function captureEditPos() {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const lines = before.split('\n');
    _editLine = lines.length;
    _editCol = lines[lines.length - 1].length;
  }

  textarea.addEventListener('beforeinput', captureEditPos);

  const BLOCK_OPENERS = /^\s*(IF\b|FOR\b|WHILE\b|LOOP\b|FUNCTION\b|STRUCT\b|PATH3D|ELSE\b|ELSEIF\b)/i;
  const BLOCK_CLOSERS = /^\s*END\s+(IF|FOR|WHILE|LOOP|FUNCTION|STRUCT|PATH3D)\b/i;
  const INDENT = '\t';

  textarea.addEventListener('keydown', (e) => {
    captureEditPos();
    // Autocomplete navigation
    if (acActive) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        acIndex = (acIndex + 1) % acItems.length;
        renderAutocomplete();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        acIndex = (acIndex - 1 + acItems.length) % acItems.length;
        renderAutocomplete();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAutocomplete();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        acceptAutocomplete();
        return;
      }
    }

    // Tab key inserts spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      textarea.value = value.substring(0, start) + INDENT + value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 1;
      updateLineNumbers();
      highlight();
    }

    // Enter key auto-indents
    if (e.key === 'Enter') {
      closeAutocomplete();
      e.preventDefault();
      autoCapitalize(true);
      const value = textarea.value;
      const start = textarea.selectionStart;
      // Find the current line
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const currentLine = value.slice(lineStart, start);
      // Get current line's leading whitespace
      const leadingMatch = currentLine.match(/^(\s*)/);
      let indent = leadingMatch ? leadingMatch[1] : '';
      // Use text before cursor for keyword detection
      if (BLOCK_OPENERS.test(currentLine)) {
        indent += INDENT;
      } else if (BLOCK_CLOSERS.test(currentLine) && indent.length >= INDENT.length) {
        // Dedent the END line itself
        const lineEnd = value.indexOf('\n', start);
        const fullLine = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
        const dedentedLine = fullLine.slice(INDENT.length);
        const newLineStart = lineStart;
        const newLineEnd = lineEnd === -1 ? value.length : lineEnd;
        indent = indent.slice(INDENT.length);
        const insert = '\n' + indent;
        textarea.value = value.substring(0, newLineStart) + dedentedLine + insert + value.substring(Math.max(textarea.selectionEnd, newLineEnd));
        textarea.selectionStart = textarea.selectionEnd = newLineStart + dedentedLine.length + insert.length;
        updateLineNumbers();
        highlight();
        return;
      }
      const insert = '\n' + indent;
      textarea.value = value.substring(0, start) + insert + value.substring(textarea.selectionEnd);
      textarea.selectionStart = textarea.selectionEnd = start + insert.length;
      updateLineNumbers();
      highlight();
    }
  });

  function adjustBreakpoints(newCount) {
    const delta = newCount - _prevLineCount;
    if (delta === 0 || _prevLineCount === 0) return;

    const updated = new Set();
    if (delta > 0) {
      // Lines inserted: shift breakpoints at or after the insert point
      const threshold = _editCol === 0 ? _editLine : _editLine + 1;
      for (const bp of editorBreakpoints) {
        updated.add(bp >= threshold ? bp + delta : bp);
      }
    } else {
      // Lines deleted: remove breakpoints in deleted range, shift rest up
      const absDelta = -delta;
      const removeStart = _editCol === 0 ? _editLine : _editLine + 1;
      const removeEnd = removeStart + absDelta - 1;
      for (const bp of editorBreakpoints) {
        if (bp >= removeStart && bp <= removeEnd) continue;
        updated.add(bp > removeEnd ? bp + delta : bp);
      }
    }
    editorBreakpoints.clear();
    for (const bp of updated) editorBreakpoints.add(bp);
  }

  function updateLineNumbers() {
    const lines = textarea.value.split('\n');
    const count = lines.length;
    if (_prevLineCount > 0 && count !== _prevLineCount) {
      adjustBreakpoints(count);
    }
    _prevLineCount = count;
    let html = '';
    for (let i = 1; i <= count; i++) {
      const hasBp = editorBreakpoints.has(i);
      html += '<div class="line-num' + (hasBp ? ' has-bp' : '') + '" data-line="' + i + '">'
            + (hasBp ? '<span class="bp-dot"></span>' : '') + i + '</div>';
    }
    lineNumbersEl.innerHTML = html;
    syncScroll();
  }

  lineNumbersEl.addEventListener('click', (e) => {
    const lineEl = e.target.closest('.line-num');
    if (!lineEl) return;
    const line = parseInt(lineEl.dataset.line);
    if (editorBreakpoints.has(line)) {
      editorBreakpoints.delete(line);
    } else {
      editorBreakpoints.add(line);
    }
    updateLineNumbers();
  });

  function syncScroll() {
    lineNumbersEl.scrollTop = textarea.scrollTop;
    highlightEl.scrollTop = textarea.scrollTop;
    highlightEl.scrollLeft = textarea.scrollLeft;
  }

  function setHighlightedLine(line) {
    highlightedLine = line;
    highlight();
  }

  return { updateLineNumbers, highlight, breakpoints: editorBreakpoints, setHighlightedLine };
}
