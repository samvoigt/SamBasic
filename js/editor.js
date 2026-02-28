function setupEditor(textarea, lineNumbersEl) {
  updateLineNumbers();

  textarea.addEventListener('input', updateLineNumbers);
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
    }
  });

  function updateLineNumbers() {
    const lines = textarea.value.split('\n');
    const count = lines.length;
    let html = '';
    for (let i = 1; i <= count; i++) {
      html += i + '\n';
    }
    lineNumbersEl.textContent = html;
    syncScroll();
  }

  function syncScroll() {
    lineNumbersEl.scrollTop = textarea.scrollTop;
  }

  return { updateLineNumbers };
}
