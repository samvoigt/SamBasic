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
const exampleSelect = document.getElementById('example-select');

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
    btnPause.textContent = 'Pause';
  } else {
    interpreter.pause();
    btnPause.textContent = 'Resume';
  }
});

// Step
btnStep.addEventListener('click', () => {
  interpreter.step();
});

// Stop
btnStop.addEventListener('click', () => {
  interpreter.stop();
  btnPause.textContent = 'Pause';
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

// Examples (inline so they work from file:// without fetch)
const EXAMPLES = {
  hello: `COLOR GREEN
PRINT "================================"
PRINT "  Welcome to SamBasic!"
PRINT "  The Voigtlectrics 9000"
PRINT "================================"
COLOR LIGHTGRAY
PRINT ""
PRINT "Hello, World!"
PRINT ""
COLOR CYAN
PRINT "This is a simple demo program."
COLOR YELLOW
PRINT "SamBasic supports 16 EGA colors!"
COLOR LIGHTGRAY
PRINT ""
INPUT "What is your name? ", $name
PRINT ""
COLOR LIGHTGREEN
PRINT "Nice to meet you, " + $name + "!"
COLOR LIGHTGRAY
PRINT ""
BEEP
PRINT "Press any key..."
LABEL $waitkey
GETKEY $k
IF $k = "" THEN
  GOTO $waitkey
ENDIF
PRINT "You pressed: " + $k
PRINT ""
PRINT "Goodbye!"`,

  fizzbuzz: `COLOR GREEN
PRINT "=== FizzBuzz ==="
COLOR LIGHTGRAY
PRINT ""

#count3 = 0
#count5 = 0

FOR #i GOESFROM 1 TO 30 WITHSTEP 1
  #count3 = #count3 + 1
  #count5 = #count5 + 1
  #fizz = 0
  #buzz = 0

  IF #count3 = 3 THEN
    #fizz = 1
    #count3 = 0
  ENDIF

  IF #count5 = 5 THEN
    #buzz = 1
    #count5 = 0
  ENDIF

  IF #fizz = 1 AND #buzz = 1 THEN
    COLOR YELLOW
    PRINT "FizzBuzz"
  ELSE
    IF #fizz = 1 THEN
      COLOR LIGHTCYAN
      PRINT "Fizz"
    ELSE
      IF #buzz = 1 THEN
        COLOR LIGHTMAGENTA
        PRINT "Buzz"
      ELSE
        COLOR LIGHTGRAY
        PRINT #i
      ENDIF
    ENDIF
  ENDIF
ENDFOR

COLOR LIGHTGRAY
PRINT ""
PRINT "Done!"`,
};

exampleSelect.addEventListener('change', () => {
  const val = exampleSelect.value;
  if (!val || !EXAMPLES[val]) return;
  codeEditor.value = EXAMPLES[val];
  codeEditor.dispatchEvent(new Event('input'));
  exampleSelect.value = '';
});
