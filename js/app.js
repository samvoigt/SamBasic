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

  try {
    const tokens = tokenize(source);
    const { ast, dataPool, labels } = parse(tokens);
    interpreter.load(ast, dataPool, labels);
    setRunning(true);
    await interpreter.run();
  } catch (e) {
    crtScreen.showError(`ERROR: ${e.message}`);
  } finally {
    setRunning(false);
  }
});

// Pause
btnPause.addEventListener('click', () => {
  if (interpreter.paused) {
    interpreter.resume();
    btnPause.innerHTML = '<span class="btn-icon">&#9646;&#9646;</span> Pause';
  } else {
    interpreter.pause();
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
    // Turn off: stop any running program, black out screen
    if (interpreter.running) {
      interpreter.stop();
      btnPause.innerHTML = '<span class="btn-icon">&#9646;&#9646;</span> Pause';
      setRunning(false);
    }
    monitorScreen.classList.add('off');
    btnPower.classList.add('off');
    monitorOn = false;
  } else {
    // Turn on: restore screen
    monitorScreen.classList.remove('off');
    btnPower.classList.remove('off');
    monitorOn = true;
    crtScreen.render();
  }
});

