const KEYWORDS = new Set([
  'PRINT', 'PRINTAT', 'CLEARSCREEN', 'INPUT', 'GETKEY', 'RANDOM',
  'LABEL', 'GOTO', 'IF', 'THEN', 'ELSE', 'ENDIF',
  'FOR', 'GOESFROM', 'TO', 'WITHSTEP', 'ENDFOR',
  'WHILE', 'ENDWHILE', 'COLOR', 'BEEP', 'PLAY', 'WITHWAVE',
  'DATA', 'READ', 'AND', 'OR', 'NOT', 'WITHCOLOR',
  'SINE', 'SQUARE', 'SAWTOOTH', 'TRIANGLE',
  'PLAYPOLY',
  'INBACKGROUND', 'ONREPEAT', 'PAUSEPLAY', 'RESUMEPLAY', 'STOPPLAY',
]);

const COLOR_KEYWORDS = new Set([
  'BLACK', 'BLUE', 'GREEN', 'CYAN', 'RED', 'MAGENTA', 'BROWN',
  'LIGHTGRAY', 'DARKGRAY', 'LIGHTBLUE', 'LIGHTGREEN', 'LIGHTCYAN',
  'LIGHTRED', 'LIGHTMAGENTA', 'YELLOW', 'WHITE',
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

      // variable prefixes
      if (line[i] === '#' || line[i] === '$' || line[i] === '@') {
        const prefix = line[i];
        i++;
        let name = '';
        while (i < line.length && /[a-zA-Z0-9_]/.test(line[i])) {
          name += line[i];
          i++;
        }
        if (name === '') {
          throw new SyntaxError(`Expected variable name after '${prefix}' at line ${lineNum + 1}`);
        }
        const typeMap = { '#': 'NUM_VAR', '$': 'STR_VAR', '@': 'ARR_VAR' };
        tokens.push({ type: typeMap[prefix], value: name, line: lineNum + 1, col: startCol });
        continue;
      }

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
      if (line[i] === '(') { tokens.push({ type: 'LPAREN', value: '(', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === ')') { tokens.push({ type: 'RPAREN', value: ')', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === '[') { tokens.push({ type: 'LBRACKET', value: '[', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === ']') { tokens.push({ type: 'RBRACKET', value: ']', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === ',') { tokens.push({ type: 'COMMA', value: ',', line: lineNum + 1, col: startCol }); i++; continue; }
      if (line[i] === '=') { tokens.push({ type: 'COMPARE', value: '=', line: lineNum + 1, col: startCol }); i++; continue; }

      // operators
      if ('+-*/^%'.includes(line[i])) {
        tokens.push({ type: 'OP', value: line[i], line: lineNum + 1, col: startCol });
        i++;
        continue;
      }

      // identifiers and keywords
      if (/[a-zA-Z_]/.test(line[i])) {
        let word = '';
        while (i < line.length && /[a-zA-Z0-9_]/.test(line[i])) {
          word += line[i];
          i++;
        }
        const upper = word.toUpperCase();
        if (KEYWORDS.has(upper)) {
          tokens.push({ type: 'KEYWORD', value: upper, line: lineNum + 1, col: startCol });
        } else if (COLOR_KEYWORDS.has(upper)) {
          tokens.push({ type: 'COLOR_NAME', value: upper, line: lineNum + 1, col: startCol });
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
