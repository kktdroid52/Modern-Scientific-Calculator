/**
 * NeoCalc Pro — script.js
 * Premium Glassmorphism Calculator
 * No eval() — custom expression parser
 * Modular ES6+ vanilla JavaScript
 */

'use strict';

/* ============================================================
   MODULE: State
   ============================================================ */
const State = {
  expression:    '',          // raw display expression
  memory:        0,           // memory register
  hasMemory:     false,       // memory occupied?
  isResult:      false,       // last action produced a result
  waitingForOperand: false,   // after operator press
  isMuted:       false,
  isHistoryOpen: false,
  isScientific:  false,
  powMode:       false,       // xʸ pending
  history:       [],          // [{expr, result, timestamp}]
  calcCount:     0,           // total all-time
  sessionCount:  0,           // this session
  currentTheme:  'dark',
  currentAccent: 'orange',
};

/* ============================================================
   MODULE: DOM Refs
   ============================================================ */
const Dom = {
  displayMain:    document.getElementById('display-main'),
  displayExpr:    document.getElementById('display-expr'),
  memIndicator:   document.getElementById('mem-indicator'),
  statCount:      document.getElementById('stat-count'),
  statSession:    document.getElementById('stat-session'),
  statMemVal:     document.getElementById('stat-mem-val'),
  historyPanel:   document.getElementById('history-panel'),
  historyList:    document.getElementById('history-list'),
  historyEmpty:   document.getElementById('history-empty'),
  sciPanel:       document.getElementById('scientific-panel'),
  toast:          document.getElementById('toast'),
  loadingScreen:  document.getElementById('loading-screen'),
  themeBtn:       document.getElementById('theme-btn'),
  muteBtn:        document.getElementById('mute-btn'),
  historyToggle:  document.getElementById('history-toggle-btn'),
  fullscreenBtn:  document.getElementById('fullscreen-btn'),
  modeStandard:   document.getElementById('mode-standard'),
  modeScientific: document.getElementById('mode-scientific'),
  copyBtn:        document.getElementById('copy-btn'),
  shareBtn:       document.getElementById('share-btn'),
  clearHistBtn:   document.getElementById('clear-history-btn'),
  confettiCanvas: document.getElementById('confetti-canvas'),
  clockTime:      document.getElementById('clock-time'),
  clockDate:      document.getElementById('clock-date'),
  particleCanvas: document.getElementById('particle-canvas'),
  accentDots:     document.querySelectorAll('.accent-dot'),
};

/* ============================================================
   MODULE: Audio — Web Audio API, no external files
   ============================================================ */
const Audio = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function play(type = 'click') {
    if (State.isMuted) return;
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);

      const configs = {
        click:   { freq: 880, type: 'sine',     dur: 0.055, startGain: 0.08, endGain: 0 },
        op:      { freq: 660, type: 'sine',     dur: 0.075, startGain: 0.10, endGain: 0 },
        equals:  { freq: 440, type: 'triangle', dur: 0.18,  startGain: 0.12, endGain: 0 },
        error:   { freq: 220, type: 'sawtooth', dur: 0.20,  startGain: 0.08, endGain: 0 },
        clear:   { freq: 330, type: 'sine',     dur: 0.10,  startGain: 0.07, endGain: 0 },
      };

      const c = configs[type] || configs.click;
      osc.frequency.setValueAtTime(c.freq, ac.currentTime);
      osc.type = c.type;
      gain.gain.setValueAtTime(c.startGain, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + c.dur);

      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + c.dur);
    } catch (_) { /* silent fallback */ }
  }

  return { play };
})();

/* ============================================================
   MODULE: Safe Expression Parser
   Never uses eval(). Implements a recursive-descent parser.
   Grammar:
     expr   → term (('+' | '-') term)*
     term   → unary (('*' | '/') unary)*
     unary  → '-' unary | power
     power  → primary ('^' unary)?
     primary → number | '(' expr ')'
   ============================================================ */
const Parser = (() => {

  // Tokenise a clean expression string → token array
  function tokenise(raw) {
    const str = raw
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .trim();

    const tokens = [];
    let i = 0;

    while (i < str.length) {
      const ch = str[i];

      // Skip whitespace
      if (/\s/.test(ch)) { i++; continue; }

      // Number (inc. scientific notation like 1.5e+10)
      if (/[\d.]/.test(ch)) {
        let num = '';
        while (i < str.length && /[\d.eE+\-]/.test(str[i])) {
          // Only allow +/- after e/E
          if ((str[i] === '+' || str[i] === '-') && !/[eE]/.test(num.slice(-1))) break;
          num += str[i++];
        }
        tokens.push({ type: 'NUMBER', value: parseFloat(num) });
        continue;
      }

      // Operators and parens
      if ('+-*/^()%'.includes(ch)) {
        tokens.push({ type: 'OP', value: ch });
        i++;
        continue;
      }

      throw new SyntaxError(`Unexpected character: ${ch}`);
    }

    return tokens;
  }

  // Parser state
  let tokens = [];
  let pos = 0;

  function peek()    { return tokens[pos]; }
  function consume() { return tokens[pos++]; }
  function match(v)  {
    if (peek() && peek().value === v) { consume(); return true; }
    return false;
  }

  function parseExpr() {
    let left = parseTerm();
    while (peek() && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseTerm();
      if (op === '+') left += right;
      else            left -= right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (peek() && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = consume().value;
      const right = parseUnary();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('DIV_ZERO');
        left /= right;
      } else left %= right;
    }
    return left;
  }

  function parseUnary() {
    if (peek() && peek().value === '-') {
      consume();
      return -parsePower();
    }
    if (peek() && peek().value === '+') {
      consume();
      return parsePower();
    }
    return parsePower();
  }

  function parsePower() {
    let base = parsePrimary();
    if (peek() && peek().value === '^') {
      consume();
      const exp = parseUnary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new SyntaxError('Unexpected end');

    if (tok.type === 'NUMBER') {
      consume();
      return tok.value;
    }

    if (tok.value === '(') {
      consume(); // '('
      const val = parseExpr();
      if (!peek() || peek().value !== ')') throw new SyntaxError('Missing )');
      consume(); // ')'
      return val;
    }

    throw new SyntaxError(`Unexpected token: ${tok.value}`);
  }

  // Public evaluate
  function evaluate(expr) {
    tokens = tokenise(expr);
    pos    = 0;
    const result = parseExpr();
    if (pos < tokens.length) throw new SyntaxError('Unexpected token');
    return result;
  }

  return { evaluate };
})();

/* ============================================================
   MODULE: Formatter
   ============================================================ */
const Fmt = (() => {

  function number(val) {
    if (!isFinite(val))          return val > 0 ? 'Infinity' : '-Infinity';
    if (isNaN(val))              return 'Error';

    // Use scientific notation for very large or tiny
    const abs = Math.abs(val);
    if ((abs !== 0 && abs < 1e-9) || abs >= 1e15) {
      return val.toExponential(6).replace(/\.?0+e/, 'e');
    }

    // Limit decimal places
    const str = parseFloat(val.toPrecision(14)).toString();

    // Add thousands separator
    const parts = str.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function time(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function date(d) {
    return `${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]}`;
  }

  return { number, time, date };
})();

/* ============================================================
   MODULE: Display
   ============================================================ */
const Display = (() => {

  let lastMain = '';

  function setMain(val, animate = true) {
    const str = String(val);
    if (str === lastMain) return;
    lastMain = str;

    const el = Dom.displayMain;
    el.textContent = str;
    el.className = 'display-primary';

    // Auto-size
    const len = str.replace(/,/g, '').length;
    if (len > 18) el.classList.add('xxs');
    else if (len > 14) el.classList.add('xs');
    else if (len > 10) el.classList.add('sm');

    if (animate) {
      el.classList.add('glow');
      el.classList.add('pop');
      // Remove animation classes after they finish
      el.addEventListener('animationend', () => {
        el.classList.remove('glow', 'pop');
      }, { once: true });
    }
  }

  function setExpr(str) {
    Dom.displayExpr.textContent = str;
  }

  function showError(msg = 'Error') {
    const el = Dom.displayMain;
    el.textContent = msg;
    el.className = 'display-primary error error-shake';
    lastMain = msg;
    el.addEventListener('animationend', () => el.classList.remove('error-shake'), { once: true });
  }

  function updateMemIndicator() {
    const ind = Dom.memIndicator;
    if (State.hasMemory) {
      ind.textContent = `M: ${Fmt.number(State.memory)}`;
      ind.classList.add('visible');
    } else {
      ind.classList.remove('visible');
      ind.textContent = '';
    }
    Dom.statMemVal.textContent = State.hasMemory
      ? `Mem: ${Fmt.number(State.memory)}`
      : '';
  }

  function updateStats() {
    Dom.statCount.textContent   = State.calcCount;
    Dom.statSession.textContent = State.sessionCount;
  }

  return { setMain, setExpr, showError, updateMemIndicator, updateStats };
})();

/* ============================================================
   MODULE: Calculator Logic
   ============================================================ */
const Calc = (() => {

  // Current display string (raw, no formatting)
  let current = '0';
  let pendingPow = null; // base for x^y

  function getCurrent() { return current; }

  function reset() {
    current  = '0';
    State.expression    = '';
    State.isResult      = false;
    State.waitingForOperand = false;
    State.powMode       = false;
    pendingPow = null;
    Display.setMain('0');
    Display.setExpr('');
  }

  function inputDigit(d) {
    if (State.isResult) {
      current = d;
      State.expression = '';
      State.isResult   = false;
    } else if (State.waitingForOperand) {
      current = d;
      State.waitingForOperand = false;
    } else {
      current = (current === '0') ? d : current + d;
    }
    Display.setMain(Fmt.number(parseFloat(current)));
    Display.setExpr(State.expression + current);
  }

  function inputDecimal() {
    if (State.isResult) {
      current = '0.';
      State.isResult = false;
      State.expression = '';
    } else if (State.waitingForOperand) {
      current = '0.';
      State.waitingForOperand = false;
    } else if (!current.includes('.')) {
      current += '.';
    }
    Display.setMain(current);
    Display.setExpr(State.expression + current);
  }

  function inputOperator(op) {
    const raw = current.replace(/,/g, '');
    // If we already have a pending expression ending with an operator, replace it
    if (State.waitingForOperand) {
      State.expression = State.expression.replace(/[+\-×÷]\s*$/, '') + ' ' + op + ' ';
      Display.setExpr(State.expression);
      return;
    }

    if (State.expression === '' || State.isResult) {
      State.expression = raw + ' ' + op + ' ';
    } else {
      // Evaluate what we have so far
      const partial = State.expression + raw;
      try {
        const val = Parser.evaluate(partial);
        current = String(val);
        Display.setMain(Fmt.number(val));
        State.expression = Fmt.number(val) + ' ' + op + ' ';
      } catch (_) {
        State.expression = raw + ' ' + op + ' ';
      }
    }

    State.isResult = false;
    State.waitingForOperand = true;
    Display.setExpr(State.expression);
    Audio.play('op');
  }

  function calculate() {
    if (State.waitingForOperand) return; // nothing to evaluate yet

    const raw   = current.replace(/,/g, '');
    const full  = State.expression !== '' ? State.expression + raw : raw;

    let result;
    try {
      result = Parser.evaluate(full);
    } catch (err) {
      Audio.play('error');
      if (err.message === 'DIV_ZERO') {
        Display.showError('Divide by 0');
      } else {
        Display.showError('Syntax Error');
      }
      return;
    }

    if (!isFinite(result)) {
      Display.showError(result > 0 ? 'Infinity' : '-Infinity');
      return;
    }

    const resultStr = Fmt.number(result);

    // Record to history
    History.add(full, resultStr);

    // Update state
    State.calcCount++;
    State.sessionCount++;
    State.isResult           = true;
    State.waitingForOperand  = false;
    current = String(result);

    Display.setExpr(full + ' =');
    Display.setMain(resultStr);
    Display.updateStats();
    Persist.save();
    Audio.play('equals');

    // Confetti for complex calculations
    if (full.length > 10 || Math.abs(result) > 9999) {
      Confetti.burst();
    }
  }

  function deleteLast() {
    if (State.isResult) return reset();
    if (State.waitingForOperand) {
      // Remove last operator
      State.expression = State.expression.trimEnd().replace(/\S+\s*$/, '');
      State.waitingForOperand = false;
      current = '0';
      Display.setMain('0');
      Display.setExpr(State.expression);
      return;
    }
    current = current.length > 1 ? current.slice(0, -1) : '0';
    Display.setMain(current === '0' ? '0' : Fmt.number(parseFloat(current)));
    Display.setExpr(State.expression + current);
  }

  function toggleSign() {
    const raw = parseFloat(current.replace(/,/g, ''));
    if (!isNaN(raw)) {
      current = String(-raw);
      Display.setMain(Fmt.number(-raw));
    }
  }

  function percent() {
    const raw = parseFloat(current.replace(/,/g, ''));
    if (!isNaN(raw)) {
      const val = raw / 100;
      current = String(val);
      Display.setMain(Fmt.number(val));
    }
  }

  // ── Scientific Operations ──────────────────────────────────

  function applyScientific(action) {
    const raw = parseFloat(current.replace(/,/g, ''));
    if (isNaN(raw)) return;

    const DEG_TO_RAD = Math.PI / 180;
    let result, expr;

    const safeFactorial = n => {
      if (n < 0 || !Number.isInteger(n)) throw new Error('Invalid factorial');
      if (n > 170) return Infinity;
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    };

    try {
      switch (action) {
        case 'sin':   result = Math.sin(raw * DEG_TO_RAD);   expr = `sin(${raw}°)`; break;
        case 'cos':   result = Math.cos(raw * DEG_TO_RAD);   expr = `cos(${raw}°)`; break;
        case 'tan':   result = Math.tan(raw * DEG_TO_RAD);   expr = `tan(${raw}°)`; break;
        case 'asin':  result = Math.asin(raw) / DEG_TO_RAD;  expr = `asin(${raw})`; break;
        case 'acos':  result = Math.acos(raw) / DEG_TO_RAD;  expr = `acos(${raw})`; break;
        case 'atan':  result = Math.atan(raw) / DEG_TO_RAD;  expr = `atan(${raw})`; break;
        case 'sqrt':
          if (raw < 0) throw new Error('Invalid input');
          result = Math.sqrt(raw); expr = `√(${raw})`; break;
        case 'cbrt':  result = Math.cbrt(raw);               expr = `∛(${raw})`; break;
        case 'sq':    result = raw * raw;                     expr = `(${raw})²`; break;
        case 'cube':  result = raw * raw * raw;               expr = `(${raw})³`; break;
        case 'pow':
          // Enter xʸ mode — store base, wait for exponent
          pendingPow = raw;
          State.powMode = true;
          Display.setExpr(`${raw} ^`);
          current = '0';
          State.waitingForOperand = true;
          return;
        case 'log':
          if (raw <= 0) throw new Error('Invalid input');
          result = Math.log10(raw); expr = `log(${raw})`; break;
        case 'ln':
          if (raw <= 0) throw new Error('Invalid input');
          result = Math.log(raw); expr = `ln(${raw})`; break;
        case 'abs':   result = Math.abs(raw);                 expr = `|${raw}|`; break;
        case 'fact':  result = safeFactorial(raw);            expr = `${raw}!`; break;
        case 'inv':
          if (raw === 0) throw new Error('DIV_ZERO');
          result = 1 / raw; expr = `1/${raw}`; break;
        case 'exp':
          // Scientific notation entry — append e
          current = raw + 'e+';
          Display.setMain(current);
          return;
        case 'floor': result = Math.floor(raw);               expr = `⌊${raw}⌋`; break;
        case 'ceil':  result = Math.ceil(raw);                expr = `⌈${raw}⌉`; break;
        case 'round': result = Math.round(raw);               expr = `round(${raw})`; break;
        case 'rand':  result = parseFloat(Math.random().toFixed(10)); expr = 'rand()'; break;
        case 'pi':    result = Math.PI;                       expr = 'π'; break;
        case 'e':     result = Math.E;                        expr = 'e'; break;
        case 'mod': {
          State.expression = raw + ' % ';
          State.waitingForOperand = true;
          Display.setExpr(State.expression);
          return;
        }
        case 'open-paren': {
          if (State.expression === '' || State.waitingForOperand) {
            State.expression += '(';
            State.waitingForOperand = false;
            current = '0';
            Display.setExpr(State.expression);
          }
          return;
        }
        case 'close-paren': {
          if (!State.waitingForOperand) {
            State.expression += current + ')';
            State.waitingForOperand = true;
            Display.setExpr(State.expression);
          }
          return;
        }
        default: return;
      }
    } catch (err) {
      Audio.play('error');
      Display.showError(err.message === 'DIV_ZERO' ? 'Divide by 0' : 'Invalid input');
      return;
    }

    // Handle x^y resolution
    if (State.powMode && pendingPow !== null) {
      result = Math.pow(pendingPow, raw);
      expr = `${pendingPow} ^ ${raw}`;
      State.powMode = false;
      pendingPow = null;
    }

    if (result === undefined) return;
    if (!isFinite(result)) {
      Display.showError(result > 0 ? 'Infinity' : '-Infinity');
      return;
    }

    const resultStr = Fmt.number(result);
    History.add(expr, resultStr);
    State.calcCount++;
    State.sessionCount++;
    current = String(result);
    State.isResult = true;
    State.waitingForOperand = false;
    Display.setExpr(expr + ' =');
    Display.setMain(resultStr);
    Display.updateStats();
    Persist.save();
    Audio.play('equals');
  }

  // Memory operations
  function memory(op) {
    const raw = parseFloat(current.replace(/,/g, '')) || 0;
    switch (op) {
      case 'mc':  State.memory = 0; State.hasMemory = false; break;
      case 'mr':
        if (State.hasMemory) {
          current = String(State.memory);
          Display.setMain(Fmt.number(State.memory));
        }
        break;
      case 'ms':  State.memory = raw; State.hasMemory = true; break;
      case 'm+':  State.memory += raw; State.hasMemory = true; break;
      case 'm-':  State.memory -= raw; State.hasMemory = true; break;
    }
    Display.updateMemIndicator();
    Persist.save();
  }

  return { getCurrent, reset, inputDigit, inputDecimal, inputOperator, calculate, deleteLast, toggleSign, percent, applyScientific, memory };
})();

/* ============================================================
   MODULE: History
   ============================================================ */
const History = (() => {

  function add(expr, result) {
    const entry = {
      id:        Date.now(),
      expr:      expr.replace(/×/g, '×').trim(),
      result,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    State.history.unshift(entry);
    if (State.history.length > 100) State.history.pop();
    render();
    Persist.save();
  }

  function render() {
    const list  = Dom.historyList;
    const empty = Dom.historyEmpty;

    // Clear existing items (keep empty element)
    [...list.querySelectorAll('.history-item')].forEach(el => el.remove());

    if (State.history.length === 0) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    State.history.forEach(entry => {
      const item = document.createElement('div');
      item.className  = 'history-item';
      item.role       = 'listitem';
      item.dataset.id = entry.id;
      item.innerHTML  = `
        <div class="history-expr">${escHtml(entry.expr)}</div>
        <div class="history-result">= ${escHtml(entry.result)}</div>
        <div class="history-time">${entry.timestamp}</div>
        <div class="history-actions">
          <button class="hist-act-btn copy"  data-id="${entry.id}" aria-label="Copy result">Copy</button>
          <button class="hist-act-btn reuse" data-id="${entry.id}" aria-label="Reuse result">Reuse</button>
          <button class="hist-act-btn del"   data-id="${entry.id}" aria-label="Delete entry">Delete</button>
        </div>`;
      list.appendChild(item);
    });
  }

  function remove(id) {
    State.history = State.history.filter(e => e.id !== Number(id));
    render();
    Persist.save();
  }

  function clear() {
    State.history = [];
    render();
    Persist.save();
  }

  function copyEntry(id) {
    const entry = State.history.find(e => e.id === Number(id));
    if (entry) Clipboard.copy(entry.result);
  }

  function reuseEntry(id) {
    const entry = State.history.find(e => e.id === Number(id));
    if (!entry) return;
    // Push result into calculator
    const num = parseFloat(entry.result.replace(/,/g, ''));
    if (!isNaN(num)) {
      Calc.reset();
      // Set current through inputDigit-like mechanism
      entry.result.replace(/,/g, '').split('').forEach(ch => {
        if (/[\d.]/.test(ch)) Calc.inputDigit(ch);
      });
    }
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { add, render, remove, clear, copyEntry, reuseEntry };
})();

/* ============================================================
   MODULE: Clipboard
   ============================================================ */
const Clipboard = (() => {
  function copy(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => Toast.show('Copied!')).catch(() => fallback(text));
    } else fallback(text);
  }

  function fallback(text) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); Toast.show('Copied!'); }
    catch (_) { Toast.show('Copy failed'); }
    document.body.removeChild(el);
  }

  return { copy };
})();

/* ============================================================
   MODULE: Toast Notifications
   ============================================================ */
const Toast = (() => {
  let timer = null;

  function show(msg, dur = 2000) {
    clearTimeout(timer);
    Dom.toast.textContent = msg;
    Dom.toast.classList.add('show');
    timer = setTimeout(() => Dom.toast.classList.remove('show'), dur);
  }

  return { show };
})();

/* ============================================================
   MODULE: Theme
   ============================================================ */
const Theme = (() => {
  function set(theme) {
    State.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    Persist.save();
  }

  function toggle() {
    set(State.currentTheme === 'dark' ? 'light' : 'dark');
  }

  function setAccent(accent) {
    State.currentAccent = accent;
    document.documentElement.setAttribute('data-accent', accent);
    Dom.accentDots.forEach(d => d.classList.toggle('active', d.dataset.accent === accent));
    // Regenerate blob colors on accent change
    Persist.save();
  }

  return { set, toggle, setAccent };
})();

/* ============================================================
   MODULE: Persistence (localStorage)
   ============================================================ */
const Persist = (() => {
  const KEY = 'neocalc-pro-v2';

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        theme:      State.currentTheme,
        accent:     State.currentAccent,
        muted:      State.isMuted,
        memory:     State.memory,
        hasMemory:  State.hasMemory,
        history:    State.history.slice(0, 100),
        calcCount:  State.calcCount,
      }));
    } catch (_) { /* storage may be unavailable */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.theme)     Theme.set(d.theme);
      if (d.accent)    Theme.setAccent(d.accent);
      if (d.muted !== undefined) {
        State.isMuted = d.muted;
        updateMuteUI();
      }
      if (d.memory !== undefined) {
        State.memory    = d.memory;
        State.hasMemory = d.hasMemory || false;
      }
      if (Array.isArray(d.history)) {
        State.history = d.history;
        History.render();
      }
      if (d.calcCount) State.calcCount = d.calcCount;
    } catch (_) { /* invalid data */ }
  }

  function updateMuteUI() {
    const sw = document.getElementById('sound-wave2');
    if (sw) sw.style.opacity = State.isMuted ? '0.2' : '1';
  }

  return { save, load, updateMuteUI };
})();

/* ============================================================
   MODULE: Confetti
   ============================================================ */
const Confetti = (() => {
  const canvas = Dom.confettiCanvas;
  const ctx    = canvas.getContext('2d');
  let particles = [];
  let animId    = null;

  const COLORS = ['#ff7200','#3278ff','#a855f7','#00d4ff','#22c55e','#f43f5e','#ffd700'];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function burst() {
    resize();
    particles = [];
    for (let i = 0; i < 120; i++) {
      particles.push({
        x:    Math.random() * canvas.width,
        y:    -10,
        vx:   (Math.random() - 0.5) * 6,
        vy:   Math.random() * 4 + 2,
        rot:  Math.random() * 360,
        rVel: (Math.random() - 0.5) * 8,
        w:    Math.random() * 10 + 4,
        h:    Math.random() * 6  + 3,
        color:COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha:1,
        decay:Math.random() * 0.008 + 0.008,
      });
    }
    if (animId) cancelAnimationFrame(animId);
    animate();
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x   += p.vx;
      p.y   += p.vy;
      p.vy  += 0.1; // gravity
      p.rot += p.rVel;
      p.alpha -= p.decay;

      if (p.alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });

    particles = particles.filter(p => p.alpha > 0 && p.y < canvas.height + 20);
    if (particles.length > 0) animId = requestAnimationFrame(animate);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { burst };
})();

/* ============================================================
   MODULE: Particle Background
   ============================================================ */
const Particles = (() => {
  const canvas = Dom.particleCanvas;
  const ctx    = canvas.getContext('2d');
  let pts = [];
  let w, h;

  function resize() {
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function init() {
    resize();
    pts = [];
    const count = Math.min(60, Math.floor((w * h) / 18000));
    for (let i = 0; i < count; i++) {
      pts.push({
        x:   Math.random() * w,
        y:   Math.random() * h,
        vx:  (Math.random() - 0.5) * 0.3,
        vy:  (Math.random() - 0.5) * 0.3,
        r:   Math.random() * 1.5 + 0.5,
        a:   Math.random() * 0.5 + 0.1,
      });
    }
    animate();
  }

  function animate() {
    ctx.clearRect(0, 0, w, h);
    const isDark = State.currentTheme === 'dark';

    pts.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = isDark
        ? `rgba(255,255,255,${p.a})`
        : `rgba(0,0,0,${p.a * 0.4})`;
      ctx.fill();
    });

    // Draw connections
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 120) {
          const alpha = (1 - dist/120) * 0.12;
          ctx.strokeStyle = isDark
            ? `rgba(255,255,255,${alpha})`
            : `rgba(0,0,0,${alpha * 0.5})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(animate);
  }

  return { init, resize };
})();

/* ============================================================
   MODULE: Ripple Effect
   ============================================================ */
function createRipple(btn, e) {
  const rect   = btn.getBoundingClientRect();
  const x      = (e.clientX ?? rect.left + rect.width  / 2) - rect.left;
  const y      = (e.clientY ?? rect.top  + rect.height / 2) - rect.top;
  const size   = Math.max(rect.width, rect.height) * 1.2;
  const ripple = document.createElement('span');

  ripple.className = 'ripple';
  ripple.style.cssText = `
    width:${size}px; height:${size}px;
    left:${x - size/2}px; top:${y - size/2}px;
  `;

  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

/* ============================================================
   MODULE: Clock
   ============================================================ */
const Clock = (() => {
  function tick() {
    const now = new Date();
    Dom.clockTime.textContent = Fmt.time(now);
    Dom.clockDate.textContent = Fmt.date(now);
  }
  return {
    start() {
      tick();
      setInterval(tick, 1000);
    }
  };
})();

/* ============================================================
   MODULE: Keyboard Handler
   ============================================================ */
const Keyboard = (() => {
  const MAP = {
    '0':'0','1':'1','2':'2','3':'3','4':'4',
    '5':'5','6':'6','7':'7','8':'8','9':'9',
    '+':'+', '-':'-', '*':'×', '/':'÷',
    'Enter':'=', '=':'=',
    'Backspace':'del', 'Delete':'clear',
    'Escape':'clear', '%':'%', '.':'.',
  };

  function handle(e) {
    // Ignore key events when typing in an input
    if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;

    const key = e.key;
    if (MAP[key]) {
      e.preventDefault();
      const action = MAP[key];
      dispatch(action);
      // Visual feedback: find and flash corresponding button
      const sel = `.btn[data-action="${CSS.escape(action)}"]`;
      const btn = document.querySelector(sel);
      if (btn) { btn.classList.add('active-flash'); setTimeout(() => btn.classList.remove('active-flash'), 120); }
    }
  }

  function dispatch(action) {
    if (/^\d$/.test(action))       Calc.inputDigit(action);
    else if (action === '.')       Calc.inputDecimal();
    else if (['+','-','×','÷','%'].includes(action)) { Calc.inputOperator(action); Audio.play('op'); }
    else if (action === '=')       Calc.calculate();
    else if (action === 'del')     { Calc.deleteLast(); Audio.play('click'); }
    else if (action === 'clear')   { Calc.reset(); Audio.play('clear'); }
  }

  return {
    init() { window.addEventListener('keydown', handle); }
  };
})();

/* ============================================================
   MODULE: Button Click Handler
   ============================================================ */
function handleButtonClick(btn, e) {
  const action = btn.dataset.action;
  if (!action) return;

  createRipple(btn, e);

  // Digit
  if (/^\d$/.test(action)) {
    Calc.inputDigit(action);
    Audio.play('click');
    return;
  }

  switch (action) {
    case '.': Calc.inputDecimal(); Audio.play('click'); break;
    case '+':
    case '-':
    case '×':
    case '÷': Calc.inputOperator(action); break;
    case '%':  Calc.percent(); Audio.play('click'); break;
    case '=':  Calc.calculate(); break;
    case 'clear': Calc.reset(); Audio.play('clear'); break;
    case 'del':   Calc.deleteLast(); Audio.play('click'); break;
    case 'sign':  Calc.toggleSign(); Audio.play('click'); break;
    // Scientific
    default:
      Calc.applyScientific(action);
  }
}

/* ============================================================
   MODULE: Fullscreen
   ============================================================ */
const Fullscreen = (() => {
  function toggle() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }
  return { toggle };
})();

/* ============================================================
   INIT — Wire everything together
   ============================================================ */
(function init() {

  // ── 1. Load persisted state
  Persist.load();
  Display.updateMemIndicator();
  Display.updateStats();

  // ── 2. Start background systems
  Particles.init();
  Clock.start();

  // ── 3. Hide loading screen after brief pause
  setTimeout(() => {
    Dom.loadingScreen.classList.add('hidden');
  }, 1200);

  // ── 4. Button grid — event delegation
  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn');
    if (btn) { handleButtonClick(btn, e); return; }

    // Memory buttons
    const memBtn = e.target.closest('.mem-btn');
    if (memBtn) {
      createRipple(memBtn, e);
      Calc.memory(memBtn.dataset.mem);
      Audio.play('click');
      return;
    }

    // History item actions
    const histBtn = e.target.closest('.hist-act-btn');
    if (histBtn) {
      const id = histBtn.dataset.id;
      if (histBtn.classList.contains('copy'))  History.copyEntry(id);
      if (histBtn.classList.contains('reuse')) History.reuseEntry(id);
      if (histBtn.classList.contains('del'))   History.remove(id);
      return;
    }
  });

  // ── 5. Top-bar controls
  Dom.themeBtn.addEventListener('click', () => Theme.toggle());

  Dom.muteBtn.addEventListener('click', () => {
    State.isMuted = !State.isMuted;
    Persist.updateMuteUI();
    Persist.save();
    Toast.show(State.isMuted ? '🔇 Sound off' : '🔊 Sound on');
  });

  Dom.historyToggle.addEventListener('click', () => {
    State.isHistoryOpen = !State.isHistoryOpen;
    Dom.historyPanel.classList.toggle('open', State.isHistoryOpen);
    Dom.historyPanel.setAttribute('aria-hidden', String(!State.isHistoryOpen));
    Dom.historyToggle.setAttribute('aria-label', State.isHistoryOpen ? 'Close history' : 'Open history');
  });

  Dom.fullscreenBtn.addEventListener('click', () => Fullscreen.toggle());

  Dom.copyBtn.addEventListener('click', () => {
    Clipboard.copy(Dom.displayMain.textContent);
  });

  Dom.shareBtn.addEventListener('click', async () => {
    const text = `NeoCalc Pro result: ${Dom.displayMain.textContent}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'NeoCalc Pro', text }); }
      catch (_) { Clipboard.copy(text); }
    } else {
      Clipboard.copy(text);
    }
  });

  Dom.clearHistBtn.addEventListener('click', () => History.clear());

  // ── 6. Mode toggle
  Dom.modeStandard.addEventListener('click', () => {
    if (State.isScientific) {
      State.isScientific = false;
      Dom.sciPanel.classList.remove('open');
      Dom.sciPanel.setAttribute('aria-hidden', 'true');
      Dom.modeStandard.classList.add('active');
      Dom.modeStandard.setAttribute('aria-pressed', 'true');
      Dom.modeScientific.classList.remove('active');
      Dom.modeScientific.setAttribute('aria-pressed', 'false');
    }
  });

  Dom.modeScientific.addEventListener('click', () => {
    if (!State.isScientific) {
      State.isScientific = true;
      Dom.sciPanel.classList.add('open');
      Dom.sciPanel.setAttribute('aria-hidden', 'false');
      Dom.modeScientific.classList.add('active');
      Dom.modeScientific.setAttribute('aria-pressed', 'true');
      Dom.modeStandard.classList.remove('active');
      Dom.modeStandard.setAttribute('aria-pressed', 'false');
    }
  });

  // ── 7. Accent picker
  Dom.accentDots.forEach(dot => {
    dot.addEventListener('click', () => Theme.setAccent(dot.dataset.accent));
  });

  // ── 8. Keyboard
  Keyboard.init();

  // ── 9. Resize handler
  window.addEventListener('resize', () => {
    Particles.resize();
  });

  // ── 10. Close history on outside click (mobile)
  document.addEventListener('click', e => {
    if (State.isHistoryOpen &&
        !e.target.closest('.history-panel') &&
        !e.target.closest('#history-toggle-btn')) {
      State.isHistoryOpen = false;
      Dom.historyPanel.classList.remove('open');
      Dom.historyPanel.setAttribute('aria-hidden', 'true');
    }
  });

  // ── 11. Restore accent dot active state
  Dom.accentDots.forEach(d => {
    d.classList.toggle('active', d.dataset.accent === State.currentAccent);
  });

  // ── 12. Mute state visual
  Persist.updateMuteUI();

  // ── 13. Add CSS flash style for keyboard
  const style = document.createElement('style');
  style.textContent = `.active-flash { opacity:0.5; transform:scale(0.88) !important; }`;
  document.head.appendChild(style);

})();