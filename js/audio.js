class SamAudio {
  constructor() {
    this.ctx = null;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  async beep() {
    this.ensureContext();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.stop(this.ctx.currentTime + 0.2);
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  scheduleNote(note, time, waveType, gainLevel) {
    if (note.freq === -1) {
      // White noise percussion
      const sampleRate = this.ctx.sampleRate;
      const len = Math.floor(sampleRate * note.duration);
      const buffer = this.ctx.createBuffer(1, len, sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < len; j++) {
        data[j] = Math.random() * 2 - 1;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = gainLevel;
      src.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(time);
      gain.gain.setValueAtTime(gainLevel, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + note.duration - 0.01);
    } else if (note.freq > 0) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = waveType;
      osc.frequency.value = note.freq;
      gain.gain.value = gainLevel;
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(time);
      gain.gain.setValueAtTime(gainLevel, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + note.duration - 0.01);
      osc.stop(time + note.duration);
    }
  }

  async playSequence(musicStr, waveType = 'square') {
    this.ensureContext();
    const notes = this.parseMusicString(musicStr);
    const startTime = this.ctx.currentTime;
    let time = startTime;

    for (const note of notes) {
      this.scheduleNote(note, time, waveType, 0.3);
      time += note.duration;
    }

    const totalDuration = (time - startTime) * 1000;
    await new Promise(resolve => setTimeout(resolve, totalDuration));
  }

  async playPoly(voices) {
    this.ensureContext();
    const startTime = this.ctx.currentTime;
    let maxDuration = 0;
    const gainLevel = 0.3 / voices.length;

    for (const voice of voices) {
      const notes = this.parseMusicString(voice.musicStr);
      const waveType = voice.waveType || 'square';
      let time = startTime;

      for (const note of notes) {
        this.scheduleNote(note, time, waveType, gainLevel);
        time += note.duration;
      }

      const voiceDuration = time - startTime;
      if (voiceDuration > maxDuration) maxDuration = voiceDuration;
    }

    await new Promise(resolve => setTimeout(resolve, maxDuration * 1000));
  }

  parseMusicString(str) {
    const notes = [];
    let octave = 4;
    let defaultLength = 4; // quarter note
    let tempo = 120; // BPM

    // Note frequencies for octave 0 (will be shifted by octave)
    const noteFreqs = {
      'C': 16.35, 'D': 18.35, 'E': 20.60, 'F': 21.83,
      'G': 24.50, 'A': 27.50, 'B': 30.87,
    };

    let i = 0;
    const s = str.toUpperCase();

    while (i < s.length) {
      const ch = s[i];

      // Skip whitespace
      if (ch === ' ' || ch === '\t') { i++; continue; }

      // Note: A-G with optional # or - (flat)
      if (ch >= 'A' && ch <= 'G') {
        let noteName = ch;
        i++;
        let semitoneShift = 0;

        if (i < s.length && (s[i] === '#' || s[i] === '+')) {
          semitoneShift = 1;
          i++;
        } else if (i < s.length && s[i] === '-') {
          semitoneShift = -1;
          i++;
        }

        // Optional length number
        let length = defaultLength;
        const numStr = this.readNumber(s, i);
        if (numStr) {
          length = parseInt(numStr);
          i += numStr.length;
        }

        // Dotted note
        let dotMultiplier = 1;
        if (i < s.length && s[i] === '.') {
          dotMultiplier = 1.5;
          i++;
        }

        const baseFreq = noteFreqs[noteName] * Math.pow(2, octave);
        const freq = baseFreq * Math.pow(2, semitoneShift / 12);
        const beatDuration = 60 / tempo;
        const duration = (4 / length) * beatDuration * dotMultiplier;

        notes.push({ freq, duration });
        continue;
      }

      // Octave
      if (ch === 'O') {
        i++;
        const numStr = this.readNumber(s, i);
        if (numStr) {
          octave = parseInt(numStr);
          i += numStr.length;
        }
        continue;
      }

      // > and < for octave up/down
      if (ch === '>') { octave++; i++; continue; }
      if (ch === '<') { octave--; i++; continue; }

      // Length
      if (ch === 'L') {
        i++;
        const numStr = this.readNumber(s, i);
        if (numStr) {
          defaultLength = parseInt(numStr);
          i += numStr.length;
        }
        continue;
      }

      // Tempo
      if (ch === 'T') {
        i++;
        const numStr = this.readNumber(s, i);
        if (numStr) {
          tempo = parseInt(numStr);
          i += numStr.length;
        }
        continue;
      }

      // Percussion (white noise)
      if (ch === 'P') {
        i++;
        let length = defaultLength;
        const numStr = this.readNumber(s, i);
        if (numStr) {
          length = parseInt(numStr);
          i += numStr.length;
        }
        let dotMultiplier = 1;
        if (i < s.length && s[i] === '.') {
          dotMultiplier = 1.5;
          i++;
        }
        const beatDuration = 60 / tempo;
        const duration = (4 / length) * beatDuration * dotMultiplier;
        notes.push({ freq: -1, duration });
        continue;
      }

      // Rest
      if (ch === 'R') {
        i++;
        let length = defaultLength;
        const numStr = this.readNumber(s, i);
        if (numStr) {
          length = parseInt(numStr);
          i += numStr.length;
        }
        const beatDuration = 60 / tempo;
        const duration = (4 / length) * beatDuration;
        notes.push({ freq: 0, duration });
        continue;
      }

      // Unknown character, skip
      i++;
    }

    return notes;
  }

  readNumber(s, i) {
    let num = '';
    while (i < s.length && s[i] >= '0' && s[i] <= '9') {
      num += s[i];
      i++;
    }
    return num || null;
  }
}
