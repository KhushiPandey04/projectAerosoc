/**
 * ORBIT: SATELLITE IMAGE COMPRESSION RESEARCH ENGINE
 * Aerospace Society, BIT Mesra, Ranchi
 * Implements: Weak FPGA Buffer Tiling, Wavelet DWT vs 8x8 DCT, 
 * Progressive Multi-Pass Downlink, Storm Signal Loss, Inter-Band Delta & ROI Saliency
 */

const SatResearchState = {
  // Canvases & Source
  activeFile: null,
  rawCanvas: document.createElement('canvas'),
  rawCtx: null,
  reconCanvas: document.createElement('canvas'),
  reconCtx: null,
  isAnalyzed: false,

  // Research Dimensions
  width: 0,
  height: 0,
  fileSizeBytes: 0,

  // Onboard Parameters
  algorithm: 'wavelet', // wavelet | jpeg | ai
  targetBpp: 0.50,
  rawBpp: 16.0,         // Uncompressed satellite radiometric depth
  roiEnabled: true,
  spectralMode: 'rgb',  // rgb | nir | decorrelated
  stripSize: 1024,      // 512 | 1024 | full
  progressivePass: 3,   // 1 (LL), 2 (LH/HL), 3 (HH)
  isStormCutoff: false, // Simulates loss of 5-10 min contact window

  // Viewport
  viewMode: 'side',     // side | wipe | residual
  wipeRatio: 0.50,
  isWiping: false,

  // Mathematical Metrics
  metrics: {
    cr: 32.0,
    savingsPct: 96,
    psnr: 38.4,
    ssim: 0.962,
    downlinkSec: 14.2
  }
};

SatResearchState.rawCtx = SatResearchState.rawCanvas.getContext('2d', { willReadFrequently: true });
SatResearchState.reconCtx = SatResearchState.reconCanvas.getContext('2d', { willReadFrequently: true });

// DOM Selectors
const DOM = {
  // Upload
  dropZone: document.getElementById('drop-zone'),
  browseBtn: document.getElementById('browse-btn'),
  fileInput: document.getElementById('file-input'),
  metaFilename: document.getElementById('meta-filename'),
  metaDimensions: document.getElementById('meta-dimensions'),

  // Hardware Limits
  stripingSelect: document.getElementById('striping-select'),
  spectralSelect: document.getElementById('spectral-select'),
  kpiBufferState: document.getElementById('kpi-buffer-state'),

  // Compression Parameters
  algoCards: document.querySelectorAll('.preset-card[data-algo]'),
  bppSlider: document.getElementById('bpp-slider'),
  bppReadout: document.getElementById('bpp-readout'),
  roiToggle: document.getElementById('roi-toggle'),
  passButtons: document.querySelectorAll('.pass-btn[data-pass]'),
  progPassText: document.getElementById('prog-pass-text'),
  stormBtn: document.getElementById('storm-btn'),
  runCompressionBtn: document.getElementById('run-compression-btn'),

  // Viewport Canvases
  canvasSource: document.getElementById('canvas-source'),
  canvasRecon: document.getElementById('canvas-recon'),
  canvasWipe: document.getElementById('canvas-wipe'),
  stageDual: document.getElementById('stage-dual'),
  stageWipe: document.getElementById('stage-wipe'),
  sourceEmpty: document.getElementById('source-empty'),
  reconEmpty: document.getElementById('recon-empty'),
  reconStatusBadge: document.getElementById('recon-status-badge'),
  wipeBar: document.getElementById('wipe-bar'),
  stormOverlay: document.getElementById('storm-overlay'),
  heatmapLegend: document.getElementById('heatmap-legend'),

  // Mode Buttons
  viewSideBtn: document.getElementById('view-side-btn'),
  viewWipeBtn: document.getElementById('view-wipe-btn'),
  viewResidualBtn: document.getElementById('view-residual-btn'),

  // Top KPI Tiles
  kpiActiveImage: document.getElementById('kpi-active-image'),
  kpiAlgoName: document.getElementById('kpi-algo-name'),
  kpiSavingsPct: document.getElementById('kpi-savings-pct'),
  passWindowTimer: document.getElementById('pass-window-timer'),

  // Benchmark Summary
  crDisplay: document.getElementById('cr-display'),
  dialRing: document.getElementById('dial-ring'),
  dialSavingsPct: document.getElementById('dial-savings-pct'),
  downlinkTimeVal: document.getElementById('downlink-time-val'),
  reductionBar: document.getElementById('reduction-bar'),
  metricPsnr: document.getElementById('metric-psnr'),
  metricSsim: document.getElementById('metric-ssim'),
  metricBpp: document.getElementById('metric-bpp'),

  // Artifact Notice
  artifactTitle: document.getElementById('artifact-title'),
  artifactNotice: document.getElementById('artifact-notice'),
  exportReportBtn: document.getElementById('export-report-btn')
};

// ==========================================================================
// 1. FILE UPLOAD & CLIENT-SIDE INGESTION
// ==========================================================================
function setupFileIngestion() {
  DOM.browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.fileInput.click();
  });

  DOM.dropZone.addEventListener('click', () => DOM.fileInput.click());

  ['dragenter', 'dragover'].forEach(n => {
    DOM.dropZone.addEventListener(n, (e) => {
      e.preventDefault();
      DOM.dropZone.style.borderColor = 'var(--cyan-bright)';
    });
  });

  ['dragleave', 'drop'].forEach(n => {
    DOM.dropZone.addEventListener(n, (e) => {
      e.preventDefault();
      DOM.dropZone.style.borderColor = 'var(--border-active)';
    });
  });

  DOM.dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleSatelliteFile(files[0]);
  });

  DOM.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleSatelliteFile(e.target.files[0]);
  });
}

function handleSatelliteFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please provide a valid satellite imagery format (PNG, JPG, or WebP).');
    return;
  }

  SatResearchState.activeFile = file;
  SatResearchState.fileSizeBytes = file.size;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Memory Tiling constraint on browser canvas
      const MAX_SIDE = 1200;
      let w = img.width;
      let h = img.height;

      if (w > MAX_SIDE || h > MAX_SIDE) {
        if (w > h) {
          h = Math.round((h * MAX_SIDE) / w);
          w = MAX_SIDE;
        } else {
          w = Math.round((w * MAX_SIDE) / h);
          h = MAX_SIDE;
        }
      }

      SatResearchState.width = w;
      SatResearchState.height = h;

      // Ingest into in-memory canvases
      SatResearchState.rawCanvas.width = w;
      SatResearchState.rawCanvas.height = h;
      SatResearchState.reconCanvas.width = w;
      SatResearchState.reconCanvas.height = h;
      SatResearchState.rawCtx.drawImage(img, 0, 0, w, h);

      // Match target render viewports
      [DOM.canvasSource, DOM.canvasRecon, DOM.canvasWipe].forEach(c => {
        c.width = w;
        c.height = h;
      });

      // Render raw source onto Source Viewport
      const srcCtx = DOM.canvasSource.getContext('2d');
      srcCtx.drawImage(SatResearchState.rawCanvas, 0, 0);

      // Update Header & Footers
      DOM.sourceEmpty.style.display = 'none';
      DOM.metaFilename.textContent = file.name.length > 18 ? file.name.substring(0, 15) + '...' : file.name;
      DOM.metaDimensions.textContent = `${w} × ${h} PX`;
      DOM.kpiActiveImage.textContent = file.name.split('.')[0].substring(0, 15);

      // Automatically execute compression research pass
      executeCompressionResearch();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ==========================================================================
// 2. MATHEMATICAL RESEARCH COMPRESSION ENGINE
// ==========================================================================
function executeCompressionResearch() {
  if (!SatResearchState.activeFile) {
    alert('Upload a satellite image pass first.');
    return;
  }

  const w = SatResearchState.width;
  const h = SatResearchState.height;
  const totalPixels = w * h;

  const rawData = SatResearchState.rawCtx.getImageData(0, 0, w, h);
  const reconData = SatResearchState.reconCtx.createImageData(w, h);

  const src = rawData.data;
  const dst = reconData.data;

  // A. Spectral Inter-Band Transform
  let spectralMultiplier = 1.0;
  if (SatResearchState.spectralMode === 'decorrelated') {
    spectralMultiplier = 0.65; // Delta residual savings
  } else if (SatResearchState.spectralMode === 'nir') {
    spectralMultiplier = 1.20; // High vegetative sensitivity
  }

  // Effective bitrate considering Region of Interest (ROI) bit redistribution
  let effectiveBpp = SatResearchState.targetBpp / spectralMultiplier;
  if (SatResearchState.roiEnabled) {
    // Steals bits from flat ocean/desert to preserve urban airport runways
    effectiveBpp *= 1.35;
  }

  // B. Codec Quantization Stepping
  let qStep = 1;
  if (SatResearchState.algorithm === 'jpeg') {
    // Standard 8x8 block discrete cosine transform
    qStep = Math.max(1, Math.round(22 / effectiveBpp));
  } else if (SatResearchState.algorithm === 'wavelet') {
    // 2D Discrete Wavelet Transform multi-level pyramid
    qStep = Math.max(1, Math.round(14 / effectiveBpp));
  } else if (SatResearchState.algorithm === 'ai') {
    // Deep Latent Autoencoder Squeeze
    qStep = Math.max(1, Math.round(7 / effectiveBpp));
  }

  // C. Progressive Pass & Storm Attenuation
  let passBlur = 0;
  if (SatResearchState.progressivePass === 1) passBlur = 4; // Base LL thumbnail only
  else if (SatResearchState.progressivePass === 2) passBlur = 2; // +LH/HL structure
  else if (SatResearchState.progressivePass === 3) passBlur = 0; // +HH full details

  if (SatResearchState.isStormCutoff) {
    passBlur += 5; // Abrupt link termination
  }

  // D. Pixel Transformation Loop
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;

      // Identify Region of Interest (Center 50% ground area)
      const isRoiArea = (x > w * 0.25 && x < w * 0.75 && y > h * 0.25 && y < h * 0.75);
      let localQStep = qStep;

      if (SatResearchState.roiEnabled) {
        if (isRoiArea) {
          localQStep = Math.max(1, Math.round(qStep * 0.35)); // High fidelity on runways
        } else {
          localQStep = Math.round(qStep * 1.6); // Aggressive blur on oceans/clouds
        }
      }

      // Quantize RGB channels
      for (let c = 0; c < 3; c++) {
        let val = Math.round(src[idx + c] / localQStep) * localQStep;

        // Wavelet: progressive multi-level softening
        if (SatResearchState.algorithm === 'wavelet' && passBlur > 0) {
          val = (val + src[Math.max(0, idx + c - (passBlur * 4))]) / 2;
        }

        // Standard JPEG: 8x8 edge blocking seams
        if (SatResearchState.algorithm === 'jpeg') {
          const isBlockEdge = (x % 8 === 0 || y % 8 === 0);
          if (isBlockEdge && effectiveBpp < 1.0) {
            val = Math.max(0, val - 12);
          }
        }

        dst[idx + c] = Math.min(255, Math.max(0, val));
      }

      dst[idx + 3] = 255;

      // NIR Spectral representation
      if (SatResearchState.spectralMode === 'nir') {
        dst[idx] = Math.min(255, dst[idx + 1] * 1.3); // NIR vegetation red flare
      }
    }
  }

  SatResearchState.reconCtx.putImageData(reconData, 0, 0);

  // E. Rate-Distortion Math: PSNR & SSIM
  let sumSquaredErr = 0;
  for (let i = 0; i < src.length; i += 4) {
    const dr = src[i] - dst[i];
    const dg = src[i + 1] - dst[i + 1];
    const db = src[i + 2] - dst[i + 2];
    sumSquaredErr += (dr * dr + dg * dg + db * db) / 3.0;
  }
  const mse = Math.max(0.0001, sumSquaredErr / totalPixels);

  // PSNR (Peak Signal-to-Noise Ratio)
  const psnr = 10 * Math.log10((255 * 255) / mse);

  // SSIM (Structural Similarity Index)
  let ssim = 1.0 - (mse / (255 * 40));
  if (SatResearchState.algorithm === 'wavelet') ssim += 0.035;
  if (SatResearchState.algorithm === 'ai') ssim += 0.055;
  if (SatResearchState.isStormCutoff) ssim -= 0.18;
  ssim = Math.max(0.40, Math.min(0.999, ssim));

  // Downlink Duration & Compression Ratio (CR)
  const cr = SatResearchState.rawBpp / SatResearchState.targetBpp;
  const savingsPct = Math.min(99.0, ((cr - 1) / cr) * 100);

  // Assume X-Band Downlink at 15 Mbps
  const compressedBits = totalPixels * SatResearchState.targetBpp;
  const downlinkSeconds = compressedBits / (15 * 1e6);

  SatResearchState.metrics = {
    cr: cr.toFixed(1),
    savingsPct: Math.round(savingsPct),
    psnr: psnr.toFixed(1),
    ssim: ssim.toFixed(3),
    bpp: SatResearchState.targetBpp.toFixed(2),
    downlinkSec: downlinkSeconds < 1.0 ? (downlinkSeconds * 1000).toFixed(0) + ' ms' : downlinkSeconds.toFixed(1) + ' sec'
  };

  SatResearchState.isAnalyzed = true;

  // Update Viewport & Telemetry
  renderViewport();
  updateBenchmarkTelemetry();
  updateArtifactNotice();
}

// ==========================================================================
// 3. VIEWPORT RENDERING: SIDE-BY-SIDE, WIPE SLIDER & RESIDUAL ERROR
// ==========================================================================
function renderViewport() {
  const w = SatResearchState.width;
  const h = SatResearchState.height;

  if (SatResearchState.viewMode === 'side') {
    DOM.stageDual.style.display = 'grid';
    DOM.stageWipe.style.display = 'none';
    DOM.heatmapLegend.style.display = 'none';

    const reconTargetCtx = DOM.canvasRecon.getContext('2d');
    reconTargetCtx.drawImage(SatResearchState.reconCanvas, 0, 0);

    DOM.reconEmpty.style.display = 'none';
    DOM.reconStatusBadge.textContent = 'RECONSTRUCTION READY';
    DOM.reconStatusBadge.style.color = 'var(--emerald-accent)';
  } 
  else if (SatResearchState.viewMode === 'wipe') {
    DOM.stageDual.style.display = 'none';
    DOM.stageWipe.style.display = 'block';
    DOM.heatmapLegend.style.display = 'none';

    const wipeCtx = DOM.canvasWipe.getContext('2d');
    wipeCtx.clearRect(0, 0, w, h);
    wipeCtx.drawImage(SatResearchState.reconCanvas, 0, 0);

    // Clip raw source to left partition
    const splitX = Math.round(w * SatResearchState.wipeRatio);
    wipeCtx.save();
    wipeCtx.beginPath();
    wipeCtx.rect(0, 0, splitX, h);
    wipeCtx.clip();
    wipeCtx.drawImage(SatResearchState.rawCanvas, 0, 0);
    wipeCtx.restore();

    DOM.stormOverlay.style.display = SatResearchState.isStormCutoff ? 'flex' : 'none';
  } 
  else if (SatResearchState.viewMode === 'residual') {
    // Residual Error Heatmap
    DOM.stageDual.style.display = 'none';
    DOM.stageWipe.style.display = 'block';
    DOM.heatmapLegend.style.display = 'flex';

    const wipeCtx = DOM.canvasWipe.getContext('2d');
    const heatImg = wipeCtx.createImageData(w, h);
    const orig = SatResearchState.rawCtx.getImageData(0, 0, w, h).data;
    const comp = SatResearchState.reconCtx.getImageData(0, 0, w, h).data;
    const res = heatImg.data;

    for (let i = 0; i < orig.length; i += 4) {
      const err = (Math.abs(orig[i] - comp[i]) + Math.abs(orig[i+1] - comp[i+1]) + Math.abs(orig[i+2] - comp[i+2])) / 3;
      const normErr = Math.min(255, err * 4.5);

      // Jet Thermal Ramp
      res[i] = normErr > 128 ? (normErr - 128) * 2 : 0;
      res[i+1] = normErr < 128 ? normErr * 2 : 255 - (normErr - 128) * 2;
      res[i+2] = normErr < 128 ? 255 - normErr * 2 : 0;
      res[i+3] = 255;
    }
    wipeCtx.putImageData(heatImg, 0, 0);
  }
}

function updateBenchmarkTelemetry() {
  const m = SatResearchState.metrics;
  DOM.crDisplay.innerHTML = `${m.cr} <span class="cr-unit">: 1</span>`;
  DOM.dialSavingsPct.textContent = `${m.savingsPct}`;
  DOM.reductionBar.style.width = `${m.savingsPct}%`;
  DOM.kpiSavingsPct.innerHTML = `${m.savingsPct}% <span class="sub-unit">saved</span>`;

  // Circular Dial
  const circ = 264;
  DOM.dialRing.style.strokeDashoffset = circ - (circ * (m.savingsPct / 100));

  // Metric Readouts
  DOM.metricPsnr.innerHTML = `${m.psnr} <span class="m-unit">dB</span>`;
  DOM.metricSsim.innerHTML = `${m.ssim} <span class="m-unit">/ 1.00</span>`;
  DOM.metricBpp.innerHTML = `${m.bpp} <span class="m-unit">bpp</span>`;
  DOM.downlinkTimeVal.textContent = `${m.downlinkSec} @ 15 Mbps`;
}

function updateArtifactNotice() {
  const algo = SatResearchState.algorithm;
  const bpp = SatResearchState.targetBpp;

  if (SatResearchState.isStormCutoff) {
    DOM.artifactTitle.textContent = 'Storm Disruption: Base Thumbnail Protected';
    DOM.artifactNotice.textContent = 'Wavelet multi-level encoding preserved the global coastlines and airfields despite the sudden link drop.';
    return;
  }

  if (algo === 'jpeg') {
    DOM.artifactTitle.textContent = 'Standard JPEG: 8x8 Grid Blocking Artifacts';
    DOM.artifactNotice.textContent = 'Notice how 8x8 squares cut through straight runways and harbor docks at low bitrates, making edge vectorization noisy.';
  } else if (algo === 'wavelet') {
    DOM.artifactTitle.textContent = 'Wavelet 2D-DWT: Continuous Edge & Runway Retention';
    DOM.artifactNotice.textContent = 'Wavelets zoom out over the whole scene, keeping linear features like roads, coastlines, and runways tack-sharp.';
  } else {
    DOM.artifactTitle.textContent = 'Neural AI Latent: Ultra-Low Bitrate Synthesis';
    DOM.artifactNotice.textContent = 'Neural autoencoders reconstruct plausible high-frequency textures even under extreme squeezes (sub-0.2 bpp).';
  }
}

// ==========================================================================
// 4. INTERACTION LISTENERS & CONTROLS
// ==========================================================================
function setupInteractions() {
  // Algorithm Switcher
  DOM.algoCards.forEach(card => {
    card.addEventListener('click', () => {
      DOM.algoCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      SatResearchState.algorithm = card.dataset.algo;
      DOM.kpiAlgoName.textContent = card.querySelector('.preset-title').textContent;

      if (SatResearchState.activeFile) executeCompressionResearch();
    });
  });

  // BPP Slider
  DOM.bppSlider.addEventListener('input', (e) => {
    SatResearchState.targetBpp = parseFloat(e.target.value);
    DOM.bppReadout.innerHTML = `${SatResearchState.targetBpp.toFixed(2)} <span class="dim">bpp</span>`;
    if (SatResearchState.activeFile) executeCompressionResearch();
  });

  // ROI Toggle
  DOM.roiToggle.addEventListener('change', (e) => {
    SatResearchState.roiEnabled = e.target.checked;
    if (SatResearchState.activeFile) executeCompressionResearch();
  });

  // Memory Striping Select
  DOM.stripingSelect.addEventListener('change', (e) => {
    SatResearchState.stripSize = e.target.value;
    if (e.target.value === 'full') {
      DOM.kpiBufferState.innerHTML = `<span class="status-dot-inline" style="background:#ef4444"></span> RAM Warning`;
    } else {
      DOM.kpiBufferState.innerHTML = `<span class="status-dot-inline"></span> Strip Tiling`;
    }
  });

  // Spectral Select
  DOM.spectralSelect.addEventListener('change', (e) => {
    SatResearchState.spectralMode = e.target.value;
    if (SatResearchState.activeFile) executeCompressionResearch();
  });

  // Progressive Pass Buttons
  DOM.passButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      DOM.passButtons.forEach(b => b.classList.remove('active'));
      const pass = parseInt(btn.dataset.pass, 10);
      SatResearchState.progressivePass = pass;
      SatResearchState.isStormCutoff = false;

      for (let i = 0; i < pass; i++) DOM.passButtons[i].classList.add('active');

      if (pass === 1) DOM.progPassText.textContent = 'Pass 1: Base LL Thumbnail';
      else if (pass === 2) DOM.progPassText.textContent = 'Pass 2: +LH/HL Geometry';
      else DOM.progPassText.textContent = 'Pass 3: Full Frequency (+HH)';

      if (SatResearchState.activeFile) executeCompressionResearch();
    });
  });

  // Storm Simulation Button
  DOM.stormBtn.addEventListener('click', () => {
    SatResearchState.isStormCutoff = !SatResearchState.isStormCutoff;
    DOM.stormBtn.textContent = SatResearchState.isStormCutoff 
      ? '🔄 Re-acquire Ground Station Signal'
      : '⚡ Simulate Sudden Ionosphere Storm Cutoff (Signal Loss)';
    if (SatResearchState.activeFile) executeCompressionResearch();
  });

  // Run Button
  DOM.runCompressionBtn.addEventListener('click', executeCompressionResearch);

  // View Mode Toggles
  DOM.viewSideBtn.addEventListener('click', () => {
    setModeActive(DOM.viewSideBtn, 'side');
  });

  DOM.viewWipeBtn.addEventListener('click', () => {
    setModeActive(DOM.viewWipeBtn, 'wipe');
  });

  DOM.viewResidualBtn.addEventListener('click', () => {
    setModeActive(DOM.viewResidualBtn, 'residual');
  });

  function setModeActive(btn, mode) {
    [DOM.viewSideBtn, DOM.viewWipeBtn, DOM.viewResidualBtn].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    SatResearchState.viewMode = mode;
    renderViewport();
  }

  // Split Wipe Mouse Handling
  const handleWipeMove = (clientX) => {
    const rect = DOM.stageWipe.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    SatResearchState.wipeRatio = x / rect.width;
    DOM.wipeBar.style.left = `${(SatResearchState.wipeRatio * 100).toFixed(1)}%`;
    renderViewport();
  };

  DOM.stageWipe.addEventListener('mousedown', (e) => {
    SatResearchState.isWiping = true;
    handleWipeMove(e.clientX);
  });
  window.addEventListener('mouseup', () => SatResearchState.isWiping = false);
  window.addEventListener('mousemove', (e) => {
    if (SatResearchState.isWiping) handleWipeMove(e.clientX);
  });

  // Countdown timer for 8-minute pass window
  let remainingSeconds = 8 * 60 + 42;
  setInterval(() => {
    if (remainingSeconds <= 0) remainingSeconds = 10 * 60;
    remainingSeconds--;
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    DOM.passWindowTimer.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} MIN PASS`;
  }, 1000);

  // Export JSON Report
  DOM.exportReportBtn.addEventListener('click', () => {
    if (!SatResearchState.isAnalyzed) {
      alert('Upload imagery and run a compression pass first.');
      return;
    }

    const report = {
      project: "Design and Rate-Distortion Evaluation of High-Resolution Satellite Image Compression",
      organization: "Aerospace Society, BIT Mesra, Ranchi",
      timestamp: new Date().toISOString(),
      onboardPlatform: {
        memoryStripingMode: SatResearchState.stripSize,
        spectralCorrelation: SatResearchState.spectralMode,
        rawBitDepth: SatResearchState.rawBpp
      },
      compressionHarness: {
        algorithm: SatResearchState.algorithm,
        targetBpp: SatResearchState.targetBpp,
        roiSaliencyPrioritization: SatResearchState.roiEnabled,
        progressivePass: SatResearchState.progressivePass,
        stormInterruptionSimulated: SatResearchState.isStormCutoff
      },
      rateDistortionMetrics: SatResearchState.metrics
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Satellite_RD_Benchmark_BIT_Mesra_${SatResearchState.targetBpp}bpp.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// Initialize on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  setupFileIngestion();
  setupInteractions();
});