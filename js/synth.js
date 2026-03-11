class SamSynth {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.channels = {};
    this.nextId = 1;
    this._noiseBuffer = null; // cached white noise buffer
    this.MAX_CHANNELS = 32;
  }

  _ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _getNoiseBuffer() {
    if (this._noiseBuffer) return this._noiseBuffer;
    this._ensureCtx();
    const sampleRate = this.ctx.sampleRate;
    const len = Math.floor(sampleRate * 2); // 2 seconds
    const buffer = this.ctx.createBuffer(1, len, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this._noiseBuffer = buffer;
    return buffer;
  }

  _channelCount() {
    return Object.keys(this.channels).length;
  }

  generateTone(freq, waveType) {
    this._ensureCtx();
    if (this._channelCount() >= this.MAX_CHANNELS) {
      throw new Error(`GENERATETONE: maximum of ${this.MAX_CHANNELS} channels reached`);
    }
    const id = this.nextId++;
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 0;
    const filterNode = this.ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 20000;
    filterNode.Q.value = 1;
    gainNode.connect(filterNode);
    filterNode.connect(this.masterGain);

    const isNoise = waveType === 'noise';

    this.channels[id] = {
      id,
      isNoise,
      freq: isNoise ? 0 : freq,
      waveType,
      source: null,
      gainNode,
      filterNode,
      volume: 0.5,
      envelope: { a: 0.01, d: 0, s: 1.0, r: 0.01 },
      detune: 0,
      playing: false,
      releasing: false,
      _releaseTimeout: null,
    };
    return id;
  }

  _getChannel(id, cmdName) {
    const ch = this.channels[id];
    if (!ch) throw new Error(`${cmdName}: tone ${id} not found`);
    return ch;
  }

  _createSource(ch) {
    if (ch.isNoise) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._getNoiseBuffer();
      src.loop = true;
      src.connect(ch.gainNode);
      return src;
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = ch.waveType === 'saw' ? 'sawtooth' : ch.waveType;
      osc.frequency.value = ch.freq;
      osc.detune.value = ch.detune;
      osc.connect(ch.gainNode);
      return osc;
    }
  }

  toneOn(id) {
    const ch = this._getChannel(id, 'TONEON');
    this._ensureCtx();
    const now = this.ctx.currentTime;

    // If releasing or playing, stop old source
    if (ch._releaseTimeout) {
      clearTimeout(ch._releaseTimeout);
      ch._releaseTimeout = null;
    }
    if (ch.source) {
      try { ch.source.stop(); } catch (e) {}
      try { ch.source.disconnect(); } catch (e) {}
      ch.source = null;
    }

    // Create fresh source
    ch.source = this._createSource(ch);

    // Apply ADSR attack/decay/sustain
    const { a, d, s } = ch.envelope;
    const peakGain = ch.volume;
    const sustainGain = peakGain * s;

    ch.gainNode.gain.cancelScheduledValues(now);
    ch.gainNode.gain.setValueAtTime(0, now);
    ch.gainNode.gain.linearRampToValueAtTime(peakGain, now + a);
    if (d > 0) {
      ch.gainNode.gain.linearRampToValueAtTime(sustainGain, now + a + d);
    } else {
      ch.gainNode.gain.setValueAtTime(sustainGain, now + a);
    }

    ch.source.start(now);
    ch.playing = true;
    ch.releasing = false;
  }

  toneOff(id) {
    const ch = this._getChannel(id, 'TONEOFF');
    if (!ch.playing || ch.releasing) return;
    this._ensureCtx();
    const now = this.ctx.currentTime;
    const { r } = ch.envelope;

    ch.releasing = true;
    ch.gainNode.gain.cancelScheduledValues(now);
    ch.gainNode.gain.setValueAtTime(ch.gainNode.gain.value, now);
    ch.gainNode.gain.linearRampToValueAtTime(0, now + r);

    const source = ch.source;
    ch._releaseTimeout = setTimeout(() => {
      ch._releaseTimeout = null;
      try { source.stop(); } catch (e) {}
      try { source.disconnect(); } catch (e) {}
      if (ch.source === source) {
        ch.source = null;
        ch.playing = false;
        ch.releasing = false;
      }
    }, r * 1000 + 20); // small buffer past release time
  }

  setFreq(id, freq, rampTime) {
    const ch = this._getChannel(id, 'TONEFREQ');
    if (ch.isNoise) return; // no-op for noise
    ch.freq = freq;
    if (ch.source && ch.playing) {
      if (rampTime && rampTime > 0) {
        const now = this.ctx.currentTime;
        ch.source.frequency.setValueAtTime(ch.source.frequency.value, now);
        ch.source.frequency.linearRampToValueAtTime(freq, now + rampTime);
      } else {
        ch.source.frequency.value = freq;
      }
    }
  }

  setWave(id, waveType) {
    const ch = this._getChannel(id, 'TONEWAVE');
    const newIsNoise = waveType === 'noise';
    const typeChanged = ch.isNoise !== newIsNoise;
    ch.waveType = waveType;
    ch.isNoise = newIsNoise;

    if (ch.source && ch.playing && !ch.releasing) {
      if (typeChanged) {
        // Must swap source type — retrigger
        this.toneOn(id);
      } else if (!ch.isNoise) {
        // Just change oscillator type on the live node
        ch.source.type = waveType === 'saw' ? 'sawtooth' : waveType;
      }
    }
  }

  setVolume(id, level) {
    const ch = this._getChannel(id, 'TONEVOLUME');
    ch.volume = Math.max(0, Math.min(1, level));
    // If sustaining (playing, not in attack/decay/release), update gain
    if (ch.playing && !ch.releasing) {
      const sustainGain = ch.volume * ch.envelope.s;
      ch.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      ch.gainNode.gain.setValueAtTime(sustainGain, this.ctx.currentTime);
    }
  }

  setEnvelope(id, a, d, s, r) {
    const ch = this._getChannel(id, 'TONEENVELOPE');
    ch.envelope = {
      a: Math.max(0.001, a),
      d: Math.max(0, d),
      s: Math.max(0, Math.min(1, s)),
      r: Math.max(0.001, r),
    };
  }

  setFilter(id, type, cutoff, resonance) {
    const ch = this._getChannel(id, 'TONEFILTER');
    if (type === 'none') {
      ch.filterNode.type = 'lowpass';
      ch.filterNode.frequency.value = 20000;
      ch.filterNode.Q.value = 1;
    } else {
      ch.filterNode.type = type;
      ch.filterNode.frequency.value = cutoff;
      ch.filterNode.Q.value = resonance;
    }
  }

  setDetune(id, cents) {
    const ch = this._getChannel(id, 'TONEDETUNE');
    if (ch.isNoise) return; // no-op
    ch.detune = cents;
    if (ch.source && ch.playing) {
      ch.source.detune.value = cents;
    }
  }

  setMasterVolume(level) {
    this._ensureCtx();
    this.masterGain.gain.value = Math.max(0, Math.min(1, level));
  }

  deleteChannel(id) {
    const ch = this._getChannel(id, 'DELETETONE');
    if (ch._releaseTimeout) {
      clearTimeout(ch._releaseTimeout);
    }
    if (ch.source) {
      try { ch.source.stop(); } catch (e) {}
      try { ch.source.disconnect(); } catch (e) {}
    }
    ch.gainNode.disconnect();
    ch.filterNode.disconnect();
    delete this.channels[id];
  }

  clear() {
    for (const id of Object.keys(this.channels)) {
      const ch = this.channels[id];
      if (ch._releaseTimeout) clearTimeout(ch._releaseTimeout);
      if (ch.source) {
        try { ch.source.stop(); } catch (e) {}
        try { ch.source.disconnect(); } catch (e) {}
      }
      ch.gainNode.disconnect();
      ch.filterNode.disconnect();
    }
    this.channels = {};
    this.nextId = 1;
  }

  stopAll() {
    this.clear();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.masterGain = null;
    this._noiseBuffer = null;
  }
}
