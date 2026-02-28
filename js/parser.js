function parse(tokens) {
  let pos = 0;
  const ast = [];
  const dataPool = [];
  const labels = {};

  function peek() { return tokens[pos]; }
  function advance() { return tokens[pos++]; }

  function expect(type, value) {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new SyntaxError(
        `Expected ${type}${value ? ` '${value}'` : ''} but got ${t.type} '${t.value}' at line ${t.line}`
      );
    }
    return advance();
  }

  function match(type, value) {
    const t = peek();
    if (t.type === type && (value === undefined || t.value === value)) {
      return advance();
    }
    return null;
  }

  function skipNewlines() {
    while (peek().type === 'NEWLINE') advance();
  }

  function atEnd() {
    return peek().type === 'EOF';
  }

  function atLineEnd() {
    const t = peek();
    return t.type === 'NEWLINE' || t.type === 'EOF';
  }

  // Expression parsing (precedence climbing)
  function parseExpr() {
    return parseOr();
  }

  function parseOr() {
    let left = parseAnd();
    while (match('KEYWORD', 'OR')) {
      const right = parseAnd();
      left = { type: 'binop', op: 'OR', left, right };
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    while (match('KEYWORD', 'AND')) {
      const right = parseNot();
      left = { type: 'binop', op: 'AND', left, right };
    }
    return left;
  }

  function parseNot() {
    if (match('KEYWORD', 'NOT')) {
      const expr = parseNot();
      return { type: 'unaryop', op: 'NOT', expr };
    }
    return parseComparison();
  }

  function parseComparison() {
    let left = parseAddSub();
    const t = peek();
    if (t.type === 'COMPARE') {
      const op = advance().value;
      const right = parseAddSub();
      left = { type: 'binop', op, left, right };
    }
    return left;
  }

  function parseAddSub() {
    let left = parseMulDiv();
    while (peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
      const op = advance().value;
      const right = parseMulDiv();
      left = { type: 'binop', op, left, right };
    }
    return left;
  }

  function parseMulDiv() {
    let left = parsePower();
    while (peek().type === 'OP' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = advance().value;
      const right = parsePower();
      left = { type: 'binop', op, left, right };
    }
    return left;
  }

  function parsePower() {
    let left = parseUnary();
    if (peek().type === 'OP' && peek().value === '^') {
      advance();
      const right = parseUnary();
      left = { type: 'binop', op: '^', left, right };
    }
    return left;
  }

  function parseUnary() {
    if (peek().type === 'OP' && peek().value === '-') {
      advance();
      const expr = parseAtom();
      return { type: 'unaryop', op: '-', expr };
    }
    return parseAtom();
  }

  function parseAtom() {
    const t = peek();

    if (t.type === 'NUMBER_LIT') {
      advance();
      return { type: 'number', value: t.value };
    }

    if (t.type === 'STRING_LIT') {
      advance();
      return { type: 'string', value: t.value };
    }

    if (t.type === 'NUM_VAR') {
      advance();
      return { type: 'numvar', name: t.value };
    }

    if (t.type === 'STR_VAR') {
      advance();
      return { type: 'strvar', name: t.value };
    }

    if (t.type === 'ARR_VAR') {
      advance();
      const name = t.value;
      // check for index access: arr@[idx] or arr@[i][j]
      if (peek().type === 'LBRACKET') {
        const indices = [];
        while (peek().type === 'LBRACKET') {
          advance(); // [
          indices.push(parseExpr());
          expect('RBRACKET');
        }
        return { type: 'arrindex', name, indices };
      }
      return { type: 'arrvar', name };
    }

    if (t.type === 'STRUCT_VAR') {
      advance();
      const name = t.value;
      // check for member access: myStruct&.member#
      if (peek().type === 'DOT') {
        advance(); // .
        const memberToken = advance();
        const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '!' };
        const suffix = suffixMap[memberToken.type];
        if (!suffix) throw new SyntaxError(`Expected typed member after '.' at line ${t.line}`);
        return { type: 'structmember', structName: name, memberName: memberToken.value, memberSuffix: suffix };
      }
      return { type: 'structvar', name };
    }

    if (t.type === 'BOOL_VAR') {
      advance();
      return { type: 'boolvar', name: t.value };
    }

    if (t.type === 'KEYWORD' && (t.value === 'YES' || t.value === 'NO')) {
      advance();
      return { type: 'boolean', value: t.value === 'YES' ? 1 : 0 };
    }

    if (t.type === 'LPAREN') {
      advance();
      const expr = parseExpr();
      expect('RPAREN');
      return expr;
    }

    throw new SyntaxError(`Unexpected token ${t.type} '${t.value}' at line ${t.line}`);
  }

  // Statement parsing
  function parseStatement() {
    const t = peek();

    if (t.type === 'KEYWORD' && t.value === 'PRINT') {
      return parsePrint();
    }
    if (t.type === 'KEYWORD' && t.value === 'PRINTAT') {
      return parsePrintAt();
    }
    if (t.type === 'KEYWORD' && t.value === 'CLEARSCREEN') {
      advance();
      return { type: 'clearscreen', line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'INPUT') {
      return parseInput();
    }
    if (t.type === 'KEYWORD' && t.value === 'GETKEY') {
      advance();
      const varToken = expect('STR_VAR');
      return { type: 'getkey', varName: varToken.value, line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'RANDOM') {
      advance();
      const varToken = expect('NUM_VAR');
      return { type: 'random', varName: varToken.value, line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'LABEL') {
      advance();
      const labelToken = expect('STR_VAR');
      const stmtIndex = ast.length;
      labels[labelToken.value] = stmtIndex;
      return { type: 'label', name: labelToken.value, line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'GOTO') {
      advance();
      const labelToken = expect('STR_VAR');
      return { type: 'goto', label: labelToken.value, line: t.line };
    }
if (t.type === 'KEYWORD' && t.value === 'IF') {
      return parseIf();
    }
    if (t.type === 'KEYWORD' && t.value === 'FOR') {
      return parseFor();
    }
    if (t.type === 'KEYWORD' && t.value === 'WHILE') {
      return parseWhile();
    }
    if (t.type === 'KEYWORD' && t.value === 'SETCOLOR') {
      advance();
      const expr = parseExpr();
      return { type: 'setcolor', expr, line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'BEEP') {
      advance();
      return { type: 'beep', line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'PLAY') {
      return parsePlay();
    }
    if (t.type === 'KEYWORD' && t.value === 'PLAYPOLY') {
      return parsePlayPoly();
    }
    if (t.type === 'KEYWORD' && t.value === 'PAUSEPLAY') {
      advance();
      return { type: 'pauseplay', line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'RESUMEPLAY') {
      advance();
      return { type: 'resumeplay', line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'STOPPLAY') {
      advance();
      return { type: 'stopplay', line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'DATA') {
      return parseData();
    }
    if (t.type === 'KEYWORD' && t.value === 'READ') {
      return parseRead();
    }

    // Assignment: var# = expr, var$ = expr, var@ = expr, var@[i] = expr, var& = {...}, var! = YES/NO
    if (t.type === 'NUM_VAR' || t.type === 'STR_VAR' || t.type === 'ARR_VAR' || t.type === 'STRUCT_VAR' || t.type === 'BOOL_VAR') {
      return parseAssignment();
    }

    throw new SyntaxError(`Unexpected ${t.type} '${t.value}' at line ${t.line}`);
  }

  function parsePrint() {
    const t = advance(); // PRINT
    const expr = parseExpr();
    let withColor = null;
    if (match('KEYWORD', 'WITHCOLOR')) {
      withColor = parseExpr();
    }
    return { type: 'print', expr, withColor, line: t.line };
  }

  function parsePrintAt() {
    const t = advance(); // PRINTAT
    const row = parseExpr();
    expect('COMMA');
    const col = parseExpr();
    expect('COMMA');
    const expr = parseExpr();
    let withColor = null;
    if (match('KEYWORD', 'WITHCOLOR')) {
      withColor = parseExpr();
    }
    return { type: 'printat', row, col, expr, withColor, line: t.line };
  }

  function parseInput() {
    const t = advance(); // INPUT
    const prompt = parseExpr();
    expect('COMMA');
    const varToken = advance();
    if (varToken.type !== 'NUM_VAR' && varToken.type !== 'STR_VAR') {
      throw new SyntaxError(`INPUT requires a number# or string$ variable at line ${t.line}`);
    }
    return {
      type: 'input',
      prompt,
      varType: varToken.type === 'NUM_VAR' ? 'number' : 'string',
      varName: varToken.value,
      line: t.line,
    };
  }

  function parseIf() {
    const t = advance(); // IF
    const condition = parseExpr();
    expect('KEYWORD', 'THEN');
    skipNewlines();

    const thenBody = [];
    let elseBody = null;

    while (!atEnd()) {
      skipNewlines();
      if (peek().type === 'KEYWORD' && peek().value === 'ENDIF') {
        advance();
        break;
      }
      if (peek().type === 'KEYWORD' && peek().value === 'ELSE') {
        advance();
        skipNewlines();
        elseBody = [];
        while (!atEnd()) {
          skipNewlines();
          if (peek().type === 'KEYWORD' && peek().value === 'ENDIF') {
            advance();
            break;
          }
          elseBody.push(parseStatement());
          skipNewlines();
        }
        break;
      }
      thenBody.push(parseStatement());
      skipNewlines();
    }

    return { type: 'if', condition, thenBody, elseBody, line: t.line };
  }

  function parseFor() {
    const t = advance(); // FOR
    let varName = null;
    // optional variable
    if (peek().type === 'NUM_VAR') {
      varName = advance().value;
    }
    expect('KEYWORD', 'GOESFROM');
    const lower = parseExpr();
    expect('KEYWORD', 'TO');
    const upper = parseExpr();
    let step = null;
    if (match('KEYWORD', 'WITHSTEP')) {
      step = parseExpr();
    }
    skipNewlines();

    const body = [];
    while (!atEnd()) {
      skipNewlines();
      if (peek().type === 'KEYWORD' && peek().value === 'ENDFOR') {
        advance();
        break;
      }
      body.push(parseStatement());
      skipNewlines();
    }

    return { type: 'for', varName, lower, upper, step, body, line: t.line };
  }

  function parseWhile() {
    const t = advance(); // WHILE
    const condition = parseExpr();
    skipNewlines();

    const body = [];
    while (!atEnd()) {
      skipNewlines();
      if (peek().type === 'KEYWORD' && peek().value === 'ENDWHILE') {
        advance();
        break;
      }
      body.push(parseStatement());
      skipNewlines();
    }

    return { type: 'while', condition, body, line: t.line };
  }

  function parsePlay() {
    const t = advance(); // PLAY
    const expr = parseExpr();
    let waveType = null;
    if (match('KEYWORD', 'WITHWAVE')) {
      const wt = peek();
      if (wt.type === 'KEYWORD' && ['SINE', 'SQUARE', 'SAWTOOTH', 'TRIANGLE'].includes(wt.value)) {
        waveType = advance().value.toLowerCase();
      } else {
        throw new SyntaxError(`Expected wave type after WITHWAVE at line ${t.line}`);
      }
    }
    const inBackground = !!match('KEYWORD', 'INBACKGROUND');
    const onRepeat = !!match('KEYWORD', 'ONREPEAT');
    return { type: 'play', expr, waveType, inBackground, onRepeat, line: t.line };
  }

  function parsePlayPoly() {
    const t = advance(); // PLAYPOLY
    const voices = [];
    while (peek().type === 'LBRACKET') {
      advance(); // [
      const expr = parseExpr();
      let waveType = null;
      if (match('KEYWORD', 'WITHWAVE')) {
        const wt = peek();
        if (wt.type === 'KEYWORD' && ['SINE', 'SQUARE', 'SAWTOOTH', 'TRIANGLE'].includes(wt.value)) {
          waveType = advance().value.toLowerCase();
        } else {
          throw new SyntaxError(`Expected wave type after WITHWAVE at line ${t.line}`);
        }
      }
      expect('RBRACKET');
      voices.push({ expr, waveType });
    }
    if (voices.length === 0) {
      throw new SyntaxError(`PLAYPOLY requires at least one [voice] at line ${t.line}`);
    }
    const inBackground = !!match('KEYWORD', 'INBACKGROUND');
    const onRepeat = !!match('KEYWORD', 'ONREPEAT');
    return { type: 'playpoly', voices, inBackground, onRepeat, line: t.line };
  }

  function parseData() {
    const t = advance(); // DATA
    while (!atLineEnd()) {
      const expr = parseExpr();
      if (expr.type === 'number') {
        dataPool.push(expr.value);
      } else if (expr.type === 'string') {
        dataPool.push(expr.value);
      } else {
        dataPool.push(expr);
      }
      if (!match('COMMA')) break;
    }
    return { type: 'data', line: t.line };
  }

  function parseRead() {
    const t = advance(); // READ
    const varToken = advance();
    if (varToken.type !== 'NUM_VAR' && varToken.type !== 'STR_VAR') {
      throw new SyntaxError(`READ requires a number# or string$ variable at line ${t.line}`);
    }
    return {
      type: 'read',
      varType: varToken.type === 'NUM_VAR' ? 'number' : 'string',
      varName: varToken.value,
      line: t.line,
    };
  }

  function parseAssignment() {
    const varToken = advance();
    const line = varToken.line;

    if (varToken.type === 'STRUCT_VAR') {
      // Member assignment: myStruct&.name$ = expr
      if (peek().type === 'DOT') {
        advance(); // .
        const memberToken = advance();
        const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '!' };
        const suffix = suffixMap[memberToken.type];
        if (!suffix) throw new SyntaxError(`Expected typed member after '.' at line ${line}`);
        expect('COMPARE', '=');
        const value = parseExpr();
        return { type: 'assign_struct_member', name: varToken.value, memberName: memberToken.value, memberSuffix: suffix, value, line };
      }
      // Full struct assignment: myStruct& = {.height# = 72, .name$ = "Sam"}
      expect('COMPARE', '=');
      expect('LBRACE');
      const members = [];
      if (peek().type !== 'RBRACE') {
        do {
          expect('DOT');
          const memToken = advance();
          const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '!' };
          const suffix = suffixMap[memToken.type];
          if (!suffix) throw new SyntaxError(`Expected typed member after '.' at line ${line}`);
          expect('COMPARE', '=');
          const value = parseExpr();
          members.push({ name: memToken.value, suffix, value });
        } while (match('COMMA'));
      }
      expect('RBRACE');
      return { type: 'assign_struct', name: varToken.value, members, line };
    }

    if (varToken.type === 'ARR_VAR') {
      // arr@[i] = expr  OR  arr@ = 10  OR  arr@ = [1,2,3]
      if (peek().type === 'LBRACKET') {
        // Could be index assignment arr@[i] = expr
        // Or could be array literal arr@ = [1,2,3]
        // Save position and try index assignment
        const savedPos = pos;
        const indices = [];
        try {
          while (peek().type === 'LBRACKET') {
            advance(); // [
            indices.push(parseExpr());
            expect('RBRACKET');
          }
          expect('COMPARE', '=');
          const value = parseExpr();
          return { type: 'assign_arr_index', name: varToken.value, indices, value, line };
        } catch (e) {
          // Not index assignment, restore and fall through
          pos = savedPos;
        }
      }

      expect('COMPARE', '=');

      // Array literal: [1,2,3] or [1,2,3][4,5,6]
      if (peek().type === 'LBRACKET') {
        const dimensions = [];
        while (peek().type === 'LBRACKET') {
          advance(); // [
          const items = [];
          items.push(parseExpr());
          while (match('COMMA')) {
            items.push(parseExpr());
          }
          expect('RBRACKET');
          dimensions.push(items);
        }
        if (dimensions.length === 1) {
          return { type: 'assign_arr_literal', name: varToken.value, items: dimensions[0], line };
        } else {
          return { type: 'assign_arr_multi', name: varToken.value, dimensions, line };
        }
      }

      // Size allocation: arr@ = 10 or arr@ = 10, 10
      const size1 = parseExpr();
      if (match('COMMA')) {
        const size2 = parseExpr();
        return { type: 'assign_arr_alloc2d', name: varToken.value, size1, size2, line };
      }
      return { type: 'assign_arr_alloc', name: varToken.value, size: size1, line };
    }

    expect('COMPARE', '=');
    const value = parseExpr();
    if (varToken.type === 'NUM_VAR') {
      return { type: 'assign_num', name: varToken.value, value, line };
    }
    if (varToken.type === 'BOOL_VAR') {
      return { type: 'assign_bool', name: varToken.value, value, line };
    }
    return { type: 'assign_str', name: varToken.value, value, line };
  }

  // Main parse loop
  skipNewlines();
  while (!atEnd()) {
    ast.push(parseStatement());
    skipNewlines();
  }

  return { ast, dataPool, labels };
}
