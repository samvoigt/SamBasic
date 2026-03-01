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

let monitorOn = true;
let selectedFile = null;
let powerPausedInterpreter = false;
let currentRunId = 0;

const codeHighlight = document.getElementById('code-highlight');

// Initialize
const crtScreen = new Screen(screenOutput);
const audio = new SamAudio();
const interpreter = new Interpreter(crtScreen, audio);
setupEditor(codeEditor, lineNumbers, codeHighlight);

// Button state management
function setRunning(isRunning) {
  btnRun.disabled = isRunning;
  btnPause.disabled = !isRunning;
  btnStep.disabled = !isRunning;
  btnStop.disabled = !isRunning;
  codeEditor.readOnly = isRunning;
}

// Run
btnRun.addEventListener('click', async () => {
  if (!monitorOn) return;
  const source = codeEditor.value;
  if (!source.trim()) return;

  if (interpreter.running) {
    interpreter.stop();
  }

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
  }
});

// Pause
btnPause.addEventListener('click', () => {
  if (interpreter.paused) {
    interpreter.resume();
    btnPause.innerHTML = '<span class="btn-icon">&#9646;&#9646;</span> Pause';
  } else {
    interpreter.pause();
    audio.stopBackground();
    btnPause.innerHTML = '<span class="btn-icon">&#9654;</span> Resume';
  }
});

// Step
btnStep.addEventListener('click', () => {
  interpreter.step();
});

// Stop
btnStop.addEventListener('click', () => {
  interpreter.stop();
  setRunning(false);
  btnPause.innerHTML = '<span class="btn-icon">&#9646;&#9646;</span> Pause';
  refreshFileList();
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
btnPower.addEventListener('click', () => {
  if (monitorOn) {
    // Turn off: pause program and all audio, black out screen
    if (interpreter.running && !interpreter.paused) {
      interpreter.pause();
      powerPausedInterpreter = true;
    }
    audio.suspendAll();
    monitorScreen.classList.add('off');
    btnPower.classList.add('off');
    monitorOn = false;
  } else {
    // Turn on: resume audio and program, restore screen
    monitorScreen.classList.remove('off');
    btnPower.classList.remove('off');
    monitorOn = true;
    audio.resumeAll();
    if (powerPausedInterpreter) {
      interpreter.resume();
      powerPausedInterpreter = false;
    }
    crtScreen.render();
  }
});

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
