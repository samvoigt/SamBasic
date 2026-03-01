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
  }

  updateLineNumbers();
  highlight();

  textarea.addEventListener('input', () => {
    updateLineNumbers();
    highlight();
  });
  textarea.addEventListener('scroll', syncScroll);

  // Tab key inserts spaces
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      textarea.value = value.substring(0, start) + '    ' + value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 4;
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
