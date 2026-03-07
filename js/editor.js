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

      if (i < lines.length - 1) html += '\n';
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
  });
  textarea.addEventListener('scroll', syncScroll);

  const BLOCK_OPENERS = /^\s*(IF\b|FOR\b|WHILE\b|LOOP\b|FUNCTION\b|STRUCT\b|PATH3D|ELSE\b|ELSEIF\b)/i;
  const BLOCK_CLOSERS = /^\s*END\s+(IF|FOR|WHILE|LOOP|FUNCTION|STRUCT|PATH3D)\b/i;
  const INDENT = '    ';

  textarea.addEventListener('keydown', (e) => {
    // Tab key inserts spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      textarea.value = value.substring(0, start) + INDENT + value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 4;
      updateLineNumbers();
      highlight();
    }

    // Enter key auto-indents
    if (e.key === 'Enter') {
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
      // Get the full current line (not just up to cursor) for keyword detection
      const lineEnd = value.indexOf('\n', start);
      const fullLine = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
      if (BLOCK_OPENERS.test(fullLine)) {
        indent += INDENT;
      } else if (BLOCK_CLOSERS.test(fullLine) && indent.length >= INDENT.length) {
        // Dedent the END line itself
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

  function updateLineNumbers() {
    const lines = textarea.value.split('\n');
    const count = lines.length;
    let nums = '';
    for (let i = 1; i <= count; i++) {
      nums += i + '\n';
    }
    lineNumbersEl.textContent = nums;
    syncScroll();
  }

  function syncScroll() {
    lineNumbersEl.scrollTop = textarea.scrollTop;
    highlightEl.scrollTop = textarea.scrollTop;
    highlightEl.scrollLeft = textarea.scrollLeft;
  }

  return { updateLineNumbers, highlight };
}
