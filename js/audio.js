class SamAudio {
  constructor() {
    this.ctx = null;      // foreground audio context
    this._bgCtx = null;   // background audio context (separate so pause/stop don't affect foreground)
    // Background playback state
    this._bgNodes = [];
    this._bgTimeout = null;
    this._bgPlaying = false;
    this._bgPaused = false;
    this._bgRemaining = 0;
    this._bgStartTime = 0;
    this._bgDuration = 0;
    // Stored for repeat
    this._bgVoices = null;
    this._bgMusicStr = null;
    this._bgWaveType = null;
    this._bgOnRepeat = false;
    this._bgIsPoly = false;
    // Power button tracking
    this._powerPausedBg = false;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _ensureBgContext() {
    if (!this._bgCtx) {
      this._bgCtx = new AudioContext();
    }
    if (this._bgCtx.state === 'suspended') {
      this._bgCtx.resume();
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

  scheduleNote(note, time, waveType, gainLevel, ctx) {
    if (!ctx) ctx = this.ctx;
    if (note.freq === -1) {
      // White noise percussion
      const sampleRate = ctx.sampleRate;
      const len = Math.floor(sampleRate * note.duration);
      const buffer = ctx.createBuffer(1, len, sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < len; j++) {
        data[j] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = gainLevel;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(time);
      gain.gain.setValueAtTime(gainLevel, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + note.duration - 0.01);
      return src;
    } else if (note.freq > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = waveType;
      osc.frequency.value = note.freq;
      gain.gain.value = gainLevel;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      gain.gain.setValueAtTime(gainLevel, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + note.duration - 0.01);
      osc.stop(time + note.duration);
      return osc;
    }
    return null;
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
    const baseGain = 0.3 / voices.length;

    // First pass: parse all voices and compute durations
    const parsed = voices.map(voice => {
      const notes = this.parseMusicString(voice.musicStr);
      let dur = 0;
      for (const note of notes) dur += note.duration;
      return { notes, waveType: voice.waveType || 'square', volume: voice.volume, duration: dur };
    });

    // Validate beat counts
    const first = parsed[0].duration;
    for (let i = 1; i < parsed.length; i++) {
      if (Math.abs(parsed[i].duration - first) > 0.001) {
        throw new Error(`PLAYPOLY: voice ${i + 1} duration (${parsed[i].duration.toFixed(2)}s) doesn't match voice 1 (${first.toFixed(2)}s) — check beat counts`);
      }
    }

    // Second pass: schedule notes
    let maxDuration = 0;
    for (const voice of parsed) {
      const gainLevel = voice.volume != null ? voice.volume * baseGain : baseGain;
      let time = startTime;
      for (const note of voice.notes) {
        this.scheduleNote(note, time, voice.waveType, gainLevel);
        time += note.duration;
      }
      if (voice.duration > maxDuration) maxDuration = voice.duration;
    }

    await new Promise(resolve => setTimeout(resolve, maxDuration * 1000));
  }

  // --- Background playback ---

  stopBackground() {
    for (const node of this._bgNodes) {
      try { node.stop(); } catch (e) {}
      try { node.disconnect(); } catch (e) {}
    }
    this._bgNodes = [];
    if (this._bgTimeout != null) {
      clearTimeout(this._bgTimeout);
      this._bgTimeout = null;
    }
    this._bgPlaying = false;
    this._bgPaused = false;
    this._bgOnRepeat = false;
    if (this._bgCtx) {
      this._bgCtx.close();
      this._bgCtx = null;
    }
  }

  stopAll() {
    this.stopBackground();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }

  suspendAll() {
    // Pause bg audio timing if active
    if (this._bgPlaying && !this._bgPaused) {
      this.pauseBackground();
      this._powerPausedBg = true;
    } else {
      this._powerPausedBg = false;
    }
    // Suspend foreground context to freeze any playing notes
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend();
    }
  }

  resumeAll() {
    // Resume foreground context
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    // Resume bg audio if power-paused
    if (this._powerPausedBg) {
      this._powerPausedBg = false;
      this.resumeBackground();
    }
  }

  pauseBackground() {
    if (!this._bgPlaying || this._bgPaused) return;
    this._bgPaused = true;
    const elapsed = Date.now() - this._bgStartTime;
    this._bgRemaining = Math.max(0, this._bgDuration - elapsed);
    if (this._bgTimeout != null) {
      clearTimeout(this._bgTimeout);
      this._bgTimeout = null;
    }
    if (this._bgCtx) {
      this._bgCtx.suspend();
    }
  }

  resumeBackground() {
    if (!this._bgPlaying || !this._bgPaused) return;
    this._bgPaused = false;
    if (this._bgCtx) {
      this._bgCtx.resume();
    }
    this._bgStartTime = Date.now();
    this._bgDuration = this._bgRemaining;
    this._bgTimeout = setTimeout(() => this._bgFinished(), this._bgRemaining);
  }

  _bgFinished() {
    this._bgTimeout = null;
    for (const node of this._bgNodes) {
      try { node.disconnect(); } catch (e) {}
    }
    this._bgNodes = [];

    if (this._bgOnRepeat) {
      if (this._bgIsPoly) {
        this._scheduleBgPoly(this._bgVoices);
      } else {
        this._scheduleBgSequence(this._bgMusicStr, this._bgWaveType);
      }
    } else {
      this._bgPlaying = false;
      if (this._bgCtx) {
        this._bgCtx.close();
        this._bgCtx = null;
      }
    }
  }

  playSequenceBg(musicStr, waveType = 'square', onRepeat = false) {
    this.stopBackground();
    this._ensureBgContext();
    this._bgOnRepeat = onRepeat;
    this._bgIsPoly = false;
    this._bgMusicStr = musicStr;
    this._bgWaveType = waveType;
    this._bgPlaying = true;
    this._bgPaused = false;
    this._scheduleBgSequence(musicStr, waveType);
  }

  _scheduleBgSequence(musicStr, waveType) {
    const notes = this.parseMusicString(musicStr);
    const startTime = this._bgCtx.currentTime;
    let time = startTime;

    for (const note of notes) {
      const node = this.scheduleNote(note, time, waveType, 0.3, this._bgCtx);
      if (node) this._bgNodes.push(node);
      time += note.duration;
    }

    const totalDuration = (time - startTime) * 1000;
    this._bgStartTime = Date.now();
    this._bgDuration = totalDuration;
    this._bgTimeout = setTimeout(() => this._bgFinished(), totalDuration);
  }

  playPolyBg(voices, onRepeat = false) {
    this.stopBackground();
    this._ensureBgContext();
    this._bgOnRepeat = onRepeat;
    this._bgIsPoly = true;
    this._bgVoices = voices;
    this._bgPlaying = true;
    this._bgPaused = false;
    this._scheduleBgPoly(voices);
  }

  _scheduleBgPoly(voices) {
    const startTime = this._bgCtx.currentTime;
    const baseGain = 0.3 / voices.length;

    // First pass: parse all voices and compute durations
    const parsed = voices.map(voice => {
      const notes = this.parseMusicString(voice.musicStr);
      let dur = 0;
      for (const note of notes) dur += note.duration;
      return { notes, waveType: voice.waveType || 'square', volume: voice.volume, duration: dur };
    });

    // Validate beat counts
    const first = parsed[0].duration;
    for (let i = 1; i < parsed.length; i++) {
      if (Math.abs(parsed[i].duration - first) > 0.001) {
        throw new Error(`PLAYPOLY: voice ${i + 1} duration (${parsed[i].duration.toFixed(2)}s) doesn't match voice 1 (${first.toFixed(2)}s) — check beat counts`);
      }
    }

    // Second pass: schedule notes
    let maxDuration = 0;
    for (const voice of parsed) {
      const gainLevel = voice.volume != null ? voice.volume * baseGain : baseGain;
      let time = startTime;
      for (const note of voice.notes) {
        const node = this.scheduleNote(note, time, voice.waveType, gainLevel, this._bgCtx);
        if (node) this._bgNodes.push(node);
        time += note.duration;
      }
      if (voice.duration > maxDuration) maxDuration = voice.duration;
    }

    this._bgStartTime = Date.now();
    this._bgDuration = maxDuration * 1000;
    this._bgTimeout = setTimeout(() => this._bgFinished(), maxDuration * 1000);
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
