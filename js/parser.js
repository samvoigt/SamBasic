function parse(tokens) {
  let pos = 0;
  const ast = [];
  const labels = {};
  const functions = {};
  let insideFunction = false;

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

  // Pre-pass: collect all function names for forward references
  const knownFunctions = {};
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'KEYWORD' && tokens[i].value === 'FUNCTION') {
      const next = tokens[i + 1];
      if (next) {
        const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?', 'IDENT': '' };
        const suffix = suffixMap[next.type];
        if (suffix !== undefined) knownFunctions[next.value] = suffix;
      }
    }
  }

  function isKnownFunction(token) {
    if (!knownFunctions.hasOwnProperty(token.value)) return false;
    const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?', 'IDENT': '' };
    const tokenSuffix = suffixMap[token.type];
    return tokenSuffix !== undefined && knownFunctions[token.value] === tokenSuffix;
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
        const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?' };
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

    if (t.type === 'KEYWORD' && t.value === 'ENDOFFILE') {
      advance();
      if (peek().type === 'IDENT' && peek().value.toUpperCase() === 'FILE') {
        advance(); // consume optional FILE label
      }
      const fileExpr = parseAtom();
      return { type: 'endoffile', file: fileExpr, line: t.line };
    }

    // Builtin keywords in expression context (e.g., 2 + RANDOM# 77)
    if (t.type === 'KEYWORD' && BUILTIN_KEYWORD_PARAMS[t.value]) {
      const kw = advance();
      const keyword = kw.value;
      const paramDefs = BUILTIN_KEYWORD_PARAMS[keyword];
      let mode = null;
      if (keyword === 'TRIM' && peek().type === 'IDENT' &&
          (peek().value.toUpperCase() === 'LEFT' || peek().value.toUpperCase() === 'RIGHT')) {
        mode = advance().value.toUpperCase();
      }
      const args = parseKeywordArgsForExpr();
      const resolved = resolveBuiltinArgs(args, paramDefs, t.line);
      return { type: 'builtin_call', keyword, params: resolved, mode, line: t.line };
    }

    // Wave type keywords as expression constants
    if (t.type === 'KEYWORD' && ['SINE', 'SQUARE', 'SAWTOOTH', 'TRIANGLE', 'READ', 'WRITE', 'APPEND'].includes(t.value)) {
      advance();
      return { type: 'string', value: t.value.toLowerCase() };
    }

    if (t.type === 'LPAREN') {
      advance();
      // Check if this is a function call in parens: (funcName ...)
      if (isKnownFunction(peek())) {
        const call = parseFunctionCallInParens();
        expect('RPAREN');
        return call;
      }
      const expr = parseExpr();
      expect('RPAREN');
      return expr;
    }

    throw new SyntaxError(`Unexpected token ${t.type} '${t.value}' at line ${t.line}`);
  }

  // --- Built-in keyword argument helpers ---

  function parseKeywordArgs() {
    const args = [];
    while (!atLineEnd()) {
      if (peek().type === 'IDENT' && !isKnownFunction(peek())) {
        const label = advance().value.toUpperCase();
        const value = parseExpr();
        args.push({ label, value });
      } else {
        const value = parseExpr();
        args.push({ label: null, value });
      }
      if (!match('COMMA')) {
        if (!atLineEnd() && peek().type === 'IDENT' && !isKnownFunction(peek())) continue;
        break;
      }
    }
    return args;
  }

  // Like parseKeywordArgs but for expression context: each arg value is parsed
  // with parseUnary() so operators like + - * / don't get consumed as arguments.
  function parseKeywordArgsForExpr() {
    const args = [];
    while (!atLineEnd()) {
      const p = peek();
      // Stop at operators, comparisons, closing delimiters, and logic keywords
      if (p.type === 'OP' || p.type === 'COMPARE' || p.type === 'RPAREN' ||
          p.type === 'RBRACKET' || p.type === 'RBRACE' ||
          (p.type === 'KEYWORD' && (p.value === 'AND' || p.value === 'OR' ||
          p.value === 'NOT' || p.value === 'THEN' || p.value === 'STEP' ||
          p.value === 'TO' || p.value === 'FROM'))) {
        break;
      }
      if (p.type === 'IDENT' && !isKnownFunction(p)) {
        const label = advance().value.toUpperCase();
        const value = parseUnary();
        args.push({ label, value });
      } else {
        const value = parseUnary();
        args.push({ label: null, value });
      }
      if (!match('COMMA')) {
        if (!atLineEnd() && peek().type === 'IDENT' && !isKnownFunction(peek())) continue;
        break;
      }
    }
    return args;
  }

  function resolveBuiltinArgs(args, paramDefs, line) {
    const assigned = new Array(paramDefs.length).fill(false);
    const resolved = {};
    let positionalIndex = 0;

    for (const arg of args) {
      if (arg.label) {
        const idx = paramDefs.findIndex(p => p.name === arg.label);
        if (idx === -1) {
          throw new SyntaxError(`Unknown parameter '${arg.label}' at line ${line}`);
        }
        if (assigned[idx]) {
          throw new SyntaxError(`Parameter '${arg.label}' already provided at line ${line}`);
        }
        assigned[idx] = true;
        resolved[paramDefs[idx].name] = arg.value;
      } else {
        while (positionalIndex < paramDefs.length && assigned[positionalIndex]) {
          positionalIndex++;
        }
        if (positionalIndex >= paramDefs.length) {
          throw new SyntaxError(`Too many arguments at line ${line}`);
        }
        assigned[positionalIndex] = true;
        resolved[paramDefs[positionalIndex].name] = arg.value;
        positionalIndex++;
      }
    }

    // Check required params
    for (let i = 0; i < paramDefs.length; i++) {
      if (!assigned[i] && paramDefs[i].required) {
        throw new SyntaxError(`Missing required parameter '${paramDefs[i].name}' at line ${line}`);
      }
    }

    return resolved;
  }

  // --- Statement parsing ---

  function parseStatement() {
    const t = peek();

    if (t.type === 'KEYWORD' && t.value === 'PRINT') {
      return parsePrint();
    }
    if (t.type === 'KEYWORD' && t.value === 'PRINTAT') {
      return parsePrintAt();
    }
    if (t.type === 'KEYWORD' && t.value === 'MOVECURSOR') {
      const mt = advance();
      const args = parseKeywordArgs();
      const resolved = resolveBuiltinArgs(args, [
        { name: 'ROW', required: true },
        { name: 'COL', required: true },
      ], mt.line);
      return { type: 'movecursor', row: resolved.ROW, col: resolved.COL, line: mt.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'CLEARSCREEN') {
      advance();
      return { type: 'clearscreen', line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'LABEL') {
      advance();
      const labelToken = expect('IDENT');
      if (!insideFunction) {
        const stmtIndex = ast.length;
        labels[labelToken.value] = stmtIndex;
      }
      return { type: 'label', name: labelToken.value, line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'GOTO') {
      advance();
      const labelToken = expect('IDENT');
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
      return parseSetcolor();
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

    if (t.type === 'KEYWORD' && t.value === 'CLOSE') {
      advance();
      const file = parseExpr();
      return { type: 'close', file, line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'WRITEFILELINE') {
      const wt = advance();
      const args = parseKeywordArgs();
      const resolved = resolveBuiltinArgs(args, [
        { name: 'FILE', required: true },
        { name: 'LINE', required: true },
      ], wt.line);
      return { type: 'writefileline', file: resolved.FILE, content: resolved.LINE, line: wt.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'WRITEFILECHARACTER') {
      const wt = advance();
      const args = parseKeywordArgs();
      const resolved = resolveBuiltinArgs(args, [
        { name: 'FILE', required: true },
        { name: 'CHARACTER', required: true },
      ], wt.line);
      return { type: 'writefilecharacter', file: resolved.FILE, character: resolved.CHARACTER, line: wt.line };
    }

    if (t.type === 'KEYWORD' && t.value === 'STRUCT') {
      return parseStructBlock();
    }
    if (t.type === 'KEYWORD' && t.value === 'FUNCTION') {
      return parseFunctionDef();
    }
    if (t.type === 'KEYWORD' && t.value === 'RETURN') {
      advance();
      let value = null;
      if (!atLineEnd()) {
        value = parseExpr();
      }
      return { type: 'return', value, line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'BREAK') {
      advance();
      return { type: 'break', line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'CONTINUE') {
      advance();
      return { type: 'continue', line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'SLEEP') {
      advance();
      const duration = parseExpr();
      return { type: 'sleep', duration, line: t.line };
    }
    if (t.type === 'KEYWORD' && t.value === 'GLOBAL') {
      if (!insideFunction) {
        throw new SyntaxError(`GLOBAL can only be used inside a function at line ${t.line}`);
      }
      advance(); // GLOBAL
      const vars = [];
      const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?' };
      const p = peek();
      const suffix = suffixMap[p.type];
      if (suffix === undefined) {
        throw new SyntaxError(`Expected typed variable after GLOBAL at line ${p.line}`);
      }
      const first = advance();
      vars.push({ name: first.value, suffix });
      while (match('COMMA')) {
        const next = peek();
        const nextSuffix = suffixMap[next.type];
        if (nextSuffix === undefined) {
          throw new SyntaxError(`Expected typed variable after GLOBAL at line ${next.line}`);
        }
        const v = advance();
        vars.push({ name: v.value, suffix: nextSuffix });
      }
      return { type: 'global_decl', vars, line: t.line };
    }
    // APPEND items@ expr
    if (t.type === 'KEYWORD' && t.value === 'APPEND') {
      advance();
      const arrToken = expect('ARR_VAR');
      const value = parseExpr();
      return { type: 'arr_append', name: arrToken.value, value, line: t.line };
    }
    // INSERT items@ index, value
    if (t.type === 'KEYWORD' && t.value === 'INSERT') {
      advance();
      const arrToken = expect('ARR_VAR');
      const index = parseExpr();
      expect('COMMA');
      const value = parseExpr();
      return { type: 'arr_insert', name: arrToken.value, index, value, line: t.line };
    }
    // REMOVE items@ index
    if (t.type === 'KEYWORD' && t.value === 'REMOVE') {
      advance();
      const arrToken = expect('ARR_VAR');
      const index = parseExpr();
      return { type: 'arr_remove', name: arrToken.value, index, line: t.line };
    }
    // SORT [ASCENDING|DESCENDING] items@
    if (t.type === 'KEYWORD' && t.value === 'SORT') {
      advance();
      let order = 'ASCENDING';
      if (peek().type === 'IDENT' &&
          (peek().value.toUpperCase() === 'ASCENDING' || peek().value.toUpperCase() === 'DESCENDING')) {
        order = advance().value.toUpperCase();
      }
      const arrToken = expect('ARR_VAR');
      return { type: 'sort', name: arrToken.value, order, line: t.line };
    }

    // Void function call: IDENT that is a known function
    if (t.type === 'IDENT' && isKnownFunction(t)) {
      const call = parseFunctionCall();
      return { type: 'void_funccall', call, line: t.line };
    }

    // Assignment: var# = expr, var$ = expr, var@ = expr, var@[i] = expr, var& = {...}, var! = YES/NO
    // Or typed function call used as void statement (return value discarded)
    if (t.type === 'NUM_VAR' || t.type === 'STR_VAR' || t.type === 'ARR_VAR' || t.type === 'STRUCT_VAR' || t.type === 'BOOL_VAR') {
      if (isKnownFunction(t)) {
        // Lookahead: if next token is = or DOT or [, treat as assignment
        const next = tokens[pos + 1];
        if (next && (
          (next.type === 'COMPARE' && next.value === '=') ||
          next.type === 'DOT' ||
          next.type === 'LBRACKET'
        )) {
          return parseAssignment();
        }
        // Otherwise it's a void function call (return value discarded)
        const call = parseFunctionCall();
        return { type: 'void_funccall', call, line: t.line };
      }
      return parseAssignment();
    }

    // Check for common mistake: lowercase keyword
    if (t.type === 'IDENT') {
      const upper = t.value.toUpperCase();
      const KEYWORDS = new Set([
        'PRINT', 'PRINTAT', 'MOVECURSOR', 'CLEARSCREEN',
        'LABEL', 'GOTO', 'IF', 'THEN', 'ELSE', 'END',
        'FOR', 'FROM', 'TO', 'STEP',
        'WHILE', 'SETCOLOR', 'BEEP', 'PLAY',
        'AND', 'OR', 'NOT',
        'FUNCTION', 'RETURN', 'BREAK', 'CONTINUE', 'OPTIONAL', 'REFERENCE', 'GLOBAL',
        'STRUCT',
        'SLEEP', 'SIZE',
        'CLOSE', 'WRITEFILELINE', 'WRITEFILECHARACTER',
        'READ', 'WRITE', 'APPEND',
        'SORT', 'INSERT', 'REMOVE',
      ]);
      if (KEYWORDS.has(upper)) {
        throw new SyntaxError(`Did you mean '${upper}'? Keywords must be UPPERCASE at line ${t.line}`);
      }
      const TYPED_KW_SUFFIXES = {
        INPUT: '$', GETKEY: '$', RANDOM: '#',
        LENGTH: '#', SUBSTRING: '$', UPPERCASE: '$', LOWERCASE: '$', CONTAINS: '?',
        ABS: '#', SQRT: '#', ROUND: '#', FLOOR: '#', CEIL: '#',
        MIN: '#', MAX: '#', SIN: '#', COS: '#', LOG: '#', SIGN: '#',
        OPEN: '#', READFILELINE: '$', READFILECHARACTER: '$', ENDOFFILE: '?',
        TONUMBER: '#', TOSTRING: '$', INDEXOF: '#', TRIM: '$',
      };
      if (TYPED_KW_SUFFIXES[upper]) {
        throw new SyntaxError(`Did you mean '${upper}${TYPED_KW_SUFFIXES[upper]}'? Keywords must be UPPERCASE at line ${t.line}`);
      }
    }

    throw new SyntaxError(`Unexpected ${t.type} '${t.value}' at line ${t.line}`);
  }

  function parsePrint() {
    const t = advance(); // PRINT
    const args = parseKeywordArgs();
    const resolved = resolveBuiltinArgs(args, [
      { name: 'TEXT', required: true },
      { name: 'COLOR', required: false },
    ], t.line);
    return { type: 'print', expr: resolved.TEXT, withColor: resolved.COLOR || null, line: t.line };
  }

  function parsePrintAt() {
    const t = advance(); // PRINTAT
    const args = parseKeywordArgs();
    const resolved = resolveBuiltinArgs(args, [
      { name: 'ROW', required: true },
      { name: 'COL', required: true },
      { name: 'TEXT', required: true },
      { name: 'COLOR', required: false },
    ], t.line);
    return { type: 'printat', row: resolved.ROW, col: resolved.COL, expr: resolved.TEXT, withColor: resolved.COLOR || null, line: t.line };
  }

  function parseSetcolor() {
    const t = advance(); // SETCOLOR
    const args = parseKeywordArgs();
    const resolved = resolveBuiltinArgs(args, [
      { name: 'COLOR', required: true },
    ], t.line);
    return { type: 'setcolor', expr: resolved.COLOR, line: t.line };
  }

  function parsePlay() {
    const t = advance(); // PLAY
    const args = parseKeywordArgs();
    const resolved = resolveBuiltinArgs(args, [
      { name: 'NOTES', required: true },
      { name: 'WAVE', required: false },
      { name: 'BACKGROUND', required: false },
      { name: 'REPEAT', required: false },
    ], t.line);
    return {
      type: 'play',
      expr: resolved.NOTES,
      waveExpr: resolved.WAVE || null,
      backgroundExpr: resolved.BACKGROUND || null,
      repeatExpr: resolved.REPEAT || null,
      line: t.line,
    };
  }

  function parsePlayPoly() {
    const t = advance(); // PLAYPOLY
    const voices = [];
    while (peek().type === 'LBRACKET') {
      advance(); // [
      const expr = parseExpr();
      let waveExpr = null;
      // Check for WAVE inside bracket: IDENT "WAVE" followed by expression
      if (peek().type === 'IDENT' && peek().value.toUpperCase() === 'WAVE') {
        advance(); // consume WAVE ident
        waveExpr = parseExpr();
      }
      expect('RBRACKET');
      voices.push({ expr, waveExpr });
    }
    if (voices.length === 0) {
      throw new SyntaxError(`PLAYPOLY requires at least one [voice] at line ${t.line}`);
    }
    // Parse optional trailing args for BACKGROUND and REPEAT
    let backgroundExpr = null;
    let repeatExpr = null;
    match('COMMA');
    if (!atLineEnd()) {
      const args = parseKeywordArgs();
      const resolved = resolveBuiltinArgs(args, [
        { name: 'BACKGROUND', required: false },
        { name: 'REPEAT', required: false },
      ], t.line);
      backgroundExpr = resolved.BACKGROUND || null;
      repeatExpr = resolved.REPEAT || null;
    }
    return { type: 'playpoly', voices, backgroundExpr, repeatExpr, line: t.line };
  }

  function parseIf() {
    const t = advance(); // IF
    return parseIfChain(t);
  }

  function parseIfChain(t) {
    const condition = parseExpr();
    expect('KEYWORD', 'THEN');
    skipNewlines();

    const thenBody = [];
    let elseBody = null;

    let foundEnd = false;
    while (!atEnd()) {
      skipNewlines();
      if (peek().type === 'KEYWORD' && peek().value === 'END_IF') {
        advance();
        foundEnd = true;
        break;
      }
      if (peek().type === 'KEYWORD' && peek().value === 'ELSE') {
        const elseToken = advance(); // consume ELSE
        skipNewlines();
        // ELSE IF → recurse into parseIfChain
        if (peek().type === 'KEYWORD' && peek().value === 'IF') {
          advance(); // consume IF
          const nested = parseIfChain(elseToken);
          elseBody = [nested];
          foundEnd = true;
          break;
        }
        // Plain ELSE
        elseBody = [];
        while (!atEnd()) {
          skipNewlines();
          if (peek().type === 'KEYWORD' && peek().value === 'END_IF') {
            advance();
            foundEnd = true;
            break;
          }
          elseBody.push(parseStatement());
          skipNewlines();
        }
        if (!foundEnd) throw new SyntaxError(`Missing END IF for IF at line ${t.line}`);
        break;
      }
      thenBody.push(parseStatement());
      skipNewlines();
    }
    if (!foundEnd) throw new SyntaxError(`Missing END IF for IF at line ${t.line}`);

    return { type: 'if', condition, thenBody, elseBody, line: t.line };
  }

  function parseFor() {
    const t = advance(); // FOR
    let varName = null;
    // optional variable
    if (peek().type === 'NUM_VAR') {
      varName = advance().value;
    }
    expect('KEYWORD', 'FROM');
    const lower = parseExpr();
    expect('KEYWORD', 'TO');
    const upper = parseExpr();
    let step = null;
    if (match('KEYWORD', 'STEP')) {
      step = parseExpr();
    }
    skipNewlines();

    const body = [];
    let foundEnd = false;
    while (!atEnd()) {
      skipNewlines();
      if (peek().type === 'KEYWORD' && peek().value === 'END_FOR') {
        advance();
        foundEnd = true;
        break;
      }
      body.push(parseStatement());
      skipNewlines();
    }
    if (!foundEnd) throw new SyntaxError(`Missing END FOR for FOR at line ${t.line}`);

    return { type: 'for', varName, lower, upper, step, body, line: t.line };
  }

  function parseWhile() {
    const t = advance(); // WHILE
    const condition = parseExpr();
    skipNewlines();

    const body = [];
    let foundEnd = false;
    while (!atEnd()) {
      skipNewlines();
      if (peek().type === 'KEYWORD' && peek().value === 'END_WHILE') {
        advance();
        foundEnd = true;
        break;
      }
      body.push(parseStatement());
      skipNewlines();
    }
    if (!foundEnd) throw new SyntaxError(`Missing END WHILE for WHILE at line ${t.line}`);

    return { type: 'while', condition, body, line: t.line };
  }

  function parseStructBlock() {
    const t = advance(); // STRUCT
    const varToken = expect('STRUCT_VAR');
    skipNewlines();
    const members = [];
    let foundEnd = false;
    while (!atEnd()) {
      skipNewlines();
      if (peek().type === 'KEYWORD' && peek().value === 'END_STRUCT') {
        advance();
        foundEnd = true;
        break;
      }
      expect('DOT');
      const memToken = advance();
      const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?' };
      const suffix = suffixMap[memToken.type];
      if (!suffix) throw new SyntaxError(`Expected typed member after '.' at line ${memToken.line}`);
      expect('COMPARE', '=');
      const value = parseExpr();
      members.push({ name: memToken.value, suffix, value });
      skipNewlines();
    }
    if (!foundEnd) throw new SyntaxError(`Missing END STRUCT for STRUCT at line ${t.line}`);
    return { type: 'assign_struct', name: varToken.value, members, line: t.line };
  }

  function parseFunctionDef() {
    if (insideFunction) {
      throw new SyntaxError(`Nested function definitions are not allowed at line ${peek().line}`);
    }
    const t = advance(); // FUNCTION
    const ref = advance();
    const name = ref.value;
    const typeSuffixMap = { 'NUM_VAR': 'num', 'STR_VAR': 'str', 'ARR_VAR': 'arr', 'STRUCT_VAR': 'struct', 'BOOL_VAR': 'bool', 'IDENT': 'void' };
    const returnType = typeSuffixMap[ref.type];
    if (returnType === undefined) {
      throw new SyntaxError(`Expected function name after FUNCTION at line ${ref.line}`);
    }
    // Parse parameters until end of line
    const params = [];
    let optionalStarted = false;
    while (!atLineEnd()) {
      if (match('KEYWORD', 'OPTIONAL')) {
        optionalStarted = true;
        continue;
      }
      let isReference = false;
      if (match('KEYWORD', 'REFERENCE')) {
        isReference = true;
      }
      // Parameter: LABEL typedVar
      // IDENT is the label, then a typed var token follows
      const p = peek();
      let label = null;
      if (p.type === 'IDENT') {
        label = advance().value;
      }
      const varToken = advance();
      const paramTypeMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?' };
      const paramSuffix = paramTypeMap[varToken.type];
      if (!paramSuffix) {
        throw new SyntaxError(`Expected typed variable for parameter at line ${varToken.line}`);
      }
      if (isReference && paramSuffix !== '@' && paramSuffix !== '$' && paramSuffix !== '&') {
        throw new SyntaxError(`REFERENCE can only be used with @, $, or & parameters at line ${varToken.line}`);
      }
      params.push({
        label: label || null,
        varName: varToken.value,
        varSuffix: paramSuffix,
        optional: optionalStarted,
        reference: isReference,
      });
    }
    skipNewlines();

    // Parse body
    insideFunction = true;
    const body = [];
    let foundEnd = false;
    while (!atEnd()) {
      skipNewlines();
      if (peek().type === 'KEYWORD' && peek().value === 'END_FUNCTION') {
        advance();
        foundEnd = true;
        break;
      }
      body.push(parseStatement());
      skipNewlines();
    }
    insideFunction = false;
    if (!foundEnd) throw new SyntaxError(`Missing END FUNCTION for FUNCTION at line ${t.line}`);

    // Post-pass: collect labels from body into localLabels
    const localLabels = {};
    for (let i = 0; i < body.length; i++) {
      if (body[i].type === 'label') {
        localLabels[body[i].name] = i;
      }
    }

    // Validate GLOBAL declarations: must precede any non-global_decl statement
    let seenNonGlobal = false;
    const globals = [];
    for (let i = 0; i < body.length; i++) {
      if (body[i].type === 'global_decl') {
        if (seenNonGlobal) {
          throw new SyntaxError(`GLOBAL must appear before other statements in function at line ${body[i].line}`);
        }
        for (const v of body[i].vars) {
          // Check no conflict with parameter names
          const paramKey = v.name + v.suffix;
          for (const p of params) {
            if (p.varName + p.varSuffix === paramKey) {
              throw new SyntaxError(`GLOBAL variable '${paramKey}' conflicts with parameter '${paramKey}' at line ${body[i].line}`);
            }
          }
          globals.push(v);
        }
      } else {
        seenNonGlobal = true;
      }
    }

    functions[name] = { params, returnType, body, localLabels, globals };
    return { type: 'funcdef', name, line: t.line };
  }

  function parseFunctionCall() {
    const ref = advance(); // IDENT or typed var (function name)
    const name = ref.value;
    const suffixFromType = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?', 'IDENT': '' };
    const suffix = suffixFromType[ref.type] || '';
    const args = [];

    while (!atLineEnd()) {
      // Named argument: IDENT that is NOT a known function, followed by expression
      if (peek().type === 'IDENT' && !isKnownFunction(peek())) {
        const label = advance().value;
        const value = parseExpr();
        args.push({ label, value });
      } else {
        // Positional argument
        const value = parseExpr();
        args.push({ label: null, value });
      }
      if (!match('COMMA')) break;
    }

    return { type: 'funccall', name, suffix, args, line: ref.line };
  }

  function parseFunctionCallInParens() {
    const ref = advance(); // IDENT or typed var (function name)
    const name = ref.value;
    const suffixFromType = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?', 'IDENT': '' };
    const suffix = suffixFromType[ref.type] || '';
    const args = [];

    while (peek().type !== 'RPAREN' && !atLineEnd()) {
      if (peek().type === 'IDENT' && !isKnownFunction(peek())) {
        const label = advance().value;
        const value = parseExpr();
        args.push({ label, value });
      } else {
        const value = parseExpr();
        args.push({ label: null, value });
      }
      if (!match('COMMA')) break;
    }

    return { type: 'funccall', name, suffix, args, line: ref.line };
  }

  // Built-in parameter definitions for return-value keywords
  const BUILTIN_KEYWORD_PARAMS = {
    INPUT: [{ name: 'TEXT', required: false }],
    GETKEY: [],
    RANDOM: [{ name: 'MAX', required: true }],
    LENGTH: [{ name: 'VALUE', required: true }],
    SUBSTRING: [{ name: 'TEXT', required: true }, { name: 'START', required: true }, { name: 'LENGTH', required: true }],
    UPPERCASE: [{ name: 'TEXT', required: true }],
    LOWERCASE: [{ name: 'TEXT', required: true }],
    CONTAINS: [{ name: 'TEXT', required: true }, { name: 'FIND', required: true }],
    ABS: [{ name: 'VALUE', required: true }],
    SQRT: [{ name: 'VALUE', required: true }],
    ROUND: [{ name: 'VALUE', required: true }],
    FLOOR: [{ name: 'VALUE', required: true }],
    CEIL: [{ name: 'VALUE', required: true }],
    MIN: [{ name: 'A', required: true }, { name: 'B', required: true }],
    MAX: [{ name: 'A', required: true }, { name: 'B', required: true }],
    SIN: [{ name: 'VALUE', required: true }],
    COS: [{ name: 'VALUE', required: true }],
    LOG: [{ name: 'VALUE', required: true }],
    SIGN: [{ name: 'VALUE', required: true }],
    OPEN: [{ name: 'FILE', required: true }, { name: 'MODE', required: false }],
    READFILELINE: [{ name: 'FILE', required: true }],
    READFILECHARACTER: [{ name: 'FILE', required: true }],
    TONUMBER: [{ name: 'VALUE', required: true }],
    TOSTRING: [{ name: 'VALUE', required: true }],
    INDEXOF: [{ name: 'TEXT', required: true }, { name: 'FIND', required: true }],
    TRIM: [{ name: 'TEXT', required: true }],
  };

  function parseAssignBuiltinKeyword(varToken, line) {
    const kw = advance(); // consume the keyword
    const keyword = kw.value;
    const paramDefs = BUILTIN_KEYWORD_PARAMS[keyword];

    // TRIM supports optional LEFT/RIGHT mode modifier
    let mode = null;
    if (keyword === 'TRIM' && peek().type === 'IDENT' &&
        (peek().value.toUpperCase() === 'LEFT' || peek().value.toUpperCase() === 'RIGHT')) {
      mode = advance().value.toUpperCase();
    }

    const args = parseKeywordArgs();
    const resolved = resolveBuiltinArgs(args, paramDefs, line);

    const varTypeMap = { 'NUM_VAR': 'num', 'STR_VAR': 'str', 'BOOL_VAR': 'bool', 'STRUCT_VAR': 'struct', 'ARR_VAR': 'arr' };
    return {
      type: 'assign_builtin',
      name: varToken.value,
      varType: varTypeMap[varToken.type],
      keyword,
      params: resolved,
      mode,
      line,
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
        const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?' };
        const suffix = suffixMap[memberToken.type];
        if (!suffix) throw new SyntaxError(`Expected typed member after '.' at line ${line}`);
        expect('COMPARE', '=');
        const value = parseExpr();
        return { type: 'assign_struct_member', name: varToken.value, memberName: memberToken.value, memberSuffix: suffix, value, line };
      }
      // Full struct assignment: myStruct& = {.height# = 72, .name$ = "Sam"}
      expect('COMPARE', '=');
      if (isKnownFunction(peek())) {
        const call = parseFunctionCall();
        return { type: 'assign_funccall', name: varToken.value, varType: 'struct', call, line };
      }
      // Check for builtin keyword
      if (peek().type === 'KEYWORD' && BUILTIN_KEYWORD_PARAMS[peek().value]) {
        return parseAssignBuiltinKeyword(varToken, line);
      }
      expect('LBRACE');
      const members = [];
      if (peek().type !== 'RBRACE') {
        do {
          expect('DOT');
          const memToken = advance();
          const suffixMap = { 'NUM_VAR': '#', 'STR_VAR': '$', 'ARR_VAR': '@', 'STRUCT_VAR': '&', 'BOOL_VAR': '?' };
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

      if (isKnownFunction(peek())) {
        const call = parseFunctionCall();
        return { type: 'assign_funccall', name: varToken.value, varType: 'arr', call, line };
      }

      // Check for builtin keyword
      if (peek().type === 'KEYWORD' && BUILTIN_KEYWORD_PARAMS[peek().value]) {
        return parseAssignBuiltinKeyword(varToken, line);
      }

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

      // Size allocation: arr@ = SIZE 10 or arr@ = SIZE 10, 10
      if (peek().type === 'KEYWORD' && peek().value === 'SIZE') {
        advance(); // consume SIZE
        const size1 = parseExpr();
        if (match('COMMA')) {
          const size2 = parseExpr();
          return { type: 'assign_arr_alloc2d', name: varToken.value, size1, size2, line };
        }
        return { type: 'assign_arr_alloc', name: varToken.value, size: size1, line };
      }

      throw new SyntaxError(`Expected '[' for array literal or 'SIZE' for array allocation after '=' at line ${line}`);
    }

    expect('COMPARE', '=');
    if (isKnownFunction(peek())) {
      const varTypeMap = { 'NUM_VAR': 'num', 'STR_VAR': 'str', 'BOOL_VAR': 'bool' };
      const call = parseFunctionCall();
      return { type: 'assign_funccall', name: varToken.value, varType: varTypeMap[varToken.type], call, line };
    }
    // Check for builtin keyword
    if (peek().type === 'KEYWORD' && BUILTIN_KEYWORD_PARAMS[peek().value]) {
      return parseAssignBuiltinKeyword(varToken, line);
    }
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

  return { ast, labels, functions };
}
