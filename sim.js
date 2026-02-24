/* Engine Sound Simulator (Web Audio)
   - Synth engine: pulse train + resonances + noise/air + mild distortion + dynamic filters
   - Gear/load model affects RPM response
   - Optional sample mode: load idle/accel/high and crossfade

   Controls:
   - Space: start/stop audio
   - W/S: throttle up/down
   - A/D: shift down/up
*/

const ui = {
    engineSelect: document.getElementById("engineSelect"),
    redline: document.getElementById("redline"),
    throttleBar: document.getElementById("throttleBar"),
    rpmBar: document.getElementById("rpmBar"),
    throttleText: document.getElementById("throttleText"),
    rpmText: document.getElementById("rpmText"),
    gearText: document.getElementById("gearText"),
    startBtn: document.getElementById("startBtn"),
    neutralBtn: document.getElementById("neutralBtn"),
    resetBtn: document.getElementById("resetBtn"),
    engineSvgWrap: document.getElementById("engineSvgWrap"),
    layoutText: document.getElementById("layoutText"),
    cylText: document.getElementById("cylText"),
    feelText: document.getElementById("feelText"),
    scope: document.getElementById("scope"),
  
    idleFile: document.getElementById("idleFile"),
    accelFile: document.getElementById("accelFile"),
    highFile: document.getElementById("highFile"),
    useSamples: document.getElementById("useSamples"),
  };
  
  const EnginePresets = {
    i4:  { cylinders:4, layout:"Inline", feel:"Light / buzzy",  idleRpm:900,  resonanceHz: 120, burble:0.10 },
    i6:  { cylinders:6, layout:"Inline", feel:"Smooth / creamy",idleRpm:750,  resonanceHz: 100, burble:0.08 },
    v8:  { cylinders:8, layout:"V",      feel:"Burble / punchy",idleRpm:700,  resonanceHz: 85,  burble:0.22 },
    v10: { cylinders:10,layout:"V",      feel:"Sharp / exotic", idleRpm:950,  resonanceHz: 95,  burble:0.12 },
    v12: { cylinders:12,layout:"V",      feel:"Very smooth",    idleRpm:650,  resonanceHz: 75,  burble:0.07 },
    v16: { cylinders:16,layout:"V",      feel:"Silky / huge",   idleRpm:600,  resonanceHz: 65,  burble:0.05 },
  };
  
  const Gearbox = {
    ratios: [0, 3.20, 2.10, 1.55, 1.20, 1.00, 0.85], // N is 0
    finalDrive: 3.42
  };
  
  let audio = null;
  
  const state = {
    running: false,
    engineKey: ui.engineSelect.value,
    redline: Number(ui.redline.value),
  
    throttle: 0.0,   // 0..1
    rpm: 0,
    gear: 0,         // 0 = N, 1..6
    speed: 0,        // abstract units
    clutchSlip: 0.08,
    lastT: performance.now(),
  
    // sample buffers
    samples: {
      idle: null,
      accel: null,
      high: null
    }
  };
  
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function smoothstep(t){ return t*t*(3-2*t); }
  
  function engineSvg(engineKey){
    const p = EnginePresets[engineKey];
    const cyl = p.cylinders;
  
    // Simple inline SVG "picture"
    // Inline engines show cylinders in a row; V engines show two banks.
    const isInline = p.layout === "Inline";
    const w = 200, h = 140;
  
    const cylRadius = 10;
    const stroke = "rgba(255,255,255,.18)";
    const fill = "rgba(100,214,255,.20)";
    const fill2 = "rgba(156,255,122,.18)";
  
    let circles = "";
    if (isInline){
      const cols = cyl;
      const startX = 20;
      const gap = (w - 40) / Math.max(1, cols-1);
      const y = 70;
      for(let i=0;i<cols;i++){
        const x = startX + i*gap;
        circles += `<circle cx="${x}" cy="${y}" r="${cylRadius}" fill="${fill}" stroke="${stroke}" />`;
      }
      circles += `<rect x="14" y="55" width="${w-28}" height="30" rx="12" fill="rgba(255,255,255,.03)" stroke="${stroke}" />`;
    } else {
      const bank = Math.floor(cyl/2);
      const startX = 30;
      const gap = (w - 60) / Math.max(1, bank-1);
  
      const y1 = 55;
      const y2 = 85;
      for(let i=0;i<bank;i++){
        const x = startX + i*gap;
        circles += `<circle cx="${x}" cy="${y1}" r="${cylRadius}" fill="${fill}" stroke="${stroke}" />`;
        circles += `<circle cx="${x}" cy="${y2}" r="${cylRadius}" fill="${fill2}" stroke="${stroke}" />`;
      }
      circles += `<path d="M20,45 L100,20 L180,45" fill="rgba(255,255,255,.03)" stroke="${stroke}" />`;
      circles += `<path d="M20,95 L100,120 L180,95" fill="rgba(255,255,255,.03)" stroke="${stroke}" />`;
    }
  
    return `
    <svg width="200" height="140" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="8" width="${w-16}" height="${h-16}" rx="18" fill="rgba(255,255,255,.02)" stroke="${stroke}" />
      <text x="18" y="30" fill="rgba(233,238,245,.9)" font-size="14" font-family="system-ui">
        ${p.layout} ${cyl}
      </text>
      ${circles}
      <text x="18" y="125" fill="rgba(169,180,194,.9)" font-size="12" font-family="system-ui">
        Synth model
      </text>
    </svg>`;
  }
  
  function updateEngineUI(){
    const p = EnginePresets[state.engineKey];
    ui.engineSvgWrap.innerHTML = engineSvg(state.engineKey);
    ui.layoutText.textContent = p.layout;
    ui.cylText.textContent = String(p.cylinders);
    ui.feelText.textContent = p.feel;
  }
  
  updateEngineUI();
  
  ui.engineSelect.addEventListener("change", () => {
    state.engineKey = ui.engineSelect.value;
    updateEngineUI();
    if (audio) audio.setEngine(state.engineKey);
  });
  
  ui.redline.addEventListener("change", () => {
    state.redline = clamp(Number(ui.redline.value), 4500, 11000);
  });
  
  ui.neutralBtn.addEventListener("click", () => state.gear = 0);
  ui.resetBtn.addEventListener("click", () => {
    state.throttle = 0;
    state.gear = 0;
    const p = EnginePresets[state.engineKey];
    state.rpm = p.idleRpm;
    state.speed = 0;
  });
  
  ui.startBtn.addEventListener("click", toggleAudio);
  
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === " ") { e.preventDefault(); toggleAudio(); return; }
    if (k === "w") state.throttle = clamp(state.throttle + 0.08, 0, 1);
    if (k === "s") state.throttle = clamp(state.throttle - 0.08, 0, 1);
    if (k === "d") state.gear = clamp(state.gear + 1, 0, Gearbox.ratios.length-1);
    if (k === "a") state.gear = clamp(state.gear - 1, 0, Gearbox.ratios.length-1);
  });
  
  function updateHUD(){
    ui.throttleBar.style.width = `${Math.round(state.throttle*100)}%`;
    ui.throttleText.textContent = `${Math.round(state.throttle*100)}%`;
  
    const rpmNorm = clamp(state.rpm / state.redline, 0, 1);
    ui.rpmBar.style.width = `${Math.round(rpmNorm*100)}%`;
    ui.rpmText.textContent = `${Math.round(state.rpm)} RPM`;
  
    ui.gearText.textContent = state.gear === 0 ? "N" : String(state.gear);
  }
  
  function physicsStep(dt){
    const p = EnginePresets[state.engineKey];
    const idle = p.idleRpm;
    const red = state.redline;
  
    // target RPM behavior: with gear engaged it depends on "wheel speed",
    // with some clutch slip; in neutral it's mostly free-rev
    const ratio = state.gear === 0 ? 0 : Gearbox.ratios[state.gear] * Gearbox.finalDrive;
  
    // speed dynamics (very simplified)
    const drive = (ratio > 0) ? (state.throttle * (state.rpm/red)) : 0;
    const drag = 0.22 + 0.10*(state.speed);
    state.speed = clamp(state.speed + (drive - drag)*dt*1.2, 0, 1.8);
  
    // wheel-implied rpm
    const wheelRpm = (ratio > 0) ? (state.speed * 3200 * ratio) : 0;
  
    // throttle target free rpm
    const freeTarget = lerp(idle, red * 0.98, smoothstep(state.throttle));
  
    // blend between wheel rpm and free rev depending on clutch slip and throttle
    const slip = clamp(state.clutchSlip + 0.15*(1-state.throttle), 0.03, 0.25);
    const coupled = (ratio > 0);
    const target = coupled ? lerp(wheelRpm, freeTarget, slip) : freeTarget;
  
    // rpm response (fast up, slower down)
    const upRate = 9.0;
    const downRate = 5.0;
    const rate = target > state.rpm ? upRate : downRate;
  
    state.rpm = lerp(state.rpm, target, 1 - Math.exp(-rate*dt));
    state.rpm = clamp(state.rpm, idle*0.85, red*1.02);
  }
  
  function toggleAudio(){
    if (!audio){
      audio = new EngineAudio();
      audio.setEngine(state.engineKey);
    }
    state.running = !state.running;
    ui.startBtn.textContent = state.running ? "Stop Audio (Space)" : "Start Audio (Space)";
    if (state.running){
      audio.start();
      state.lastT = performance.now();
      requestAnimationFrame(loop);
    } else {
      audio.stop();
    }
  }
  
  function loop(){
    if (!state.running) return;
    const now = performance.now();
    const dt = clamp((now - state.lastT)/1000, 0, 0.05);
    state.lastT = now;
  
    physicsStep(dt);
    updateHUD();
  
    audio.setParams({
      rpm: state.rpm,
      throttle: state.throttle,
      redline: state.redline,
      gear: state.gear,
      useSamples: ui.useSamples.checked
    });
  
    drawScope(audio.analyser);
    requestAnimationFrame(loop);
  }
  
  /* ---------------- Web Audio Engine ---------------- */
  
  class EngineAudio{
    constructor(){
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  
      // main bus
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.9;
  
      // dynamics / tone shaping
      this.hp = this.ctx.createBiquadFilter();
      this.hp.type = "highpass";
      this.hp.frequency.value = 18;
  
      this.lp = this.ctx.createBiquadFilter();
      this.lp.type = "lowpass";
      this.lp.frequency.value = 8500;
  
      this.drive = this.ctx.createWaveShaper();
      this.drive.curve = makeDriveCurve(520);
      this.drive.oversample = "2x";
  
      this.combustion = this.ctx.createGain();
      this.combustion.gain.value = 0.8;
  
      this.air = this.ctx.createGain();
      this.air.gain.value = 0.18;
  
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.0; // ramp in/out
  
      // analyser
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
  
      // connect chain
      this.combustion.connect(this.drive);
      this.air.connect(this.drive);
      this.drive.connect(this.hp);
      this.hp.connect(this.lp);
      this.lp.connect(this.out);
      this.out.connect(this.analyser);
      this.analyser.connect(this.master);
      this.master.connect(this.ctx.destination);
  
      // pulse sources
      this.pulseOsc = this.ctx.createOscillator();
      this.pulseOsc.type = "square";
      this.pulseGain = this.ctx.createGain();
      this.pulseGain.gain.value = 0.0;
  
      this.formant1 = this.ctx.createBiquadFilter();
      this.formant1.type = "bandpass";
      this.formant1.Q.value = 3.8;
  
      this.formant2 = this.ctx.createBiquadFilter();
      this.formant2.type = "bandpass";
      this.formant2.Q.value = 2.6;
  
      this.pulseOsc.connect(this.pulseGain);
      this.pulseGain.connect(this.formant1);
      this.pulseGain.connect(this.formant2);
  
      this.formant1.connect(this.combustion);
      this.formant2.connect(this.combustion);
  
      // noise (air/intake/exhaust hiss)
      this.noise = makeNoise(this.ctx);
      this.noiseFilter = this.ctx.createBiquadFilter();
      this.noiseFilter.type = "highpass";
      this.noiseFilter.frequency.value = 500;
      this.noiseGain = this.ctx.createGain();
      this.noiseGain.gain.value = 0.0;
  
      this.noise.connect(this.noiseFilter);
      this.noiseFilter.connect(this.noiseGain);
      this.noiseGain.connect(this.air);
  
      // sample mode players
      this.sampleBus = this.ctx.createGain();
      this.sampleBus.gain.value = 0.0;
      this.sampleBus.connect(this.drive);
  
      this.sampleNodes = { idle:null, accel:null, high:null };
  
      this.engineKey = "v8";
      this.cylinders = 8;
      this.burble = 0.2;
      this.resonanceHz = 85;
  
      this.pulseOsc.start();
      this.noise.start();
    }
  
    setEngine(key){
      const p = EnginePresets[key];
      this.engineKey = key;
      this.cylinders = p.cylinders;
      this.burble = p.burble;
      this.resonanceHz = p.resonanceHz;
    }
  
    async loadSample(which, file){
      const buf = await file.arrayBuffer();
      const audioBuf = await this.ctx.decodeAudioData(buf);
      return audioBuf;
    }
  
    setSampleBuffer(which, buffer){
      // stop old
      if (this.sampleNodes[which]){
        try { this.sampleNodes[which].stop(); } catch {}
        this.sampleNodes[which].disconnect();
        this.sampleNodes[which] = null;
      }
      if (!buffer) return;
  
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
  
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0;
  
      src.connect(gain);
      gain.connect(this.sampleBus);
  
      src.start();
      this.sampleNodes[which] = { src, gain };
    }
  
    start(){
      if (this.ctx.state === "suspended") this.ctx.resume();
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(1.0, t + 0.08);
    }
  
    stop(){
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0.0, t + 0.08);
    }
  
    setParams({rpm, throttle, redline, gear, useSamples}){
      const t = this.ctx.currentTime;
      const rpmClamped = clamp(rpm, 200, redline*1.2);
  
      // 4-stroke: firing events per second ~ (rpm/60) * (cyl/2)
      const fireHz = (rpmClamped / 60) * (this.cylinders / 2);
  
      // Base pulse oscillator frequency:
      // square wave approximates pulses; we then filter to shape exhaust tone.
      this.pulseOsc.frequency.setTargetAtTime(fireHz, t, 0.015);
  
      // Burble: at low throttle and low rpm, modulate amplitude slightly
      const burbleAmt = this.burble * (1 - throttle) * clamp(1 - (rpmClamped / (redline*0.45)), 0, 1);
  
      // amplitude & tone
      const loud = 0.10 + 0.90 * (0.15 + throttle) * clamp(rpmClamped/redline, 0.2, 1.0);
      const gearLoad = gear === 0 ? 0.85 : 1.0;
  
      // combustion gain
      this.pulseGain.gain.setTargetAtTime(loud * gearLoad, t, 0.02);
  
      // resonance centers move with rpm a bit
      const r = this.resonanceHz;
      const f1 = r + (rpmClamped/redline) * 260;
      const f2 = (r*2.0) + (rpmClamped/redline) * 540;
  
      this.formant1.frequency.setTargetAtTime(f1, t, 0.02);
      this.formant2.frequency.setTargetAtTime(f2, t, 0.02);
  
      // filters
      const lp = 2200 + 7000 * clamp(rpmClamped/redline, 0, 1);
      this.lp.frequency.setTargetAtTime(lp, t, 0.03);
  
      // air noise rises with throttle and rpm
      const air = 0.01 + 0.22 * throttle * clamp(rpmClamped/redline, 0.2, 1);
      this.noiseGain.gain.setTargetAtTime(air, t, 0.03);
  
      // sample crossfade mode
      const haveSamples = !!(state.samples.idle || state.samples.accel || state.samples.high);
      const wantSamples = useSamples && haveSamples;
  
      // Use the sampleBus by raising it and lowering synth buses
      const sampleMix = wantSamples ? 1 : 0;
      this.sampleBus.gain.setTargetAtTime(sampleMix, t, 0.05);
  
      const synthMix = 1 - sampleMix;
      this.combustion.gain.setTargetAtTime(0.8 * synthMix, t, 0.05);
      this.air.gain.setTargetAtTime(0.18 * synthMix, t, 0.05);
  
      if (wantSamples){
        // Crossfade samples by rpm + throttle:
        // idle dominates low rpm and low throttle; accel mid; high at high rpm.
        const rNorm = clamp((rpmClamped - 600) / (redline - 600), 0, 1);
        const accelBias = clamp(throttle * 0.9 + rNorm * 0.4, 0, 1);
  
        const idleW = clamp(1.0 - (rNorm*1.2 + throttle*0.9), 0, 1);
        const highW = clamp((rNorm*1.4) - 0.25, 0, 1);
        let accelW = clamp(1.0 - Math.abs(rNorm - 0.5)*2.0, 0, 1);
        accelW = clamp(accelW * (0.35 + accelBias), 0, 1);
  
        // normalize
        const sum = idleW + accelW + highW + 1e-6;
        const i = idleW/sum, a = accelW/sum, h = highW/sum;
  
        // playback rate follows rpm (makes samples track pitch)
        const rate = lerp(0.7, 1.8, rNorm);
  
        for (const k of ["idle","accel","high"]){
          const node = this.sampleNodes[k];
          if (!node) continue;
          node.src.playbackRate.setTargetAtTime(rate, t, 0.03);
        }
        if (this.sampleNodes.idle)  this.sampleNodes.idle.gain.gain.setTargetAtTime(i, t, 0.05);
        if (this.sampleNodes.accel) this.sampleNodes.accel.gain.gain.setTargetAtTime(a, t, 0.05);
        if (this.sampleNodes.high)  this.sampleNodes.high.gain.gain.setTargetAtTime(h, t, 0.05);
      }
  
      // subtle burble: tiny amplitude wobble
      if (burbleAmt > 0){
        const wobble = 1 + burbleAmt * Math.sin(this.ctx.currentTime * 7.0 * Math.PI * 2);
        this.pulseGain.gain.setTargetAtTime(loud * wobble * synthMix, t, 0.03);
      }
    }
  }
  
  /* Helpers */
  
  function makeDriveCurve(amount){
    const n = 44100;
    const curve = new Float32Array(n);
    for (let i=0;i<n;i++){
      const x = (i*2/n) - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }
  
  function makeNoise(ctx){
    // white noise buffer loop (low CPU)
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++){
      data[i] = (Math.random()*2 - 1) * 0.6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }
  
  /* Sample loading wiring */
  
  async function handleFile(which, fileInput){
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!audio) audio = new EngineAudio();
  
    const buf = await audio.loadSample(which, file);
    state.samples[which] = buf;
    audio.setSampleBuffer(which, buf);
  }
  
  ui.idleFile.addEventListener("change", () => handleFile("idle", ui.idleFile));
  ui.accelFile.addEventListener("change", () => handleFile("accel", ui.accelFile));
  ui.highFile.addEventListener("change", () => handleFile("high", ui.highFile));
  
  /* Scope drawing */
  
  const scopeCtx = ui.scope.getContext("2d");
  function drawScope(analyser){
    if (!analyser) return;
    const w = ui.scope.width, h = ui.scope.height;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
  
    scopeCtx.clearRect(0,0,w,h);
  
    // background grid
    scopeCtx.globalAlpha = 0.35;
    scopeCtx.strokeStyle = "rgba(255,255,255,.10)";
    for(let x=0; x<=w; x+=60){
      scopeCtx.beginPath();
      scopeCtx.moveTo(x,0);
      scopeCtx.lineTo(x,h);
      scopeCtx.stroke();
    }
    for(let y=0; y<=h; y+=40){
      scopeCtx.beginPath();
      scopeCtx.moveTo(0,y);
      scopeCtx.lineTo(w,y);
      scopeCtx.stroke();
    }
    scopeCtx.globalAlpha = 1;
  
    // waveform
    scopeCtx.strokeStyle = "rgba(100,214,255,.9)";
    scopeCtx.lineWidth = 2;
    scopeCtx.beginPath();
  
    for (let i=0;i<data.length;i++){
      const x = (i/(data.length-1))*w;
      const v = data[i]/255;
      const y = (h/2) + (v-0.5)*h*0.85;
      if (i===0) scopeCtx.moveTo(x,y);
      else scopeCtx.lineTo(x,y);
    }
    scopeCtx.stroke();
  }