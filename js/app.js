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

let monitorOn = true;
let powerPausedInterpreter = false;
let currentRunId = 0;

// Initialize
const crtScreen = new Screen(screenOutput);
const audio = new SamAudio();
const interpreter = new Interpreter(crtScreen, audio);
setupEditor(codeEditor, lineNumbers);

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
    const { ast, dataPool, labels, functions } = parse(tokens);
    interpreter.load(ast, dataPool, labels, functions);
    setRunning(true);
    await interpreter.run();
  } catch (e) {
    crtScreen.showError(`ERROR: ${e.message}`);
  } finally {
    if (runId === currentRunId) {
      setRunning(false);
    }
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

