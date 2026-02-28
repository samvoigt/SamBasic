const KEYWORDS = new Set([
  'PRINT', 'PRINTAT', 'CLEARSCREEN', 'INPUT', 'GETKEY', 'RANDOM',
  'LABEL', 'GOTO', 'IF', 'THEN', 'ELSE', 'ENDIF',
  'FOR', 'GOESFROM', 'TO', 'WITHSTEP', 'ENDFOR',
  'WHILE', 'ENDWHILE', 'SETCOLOR', 'BEEP', 'PLAY', 'WITHWAVE',
  'DATA', 'READ', 'AND', 'OR', 'NOT', 'WITHCOLOR',
  'SINE', 'SQUARE', 'SAWTOOTH', 'TRIANGLE',
  'PLAYPOLY',
  'INBACKGROUND', 'ONREPEAT', 'PAUSEPLAY', 'RESUMEPLAY', 'STOPPLAY',
  'YES', 'NO',
  'FUNCTION', 'ENDFUNCTION', 'RETURN', 'OPTIONAL',
]);


function tokenize(source) {
  const tokens = [];
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

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
        } else if (i + 1 < line.length && /[a-zA-Z]/.test(line[i + 1])) {
          // FUNC_REF: >name or >name# etc.
          i++; // skip >
          let name = '';
          while (i < line.length && /[a-zA-Z0-9_]/.test(line[i])) {
            name += line[i];
            i++;
          }
          let suffix = '';
          if (i < line.length && '#$@&!'.includes(line[i])) {
            suffix = line[i];
            i++;
          }
          tokens.push({ type: 'FUNC_REF', value: name, suffix, line: lineNum + 1, col: startCol });
        } else {
          tokens.push({ type: 'COMPARE', value: '>', line: lineNum + 1, col: startCol });
          i++;
        }
        continue;
      }

      // single-char tokens
      if (line[i] === '(') { tokens.push({ type: 'LPAREN', value: '(', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === ')') { tokens.push({ type: 'RPAREN', value: ')', line: lineNum + 1, col: startCol }); i++; continue; }
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
        if (i < line.length && (line[i] === '#' || line[i] === '$' || line[i] === '@' || line[i] === '&' || line[i] === '!')) {
          const suffix = line[i];
          i++;
          const typeMap = { '#': 'NUM_VAR', '$': 'STR_VAR', '@': 'ARR_VAR', '&': 'STRUCT_VAR', '!': 'BOOL_VAR' };
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

    tokens.push({ type: 'NEWLINE', value: '\n', line: lineNum + 1, col: i });
  }

  tokens.push({ type: 'EOF', value: null, line: lines.length, col: 0 });
  return tokens;
}
