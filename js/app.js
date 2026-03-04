// DOM elements
const codeEditor = document.getElementById('code-editor');
const lineNumbers = document.getElementById('line-numbers');
const screenOutput = document.getElementById('screen-output');

const btnRun = document.getElementById('btn-run');
const btnPause = document.getElementById('btn-pause');
const btnStep = document.getElementById('btn-step');
const btnStop = document.getElementById('btn-stop');
const btnSave = document.getElementById('btn-save');
const btnLoad = document.getElementById('btn-load');
const fileInput = document.getElementById('file-input');
const btnPower = document.getElementById('btn-power');
const monitorScreen = document.getElementById('monitor-screen');
const filesList = document.getElementById('files-list');
const btnUpload = document.getElementById('btn-upload');
const btnDownload = document.getElementById('btn-download');
const btnRemove = document.getElementById('btn-remove');
const fileInputUpload = document.getElementById('file-input-upload');
const btnReset = document.getElementById('btn-reset');
const btnTowerPower = document.getElementById('btn-tower-power');
const btnTurbo = document.getElementById('btn-turbo');
const ledPower = document.getElementById('led-power');
const ledTurbo = document.getElementById('led-turbo');
const ledReset = document.getElementById('led-reset');

let monitorOn = true;
let selectedFile = null;
let powerPausedInterpreter = false;
let currentRunId = 0;
let turboOn = true;
let resetBlinkInterval = null;

const codeHighlight = document.getElementById('code-highlight');

// Initialize
const crtScreen = new Screen(screenOutput);
const audio = new SamAudio();
const interpreter = new Interpreter(crtScreen, audio);
const repl = new Repl(crtScreen, interpreter);
setupEditor(codeEditor, lineNumbers, codeHighlight);

// Button state management
function setRunning(isRunning) {
  const bgMusic = audio._bgPlaying;
  btnRun.disabled = isRunning;
  btnPause.disabled = !isRunning && !bgMusic;
  btnStep.disabled = !isRunning;
  btnStop.disabled = !isRunning && !bgMusic && !repl.executing;
  codeEditor.readOnly = isRunning;
  setResetLed(isRunning);
}

function setResetLed(active) {
  if (active) {
    if (!resetBlinkInterval) {
      resetBlinkInterval = setInterval(() => {
        ledReset.classList.toggle('on-red');
      }, 100);
    }
  } else {
    if (resetBlinkInterval) {
      clearInterval(resetBlinkInterval);
      resetBlinkInterval = null;
    }
    ledReset.classList.remove('on-red');
  }
}

// Run
btnRun.addEventListener('click', async () => {
  if (!monitorOn) return;
  const source = codeEditor.value;
  if (!source.trim()) return;

  if (repl.hasState) {
    if (!confirm('Running a program will clear REPL state. Continue?')) return;
  }

  if (interpreter.running) {
    interpreter.stop();
  }

  repl.deactivate();
  const runId = ++currentRunId;
  try {
    const tokens = tokenize(source);
    const { ast, labels, functions } = parse(tokens);
    interpreter.load(ast, labels, functions);
    setRunning(true);
    await interpreter.run();
  } catch (e) {
    crtScreen.showError(`ERROR: ${e.message}`);
  } finally {
    if (runId === currentRunId) {
      setRunning(false);
    }
    refreshFileList();
    repl.resetState();
    repl.activate();
  }
});

// Pause
btnPause.addEventListener('click', () => {
  if (interpreter.paused || audio._bgPaused) {
    if (interpreter.running) interpreter.resume();
    audio.resumeBackground();
    btnPause.innerHTML = '<span class="btn-icon">&#9646;&#9646;</span> Pause';
  } else {
    if (interpreter.running) interpreter.pause();
    audio.pauseBackground();
    btnPause.innerHTML = '<span class="btn-icon">&#9654;</span> Resume';
  }
});

// Step
btnStep.addEventListener('click', () => {
  interpreter.step();
});

// Stop
btnStop.addEventListener('click', () => {
  if (repl.executing) {
    // Stop REPL execution but keep REPL state
    interpreter.stop();
    return;
  }
  interpreter.stop();
  setRunning(false);
  btnPause.innerHTML = '<span class="btn-icon">&#9646;&#9646;</span> Pause';
  refreshFileList();
  repl.resetState();
  repl.activate();
});

// Reset
btnReset.addEventListener('click', async () => {
  if (!monitorOn) return;

  if (interpreter.running && !repl.executing) {
    // Program running: stop and re-run
    interpreter.stop();
    audio.stopBackground();
    repl.deactivate();
    const source = codeEditor.value;
    const runId = ++currentRunId;
    try {
      const tokens = tokenize(source);
      const { ast, labels, functions } = parse(tokens);
      interpreter.load(ast, labels, functions);
      setRunning(true);
      await interpreter.run();
    } catch (e) {
      crtScreen.showError(`ERROR: ${e.message}`);
    } finally {
      if (runId === currentRunId) {
        setRunning(false);
      }
      refreshFileList();
      repl.resetState();
      repl.activate();
    }
  } else {
    // REPL idle or executing: stop, clear, fresh prompt
    if (repl.executing) {
      interpreter.stop();
    }
    audio.stopBackground();
    crtScreen.clear();
    repl.deactivate();
    repl.resetState();
    setRunning(false);
    btnPause.innerHTML = '<span class="btn-icon">&#9646;&#9646;</span> Pause';
    repl.activate();
  }
});

// Save
btnSave.addEventListener('click', () => {
  const source = codeEditor.value;
  const blob = new Blob([source], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'program.sam';
  a.click();
  URL.revokeObjectURL(url);
});

// Load
btnLoad.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    codeEditor.value = reader.result;
    codeEditor.dispatchEvent(new Event('input'));
  };
  reader.readAsText(file);
  fileInput.value = '';
});

// Power
function togglePower() {
  if (monitorOn) {
    // Turn off: pause program and all audio, black out screen
    repl.deactivate();
    if (interpreter.running && !interpreter.paused) {
      interpreter.pause();
      powerPausedInterpreter = true;
    }
    audio.suspendAll();
    monitorScreen.classList.add('off');
    btnPower.classList.add('off');
    ledPower.classList.remove('on-green');
    ledTurbo.classList.remove('on-amber');
    setResetLed(false);
    monitorOn = false;
  } else {
    // Turn on: resume audio and program, restore screen
    monitorScreen.classList.remove('off');
    btnPower.classList.remove('off');
    ledPower.classList.add('on-green');
    if (turboOn) ledTurbo.classList.add('on-amber');
    monitorOn = true;
    audio.resumeAll();
    if (powerPausedInterpreter) {
      interpreter.resume();
      powerPausedInterpreter = false;
    } else {
      repl.activate();
    }
    crtScreen.render();
  }
}

btnPower.addEventListener('click', togglePower);
btnTowerPower.addEventListener('click', togglePower);

// === Local Files Panel ===

function refreshFileList() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('sambasic_file:')) {
      keys.push(key.slice('sambasic_file:'.length));
    }
  }
  keys.sort((a, b) => a.localeCompare(b));

  filesList.innerHTML = '';
  if (keys.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'files-empty';
    empty.textContent = 'No files';
    filesList.appendChild(empty);
    selectedFile = null;
  } else {
    if (selectedFile && !keys.includes(selectedFile)) {
      selectedFile = null;
    }
    for (const name of keys) {
      const item = document.createElement('div');
      item.className = 'files-item';
      item.textContent = name;
      if (name === selectedFile) {
        item.classList.add('selected');
      }
      filesList.appendChild(item);
    }
  }
  btnDownload.disabled = !selectedFile;
  btnRemove.disabled = !selectedFile;
}

filesList.addEventListener('click', (e) => {
  const item = e.target.closest('.files-item');
  if (!item) return;
  const name = item.textContent;
  if (name === selectedFile) {
    selectedFile = null;
  } else {
    selectedFile = name;
  }
  filesList.querySelectorAll('.files-item').forEach(el => {
    el.classList.toggle('selected', el.textContent === selectedFile);
  });
  btnDownload.disabled = !selectedFile;
  btnRemove.disabled = !selectedFile;
});

btnUpload.addEventListener('click', () => {
  fileInputUpload.click();
});

fileInputUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem('sambasic_file:' + file.name, reader.result);
    refreshFileList();
  };
  reader.readAsText(file);
  fileInputUpload.value = '';
});

btnDownload.addEventListener('click', () => {
  if (!selectedFile) return;
  const content = localStorage.getItem('sambasic_file:' + selectedFile);
  if (content == null) return;
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = selectedFile;
  a.click();
  URL.revokeObjectURL(url);
});

btnRemove.addEventListener('click', () => {
  if (!selectedFile) return;
  localStorage.removeItem('sambasic_file:' + selectedFile);
  selectedFile = null;
  refreshFileList();
});

refreshFileList();

// === REPL Focus Wiring ===
monitorScreen.setAttribute('tabindex', '0');
monitorScreen.addEventListener('click', () => {
  if (!monitorOn || !repl.active) return;
  monitorScreen.focus();
  repl.onMonitorFocus();
});

codeEditor.addEventListener('focus', () => {
  repl.onEditorFocus();
});

// Enable/disable STOP button and reset LED when REPL starts/stops executing
repl.onExecutingChange = (executing) => {
  btnStop.disabled = !executing;
  setResetLed(executing);
};

// Turbo button
btnTurbo.addEventListener('click', () => {
  turboOn = !turboOn;
  ledTurbo.classList.toggle('on-amber', turboOn);
});

// Initialize LEDs
ledPower.classList.add('on-green');
ledTurbo.classList.add('on-amber');

// === Boot Sequence ===

async function runBootSequence() {
  const GREEN = '#33FF33';
  let bootSkipped = false;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const skip = () => { bootSkipped = true; };

  document.addEventListener('keydown', skip);
  document.addEventListener('click', skip);

  try {
    setResetLed(true);
    if (bootSkipped) return;

    // 2. ASCII banner (instant)
    const banner = [
      "__     __    _       _   _              _         _",
      "\\ \\   / /__ (_) __ _| |_| |   ___  ___ | |_ _ __ (_) ___ ___",
      " \\ \\ / / _ \\| |/ _` | __| |  / _ \\/ __|| __| '__|| |/ __/ __|",
      "  \\ V / (_) | | (_| | |_| |_|  __/ (__ | |_| |   | | (__\\__ \\",
      "   \\_/ \\___/|_|\\__, |\\__|____\\___|\\___| \\__|_|   |_|\\___|___/",
      "                |___/",
      "                        A Division of Voigt Manufacturing Co.",
    ];
    for (const line of banner) {
      crtScreen.print(line, GREEN);
    }
    crtScreen.render();
    await delay(800);
    if (bootSkipped) return;

    // 3. System info lines
    crtScreen.print('', GREEN);
    crtScreen.print('Voigtlectrics 9000 Pro BIOS v3.21', GREEN);
    crtScreen.render();
    await delay(200);
    if (bootSkipped) return;

    crtScreen.print('Copyright (C) 1994 Voigt Manufacturing Co.', GREEN);
    crtScreen.render();
    await delay(300);
    if (bootSkipped) return;

    crtScreen.print('', GREEN);
    crtScreen.printInline('CPU: Voigt V83 Processor 33MHz', GREEN);
    crtScreen.render();
    const dots = 12;
    for (let i = 0; i < dots; i++) {
      await delay(500 / dots);
      if (bootSkipped) return;
      crtScreen.printInline('.', GREEN);
      crtScreen.render();
    }
    crtScreen.printInline('OK', GREEN);
    crtScreen.newline();
    crtScreen.render();
    await delay(300);
    if (bootSkipped) return;

    // 4. Memory test (animated counter)
    crtScreen.printInline('Memory Test: ', GREEN);
    crtScreen.render();
    const memRow = crtScreen.cursorRow + 1; // moveCursor is 1-based
    const memCol = crtScreen.cursorCol + 1;

    for (let kb = 0; kb <= 16384; kb += 512) {
      crtScreen.moveCursor(memRow, memCol);
      crtScreen.printInline(kb + ' KB   ', GREEN);
      crtScreen.render();
      if (bootSkipped) return;
      if (kb < 16384) await delay(40);
    }
    crtScreen.moveCursor(memRow, memCol);
    crtScreen.printInline('16384 KB OK', GREEN);
    crtScreen.newline();
    crtScreen.render();
    await delay(300);
    if (bootSkipped) return;

    // 4b. Frozzling Grobnitz spinner
    crtScreen.printInline('Frozzling Grobnitz... ', GREEN);
    crtScreen.render();
    const spinChars = ['/', '-', '\\', '|'];
    const spinRow = crtScreen.cursorRow + 1;
    const spinCol = crtScreen.cursorCol + 1;
    const spinEnd = Date.now() + 1500;
    let spinIdx = 0;
    while (Date.now() < spinEnd) {
      crtScreen.moveCursor(spinRow, spinCol);
      crtScreen.printInline(spinChars[spinIdx % spinChars.length], GREEN);
      crtScreen.render();
      if (bootSkipped) return;
      spinIdx++;
      await delay(80);
    }
    crtScreen.moveCursor(spinRow, spinCol);
    crtScreen.printInline('OK', GREEN);
    crtScreen.newline();
    crtScreen.render();
    if (bootSkipped) return;

    // 5. Hardware detection (lines with pauses)
    crtScreen.print('', GREEN);
    crtScreen.render();

    const hwLines = [
      'Primary Master: Voigt VHD-540 540MB',
      'Primary Slave:  None',
      'CD-ROM Drive:   Voigt VCD-4X',
      '',
      'Keyboard: Detected',
      'Mouse: Voigt Serial Mouse',
    ];
    for (const line of hwLines) {
      crtScreen.print(line, GREEN);
      crtScreen.render();
      if (bootSkipped) return;
      await delay(line === '' ? 100 : 200);
      if (bootSkipped) return;
    }

    // 6. Wait for user to start
    setResetLed(false);
    crtScreen.print('', GREEN);
    crtScreen.print('Press any key to start SamBasic', GREEN);
    crtScreen.render();

    // Remove skip listeners — the next gesture starts SamBasic instead
    document.removeEventListener('keydown', skip);
    document.removeEventListener('click', skip);

    await new Promise(resolve => {
      const start = () => {
        document.removeEventListener('keydown', start);
        document.removeEventListener('click', start);
        resolve();
      };
      document.addEventListener('keydown', start);
      document.addEventListener('click', start);
    });

    // Play startup chime (AudioContext now unlocked by user gesture)
    await audio.playPoly([
      { musicStr: 'T160 O4 C8 E8 G8 >C4.', waveType: 'triangle', volume: 1.2 },
      { musicStr: 'T160 O3 C8 G8 >E8 G4.', waveType: 'sine', volume: 0.8 },
      { musicStr: 'T160 O5 R8 R8 E8 G4.', waveType: 'sine', volume: 0.6 },
    ]);

  } finally {
    setResetLed(false);
    crtScreen.clear();
  }
}

// Start boot sequence, then activate REPL
(async () => {
  await runBootSequence();
  crtScreen.print('SamBasic v1.1 (C) 1994 Voigt Manufacturing Co.', '#33FF33');
  crtScreen.render();
  repl.activate();
  monitorScreen.focus();
  repl.onMonitorFocus();
})();

// === Examples Dropdown ===

const btnExamples = document.getElementById('btn-examples');
const examplesMenu = document.getElementById('examples-menu');

if (window.location.protocol === 'file:') {
  btnExamples.parentElement.style.display = 'none';
} else {
  btnExamples.addEventListener('click', (e) => {
    e.stopPropagation();
    examplesMenu.hidden = !examplesMenu.hidden;
  });

  document.addEventListener('click', (e) => {
    if (!btnExamples.contains(e.target) && !examplesMenu.contains(e.target)) {
      examplesMenu.hidden = true;
    }
  });

  examplesMenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.examples-item');
    if (!item) return;

    if (codeEditor.value.trim() && !confirm('Replace current code with example?')) {
      examplesMenu.hidden = true;
      return;
    }

    const filename = item.dataset.file;
    try {
      const resp = await fetch('examples/' + filename);
      if (!resp.ok) throw new Error('Failed to load');
      codeEditor.value = await resp.text();
      codeEditor.dispatchEvent(new Event('input'));
    } catch (err) {
      alert('Could not load example: ' + err.message);
    }
    examplesMenu.hidden = true;
  });
}
