const KEYWORDS = new Set([
  'PRINT', 'PRINTAT', 'MOVECURSOR', 'CLEARSCREEN',
  'LABEL', 'GOTO', 'IF', 'THEN', 'ELSE', 'END',
  'FOR', 'FROM', 'TO', 'STEP',
  'WHILE', 'LOOP', 'WHEN', 'SETCOLOR', 'BEEP', 'PLAY',
  'AND', 'OR', 'NOT',
  'SINE', 'SQUARE', 'SAWTOOTH', 'TRIANGLE',
  'PLAYPOLY',
  'PAUSEPLAY', 'RESUMEPLAY', 'STOPPLAY', 'CLOSE',
  'WRITEFILELINE', 'WRITEFILECHARACTER',
  'YES', 'NO',
  'FUNCTION', 'RETURN', 'BREAK', 'CONTINUE', 'OPTIONAL', 'REFERENCE',
  'STRUCT',
  'SLEEP', 'SIZE',
  'READ', 'WRITE', 'APPEND',
  'SORT', 'INSERT', 'REMOVE',
  'BUFFERENABLED', 'SHOWBUFFER', 'CLEARBUFFER',
  'DRAWPIXEL', 'DRAWLINE', 'DRAWBOX', 'DRAWCIRCLE', 'DRAWSPRITE', 'DRAWPATH',
  'TRANSFORM3D', 'SETCOLOR3D', 'SHOW3D', 'HIDDENEDGES3D', 'DELETE3D', 'CLEAR3D',
  'ATTACH3D', 'DETACH3D',
  'PATH3D',
]);

const TYPED_KEYWORDS = {
  INPUT: '$', GETKEY: '$', RANDOM: '#',
  LENGTH: '#', SUBSTRING: '$', UPPERCASE: '$', LOWERCASE: '$', CONTAINS: '?',
  ABS: '#', SQRT: '#', ROUND: '#', FLOOR: '#', CEIL: '#',
  MIN: '#', MAX: '#', SIN: '#', COS: '#', LOG: '#', SIGN: '#',
  OPEN: '#', READFILELINE: '$', READFILECHARACTER: '$', ENDOFFILE: '?', READSCREEN: '$',
  TONUMBER: '#', TOSTRING: '$', INDEXOF: '#', TRIM: '$', RUNNINGTIME: '#', FILEEXISTS: '?',
  CREATESPRITE: '#',
  OBJECT3D: '#',
  GROUP3D: '#',
  PATH3D: '#',
};


function tokenize(source) {
  const tokens = [];
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let parenDepth = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let i = 0;

    while (i < line.length) {
      // skip whitespace
      if (line[i] === ' ' || line[i] === '\t') {
        i++;
        continue;
      }

      // comment
      if (line[i] === "'") break;

      const startCol = i;

      // string literal
      if (line[i] === '"') {
        i++;
        let str = '';
        while (i < line.length && line[i] !== '"') {
          if (line[i] === '\\' && i + 1 < line.length) {
            i++;
            switch (line[i]) {
              case '"': str += '"'; break;
              case '\\': str += '\\'; break;
              case 'n': str += '\n'; break;
              case 't': str += '\t'; break;
              default: str += '\\' + line[i]; break;
            }
            i++;
            continue;
          }
          str += line[i];
          i++;
        }
        if (i < line.length) i++; // closing quote
        tokens.push({ type: 'STRING_LIT', value: str, line: lineNum + 1, col: startCol });
        continue;
      }

      // number literal
      if (/\d/.test(line[i]) || (line[i] === '.' && i + 1 < line.length && /\d/.test(line[i + 1]))) {
        let num = '';
        while (i < line.length && /[\d.]/.test(line[i])) {
          num += line[i];
          i++;
        }
        tokens.push({ type: 'NUMBER_LIT', value: parseFloat(num), line: lineNum + 1, col: startCol });
        continue;
      }

      // negative number: minus followed by digit, and previous token is an operator/keyword/comma/lparen/newline or start of line
      // (handled as OP MINUS in the lexer; parser handles unary minus)

      // comparison operators
      if (line[i] === '<') {
        if (line[i + 1] === '>') {
          tokens.push({ type: 'COMPARE', value: '<>', line: lineNum + 1, col: startCol });
          i += 2;
        } else if (line[i + 1] === '=') {
          tokens.push({ type: 'COMPARE', value: '<=', line: lineNum + 1, col: startCol });
          i += 2;
        } else {
          tokens.push({ type: 'COMPARE', value: '<', line: lineNum + 1, col: startCol });
          i++;
        }
        continue;
      }

      if (line[i] === '>') {
        if (line[i + 1] === '=') {
          tokens.push({ type: 'COMPARE', value: '>=', line: lineNum + 1, col: startCol });
          i += 2;
        } else {
          tokens.push({ type: 'COMPARE', value: '>', line: lineNum + 1, col: startCol });
          i++;
        }
        continue;
      }

      // single-char tokens
      if (line[i] === '(') { parenDepth++; tokens.push({ type: 'LPAREN', value: '(', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === ')') { if (parenDepth > 0) parenDepth--; tokens.push({ type: 'RPAREN', value: ')', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === '[') { tokens.push({ type: 'LBRACKET', value: '[', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === ']') { tokens.push({ type: 'RBRACKET', value: ']', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === ',') { tokens.push({ type: 'COMMA', value: ',', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === '=') { tokens.push({ type: 'COMPARE', value: '=', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === '{') { tokens.push({ type: 'LBRACE', value: '{', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === '}') { tokens.push({ type: 'RBRACE', value: '}', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === '.') { tokens.push({ type: 'DOT', value: '.', line: lineNum + 1, col: startCol }); i++; continue; }

      // operators
      if ('+-*/^%'.includes(line[i])) {
        tokens.push({ type: 'OP', value: line[i], line: lineNum + 1, col: startCol });
        i++;
        continue;
      }

      // identifiers, keywords, and variables (suffix sigil)
      if (/[a-zA-Z_]/.test(line[i])) {
        let word = '';
        while (i < line.length && /[a-zA-Z0-9_]/.test(line[i])) {
          word += line[i];
          i++;
        }
        // Check for variable suffix: name# name$ name@ name& name!
        if (i < line.length && (line[i] === '#' || line[i] === '$' || line[i] === '@' || line[i] === '&' || line[i] === '?')) {
          const suffix = line[i];
          i++;
          const upper = word.toUpperCase();
          const expectedSuffix = TYPED_KEYWORDS[upper];
          if (expectedSuffix !== undefined) {
            if (suffix === expectedSuffix) {
              tokens.push({ type: 'KEYWORD', value: upper, line: lineNum + 1, col: startCol });
              continue;
            }
            throw new SyntaxError(`Wrong suffix for '${upper}' — expected '${upper}${expectedSuffix}' but got '${word}${suffix}' at line ${lineNum + 1}, col ${startCol + 1}`);
          }
          const typeMap = { '#': 'NUM_VAR', '$': 'STR_VAR', '@': 'ARR_VAR', '&': 'STRUCT_VAR', '?': 'BOOL_VAR' };
          tokens.push({ type: typeMap[suffix], value: word, line: lineNum + 1, col: startCol });
          continue;
        }
        const upper = word.toUpperCase();
        if (KEYWORDS.has(upper)) {
          tokens.push({ type: 'KEYWORD', value: upper, line: lineNum + 1, col: startCol });
        } else {
          tokens.push({ type: 'IDENT', value: word, line: lineNum + 1, col: startCol });
        }
        continue;
      }

      throw new SyntaxError(`Unexpected character '${line[i]}' at line ${lineNum + 1}, col ${i + 1}`);
    }

    if (parenDepth === 0) {
      tokens.push({ type: 'NEWLINE', value: '\n', line: lineNum + 1, col: i });
    }
  }

  // Merge END + block keyword pairs into single tokens
  const END_BLOCKS = new Set(['IF', 'FOR', 'WHILE', 'LOOP', 'STRUCT', 'FUNCTION', 'PATH3D']);
  const merged = [];
  for (let j = 0; j < tokens.length; j++) {
    const tok = tokens[j];
    if (tok.type === 'KEYWORD' && tok.value === 'END') {
      const next = tokens[j + 1];
      if (next && next.type === 'KEYWORD' && END_BLOCKS.has(next.value)) {
        merged.push({ type: 'KEYWORD', value: 'END_' + next.value, line: tok.line, col: tok.col });
        j++;
        continue;
      }
    }
    merged.push(tok);
  }

  merged.push({ type: 'EOF', value: null, line: lines.length, col: 0 });
  return merged;
}

function tokenizeForHighlight(source) {
  const tokens = [];
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let parenDepth = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let i = 0;

    try {
      while (i < line.length) {
        if (line[i] === ' ' || line[i] === '\t') {
          i++;
          continue;
        }

        // comment — emit as token instead of skipping
        if (line[i] === "'") {
          tokens.push({ type: 'COMMENT', value: line.slice(i), line: lineNum + 1, col: i, end: line.length });
          i = line.length;
          break;
        }

        const startCol = i;

        // string literal
        if (line[i] === '"') {
          i++;
          while (i < line.length && line[i] !== '"') {
            if (line[i] === '\\' && i + 1 < line.length) { i += 2; continue; }
            i++;
          }
          if (i < line.length) i++; // closing quote
          tokens.push({ type: 'STRING_LIT', value: line.slice(startCol, i), line: lineNum + 1, col: startCol, end: i });
          continue;
        }

        // number literal
        if (/\d/.test(line[i]) || (line[i] === '.' && i + 1 < line.length && /\d/.test(line[i + 1]))) {
          while (i < line.length && /[\d.]/.test(line[i])) i++;
          tokens.push({ type: 'NUMBER_LIT', value: line.slice(startCol, i), line: lineNum + 1, col: startCol, end: i });
          continue;
        }

        // comparison operators
        if (line[i] === '<') {
          if (line[i + 1] === '>' || line[i + 1] === '=') { i += 2; } else { i++; }
          tokens.push({ type: 'COMPARE', value: line.slice(startCol, i), line: lineNum + 1, col: startCol, end: i });
          continue;
        }
        if (line[i] === '>') {
          if (line[i + 1] === '=') { i += 2; } else { i++; }
          tokens.push({ type: 'COMPARE', value: line.slice(startCol, i), line: lineNum + 1, col: startCol, end: i });
          continue;
        }

        // single-char tokens
        if (line[i] === '(') { parenDepth++; tokens.push({ type: 'LPAREN', value: '(', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }
        if (line[i] === ')') { if (parenDepth > 0) parenDepth--; tokens.push({ type: 'RPAREN', value: ')', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }
        if (line[i] === '[') { tokens.push({ type: 'LBRACKET', value: '[', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }
        if (line[i] === ']') { tokens.push({ type: 'RBRACKET', value: ']', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }
        if (line[i] === ',') { tokens.push({ type: 'COMMA', value: ',', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }
        if (line[i] === '=') { tokens.push({ type: 'COMPARE', value: '=', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }
        if (line[i] === '{') { tokens.push({ type: 'LBRACE', value: '{', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }
        if (line[i] === '}') { tokens.push({ type: 'RBRACE', value: '}', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }
        if (line[i] === '.') { tokens.push({ type: 'DOT', value: '.', line: lineNum + 1, col: startCol, end: i + 1 }); i++; continue; }

        // operators
        if ('+-*/^%'.includes(line[i])) {
          tokens.push({ type: 'OP', value: line[i], line: lineNum + 1, col: startCol, end: i + 1 });
          i++;
          continue;
        }

        // identifiers, keywords, variables
        if (/[a-zA-Z_]/.test(line[i])) {
          while (i < line.length && /[a-zA-Z0-9_]/.test(line[i])) i++;
          // Check for variable suffix
          if (i < line.length && '#$@&?'.includes(line[i])) {
            const suffix = line[i];
            i++;
            const word = line.slice(startCol, i - 1);
            const upper = word.toUpperCase();
            if (TYPED_KEYWORDS[upper] !== undefined) {
              tokens.push({ type: 'TYPED_KW', value: line.slice(startCol, i), line: lineNum + 1, col: startCol, end: i });
            } else {
              const typeMap = { '#': 'NUM_VAR', '$': 'STR_VAR', '@': 'ARR_VAR', '&': 'STRUCT_VAR', '?': 'BOOL_VAR' };
              tokens.push({ type: typeMap[suffix], value: line.slice(startCol, i), line: lineNum + 1, col: startCol, end: i });
            }
            continue;
          }
          const word = line.slice(startCol, i);
          const upper = word.toUpperCase();
          if (KEYWORDS.has(upper)) {
            tokens.push({ type: 'KEYWORD', value: word, line: lineNum + 1, col: startCol, end: i });
          } else {
            tokens.push({ type: 'IDENT', value: word, line: lineNum + 1, col: startCol, end: i });
          }
          continue;
        }

        // unknown char — skip it
        i++;
      }
    } catch (_) {
      // On error, emit remainder of line as plain text
      if (i < line.length) {
        tokens.push({ type: 'TEXT', value: line.slice(i), line: lineNum + 1, col: i, end: line.length });
      }
    }
  }

  return tokens;
}
