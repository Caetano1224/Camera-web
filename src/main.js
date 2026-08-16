/* main.js — Obscura, estúdio de fotos e vídeos no navegador */

const DB_NAME = 'obscura-db';
const DB_VERSION = 1;
const STORE_NAME = 'gallery';
const LEGACY_GALLERY_KEY = 'obscura:gallery';
const MAX_GALLERY_ITEMS = 30;

// DOM references
const video = document.getElementById('video-preview');
const canvas = document.getElementById('capture-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const viewfinderFrame = document.querySelector('.viewfinder-frame');
const cameraError = document.getElementById('camera-error');
const fileInput = document.getElementById('file-input');
const shutterFlash = document.getElementById('shutter-flash');
const expCountEl = document.getElementById('exp-count');
const recIndicator = document.getElementById('rec-indicator');
const recTimeEl = document.getElementById('rec-time');

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const announcer = document.getElementById('announcer');

const captureButton = document.getElementById('capture-button');
const flipButton = document.getElementById('flip-button');
const editControls = document.getElementById('edit-controls');

const modePhotoBtn = document.getElementById('mode-photo');
const modeVideoBtn = document.getElementById('mode-video');

const brightnessInput = document.getElementById('brightness');
const saturationInput = document.getElementById('saturation');
const grayscaleInput = document.getElementById('grayscale');
const bgColorInput = document.getElementById('bg-color');
const brightnessValue = document.getElementById('brightness-value');
const saturationValue = document.getElementById('saturation-value');
const grayscaleValue = document.getElementById('grayscale-value');

const resetBtn = document.getElementById('reset');
const retakeBtn = document.getElementById('retake');
const saveButton = document.getElementById('save-button');
const exportBtn = document.getElementById('export-btn');

const filterRow = document.getElementById('filter-row');
const stickerPicker = document.getElementById('sticker-picker');
const stickerLayer = document.getElementById('sticker-layer');

const galleryList = document.getElementById('gallery-list');
const galleryCount = document.getElementById('gallery-count');
const galleryEmpty = document.getElementById('gallery-empty');
const clearGalleryBtn = document.getElementById('clear-gallery');

// State
let mediaStream = null;
let facingMode = 'environment';
let originalImageData = null;
let frameCount = 0;
let currentTint = null;
let activeFilterId = 'original';
let stickers = [];
let stickerSeq = 0;

let captureMode = 'photo'; // 'photo' | 'video'
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingStartedAt = 0;
let recordingTimerId = null;

let galleryObjectURLs = [];

const STICKER_FONT_RATIO = 0.1; // matches the 10cqi used in CSS
const STICKER_EMOJIS = ['😎', '✨', '🔥', '❤️', '⭐', '🎉', '🌈', '📸', '💯', '🥳'];

const FILTERS = [
  { id: 'original', label: 'Original', brightness: 0, saturation: 0, grayscale: 0, tint: null },
  { id: 'vivido', label: 'Vívido', brightness: 6, saturation: 35, grayscale: 0, tint: null },
  { id: 'vintage', label: 'Vintage', brightness: -6, saturation: -25, grayscale: 10, tint: { r: 170, g: 130, b: 80, amount: 0.16 } },
  { id: 'sepia', label: 'Sépia', brightness: -2, saturation: -40, grayscale: 55, tint: { r: 150, g: 110, b: 70, amount: 0.3 } },
  { id: 'frio', label: 'Frio', brightness: 2, saturation: -8, grayscale: 0, tint: { r: 110, g: 150, b: 200, amount: 0.14 } },
  { id: 'pb', label: 'P&B', brightness: 0, saturation: 0, grayscale: 100, tint: null },
];

/* ---------- Status helpers ---------- */
function setStatus(state, label) {
  statusDot.classList.remove('is-ready', 'is-editing', 'is-error', 'is-recording');
  if (state) statusDot.classList.add(state);
  statusText.textContent = label;
}

function announce(message) {
  announcer.textContent = message;
}

/* ---------- Camera ---------- */
async function startCamera(mode) {
  cameraError.classList.add('hidden');
  setStatus(null, 'carregando');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraError();
    return;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }

  // Try with audio first so recorded videos have sound; fall back to video-only
  // if the mic is unavailable or permission is denied.
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode },
      audio: true,
    });
  } catch (err) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false,
      });
    } catch (err2) {
      console.error('Camera access denied:', err2);
      showCameraError();
      return;
    }
  }

  video.srcObject = mediaStream;
  setStatus('is-ready', 'pronto');
}

function showCameraError() {
  setStatus('is-error', 'sem acesso');
  cameraError.classList.remove('hidden');
}

flipButton.addEventListener('click', () => {
  if (isRecording) return;
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera(facingMode);
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  loadImageFile(file);
  fileInput.value = '';
});

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      onFrameCaptured();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ---------- Mode toggle (foto / vídeo) ---------- */
function setCaptureMode(mode) {
  if (isRecording) return; // don't allow switching mid-recording
  captureMode = mode;

  const isVideo = mode === 'video';
  modePhotoBtn.classList.toggle('is-active', !isVideo);
  modePhotoBtn.setAttribute('aria-pressed', String(!isVideo));
  modeVideoBtn.classList.toggle('is-active', isVideo);
  modeVideoBtn.setAttribute('aria-pressed', String(isVideo));

  captureButton.classList.toggle('mode-video', isVideo);
  captureButton.setAttribute('aria-label', isVideo ? 'Gravar vídeo' : 'Tirar foto');
  captureButton.setAttribute('title', isVideo ? 'Gravar vídeo' : 'Tirar foto');
}

modePhotoBtn.addEventListener('click', () => setCaptureMode('photo'));
modeVideoBtn.addEventListener('click', () => setCaptureMode('video'));

function setModeToggleDisabled(disabled) {
  modePhotoBtn.disabled = disabled;
  modeVideoBtn.disabled = disabled;
}

/* ---------- Capture ---------- */
captureButton.addEventListener('click', () => {
  if (captureMode === 'video') {
    toggleRecording();
  } else {
    capturePhoto();
  }
});

function capturePhoto() {
  if (!video.videoWidth) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  captureButton.classList.add('is-firing');
  shutterFlash.classList.add('is-active');
  window.setTimeout(() => captureButton.classList.remove('is-firing'), 320);
  window.setTimeout(() => shutterFlash.classList.remove('is-active'), 260);

  onFrameCaptured();
}

function onFrameCaptured() {
  originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  frameCount += 1;
  expCountEl.textContent = String(frameCount).padStart(2, '0');

  video.classList.add('hidden');
  canvas.classList.remove('hidden');
  editControls.classList.remove('hidden');
  stickerLayer.classList.remove('hidden');
  setStatus('is-editing', 'editando');
  announce('Foto capturada. Ajuste os controles ou salve na galeria.');

  setModeToggleDisabled(true);

  stickers = [];
  renderStickers();
  resetSlidersOnly();
  setActiveFilter('original', { skipApply: true });
  applyEffects();
}

/* ---------- Video recording ---------- */
const RECORDER_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  if (!mediaStream || typeof MediaRecorder === 'undefined') {
    announce('Gravação de vídeo não é suportada neste navegador.');
    return;
  }

  const mimeType = pickRecorderMimeType();
  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);
  } catch (err) {
    console.error('Failed to start MediaRecorder:', err);
    announce('Não foi possível iniciar a gravação.');
    return;
  }

  recordedChunks = [];
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.addEventListener('stop', handleRecordingStop);

  mediaRecorder.start();
  isRecording = true;
  recordingStartedAt = Date.now();

  captureButton.classList.add('is-recording');
  viewfinderFrame.classList.add('is-recording');
  recIndicator.classList.remove('hidden');
  flipButton.disabled = true;
  setModeToggleDisabled(true);
  setStatus('is-recording', 'gravando');
  announce('Gravação iniciada.');

  updateRecordingTime();
  recordingTimerId = window.setInterval(updateRecordingTime, 250);
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();
}

function updateRecordingTime() {
  const elapsed = Math.floor((Date.now() - recordingStartedAt) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  recTimeEl.textContent = `${mm}:${ss}`;
}

async function handleRecordingStop() {
  window.clearInterval(recordingTimerId);
  recordingTimerId = null;
  isRecording = false;

  const mimeType = (mediaRecorder && mediaRecorder.mimeType) || 'video/webm';
  const blob = recordedChunks.length ? new Blob(recordedChunks, { type: mimeType }) : null;
  recordedChunks = [];
  mediaRecorder = null;

  captureButton.classList.remove('is-recording');
  viewfinderFrame.classList.remove('is-recording');
  recIndicator.classList.add('hidden');
  recTimeEl.textContent = '00:00';
  flipButton.disabled = false;
  setModeToggleDisabled(false);
  setStatus('is-ready', 'pronto');

  if (blob && blob.size > 0) {
    shutterFlash.classList.add('is-active');
    window.setTimeout(() => shutterFlash.classList.remove('is-active'), 260);
    try {
      await dbAddItem({ type: 'video', blob, mimeType, createdAt: Date.now() });
      await renderGallery();
      announce('Vídeo salvo na galeria.');
    } catch (err) {
      console.error('Failed to save video:', err);
      announce('Não foi possível salvar o vídeo.');
    }
  } else {
    announce('Gravação cancelada.');
  }
}

/* ---------- Effects (always derived from the original capture) ---------- */
function applyEffects() {
  if (!originalImageData) return;

  const brightness = parseInt(brightnessInput.value, 10);
  const saturation = parseInt(saturationInput.value, 10);
  const grayscale = parseInt(grayscaleInput.value, 10);

  brightnessValue.textContent = (brightness > 0 ? '+' : '') + brightness;
  saturationValue.textContent = (saturation > 0 ? '+' : '') + saturation;
  grayscaleValue.textContent = grayscale;

  const data = new Uint8ClampedArray(originalImageData.data);
  const satFactor = 1 + saturation / 100; // 0 → tons de cinza, 1 → original, 2 → saturado

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + brightness;
    let g = data[i + 1] + brightness;
    let b = data[i + 2] + brightness;

    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * satFactor;
    g = gray + (g - gray) * satFactor;
    b = gray + (b - gray) * satFactor;

    if (grayscale > 0) {
      const amount = grayscale / 100;
      const mono = 0.299 * r + 0.587 * g + 0.114 * b;
      r = r + (mono - r) * amount;
      g = g + (mono - g) * amount;
      b = b + (mono - b) * amount;
    }

    if (currentTint) {
      r = r + (currentTint.r - r) * currentTint.amount;
      g = g + (currentTint.g - g) * currentTint.amount;
      b = b + (currentTint.b - b) * currentTint.amount;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  ctx.putImageData(new ImageData(data, originalImageData.width, originalImageData.height), 0, 0);
}

[brightnessInput, saturationInput, grayscaleInput].forEach((input) => {
  input.addEventListener('input', () => {
    setActiveFilter(null, { skipApply: true });
    applyEffects();
  });
});

bgColorInput.addEventListener('input', () => {
  document.documentElement.style.setProperty('--mat-color', bgColorInput.value);
});

function resetSlidersOnly() {
  brightnessInput.value = 0;
  saturationInput.value = 0;
  grayscaleInput.value = 0;
  brightnessValue.textContent = '0';
  saturationValue.textContent = '0';
  grayscaleValue.textContent = '0';
}

resetBtn.addEventListener('click', () => {
  resetSlidersOnly();
  bgColorInput.value = '#f4efe3';
  document.documentElement.style.setProperty('--mat-color', '#f4efe3');
  setActiveFilter('original', { skipApply: true });
  applyEffects();
});

retakeBtn.addEventListener('click', exitEditMode);

function exitEditMode() {
  originalImageData = null;
  stickers = [];
  renderStickers();
  video.classList.remove('hidden');
  canvas.classList.add('hidden');
  stickerLayer.classList.add('hidden');
  editControls.classList.add('hidden');
  setModeToggleDisabled(false);
  setStatus('is-ready', 'pronto');
  announce('Voltando para o visor da câmera.');
}

/* ---------- Filter presets ---------- */
function renderFilterChips() {
  FILTERS.forEach((filter) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip';
    chip.textContent = filter.label;
    chip.dataset.filterId = filter.id;
    chip.setAttribute('aria-pressed', filter.id === activeFilterId ? 'true' : 'false');
    chip.addEventListener('click', () => setActiveFilter(filter.id));
    filterRow.appendChild(chip);
  });
}

function setActiveFilter(filterId, { skipApply = false } = {}) {
  activeFilterId = filterId;
  Array.from(filterRow.children).forEach((chip) => {
    const isActive = chip.dataset.filterId === filterId;
    chip.classList.toggle('is-active', isActive);
    chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const filter = FILTERS.find((f) => f.id === filterId);
  if (filter) {
    brightnessInput.value = filter.brightness;
    saturationInput.value = filter.saturation;
    grayscaleInput.value = filter.grayscale;
    currentTint = filter.tint;
  }
  if (!skipApply) applyEffects();
}

/* ---------- Stickers ---------- */
function renderStickerPicker() {
  STICKER_EMOJIS.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.setAttribute('aria-label', `Adicionar figurinha ${emoji}`);
    btn.addEventListener('click', () => addSticker(emoji));
    stickerPicker.appendChild(btn);
  });
}

function addSticker(emoji) {
  stickerSeq += 1;
  const jitter = ((stickerSeq % 5) - 2) * 6; // small spread so repeats don't stack exactly
  stickers.push({
    id: `s${stickerSeq}`,
    emoji,
    x: Math.min(85, Math.max(15, 50 + jitter)),
    y: Math.min(85, Math.max(15, 50 - jitter)),
  });
  renderStickers();
  announce('Figurinha adicionada. Arraste para posicionar.');
}

function renderStickers() {
  stickerLayer.innerHTML = '';
  stickers.forEach((sticker) => {
    const el = document.createElement('div');
    el.className = 'sticker';
    el.style.left = `${sticker.x}%`;
    el.style.top = `${sticker.y}%`;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Figurinha ${sticker.emoji}, arraste para mover`);
    el.textContent = sticker.emoji;

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'sticker-remove';
    rmBtn.setAttribute('aria-label', 'Remover figurinha');
    rmBtn.textContent = '×';
    rmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stickers = stickers.filter((s) => s.id !== sticker.id);
      renderStickers();
    });
    el.appendChild(rmBtn);

    makeStickerDraggable(el, sticker);
    stickerLayer.appendChild(el);
  });
}

function makeStickerDraggable(el, sticker) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target !== el) return; // ignore the remove button
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    const layerRect = stickerLayer.getBoundingClientRect();

    const onMove = (ev) => {
      let xPct = ((ev.clientX - layerRect.left) / layerRect.width) * 100;
      let yPct = ((ev.clientY - layerRect.top) / layerRect.height) * 100;
      xPct = Math.min(96, Math.max(4, xPct));
      yPct = Math.min(96, Math.max(4, yPct));
      sticker.x = xPct;
      sticker.y = yPct;
      el.style.left = `${xPct}%`;
      el.style.top = `${yPct}%`;
    };
    const onUp = () => {
      el.classList.remove('is-dragging');
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp, { once: true });
  });
}

/* ---------- Compose a matted (Polaroid-style) export ---------- */
function composePhotoCanvas() {
  const pad = Math.round(canvas.width * 0.045);
  const bottomPad = Math.round(pad * 2.6);
  const matColor = bgColorInput.value;

  const out = document.createElement('canvas');
  out.width = canvas.width + pad * 2;
  out.height = canvas.height + pad + bottomPad;
  const outCtx = out.getContext('2d');

  outCtx.fillStyle = matColor;
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(canvas, pad, pad);

  if (stickers.length) {
    const fontSize = canvas.width * STICKER_FONT_RATIO;
    outCtx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    outCtx.textAlign = 'center';
    outCtx.textBaseline = 'middle';
    stickers.forEach((sticker) => {
      const px = pad + (sticker.x / 100) * canvas.width;
      const py = pad + (sticker.y / 100) * canvas.height;
      outCtx.fillText(sticker.emoji, px, py);
    });
  }

  const r = parseInt(matColor.slice(1, 3), 16);
  const g = parseInt(matColor.slice(3, 5), 16);
  const b = parseInt(matColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  outCtx.fillStyle = luminance > 0.55 ? '#05070f' : '#e6f1ff';
  outCtx.font = `${Math.max(14, Math.round(canvas.width * 0.028))}px "JetBrains Mono", monospace`;
  outCtx.textAlign = 'left';
  outCtx.textBaseline = 'middle';
  const label = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  outCtx.fillText(`OBSCURA · ${label}`, pad, canvas.height + pad + bottomPad / 2);

  return out;
}

function composePhotoBlob() {
  return new Promise((resolve) => {
    composePhotoCanvas().toBlob((blob) => resolve(blob), 'image/png');
  });
}

/* ---------- IndexedDB gallery store ---------- */
let dbPromise = null;

function dbOpen() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB indisponível'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbAddItem(item) {
  const db = await dbOpen();
  const id = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await dbEnforceLimit();
  return id;
}

async function dbGetAll() {
  const db = await dbOpen();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  return items.sort((a, b) => b.id - a.id); // newest first
}

async function dbDeleteItem(id) {
  const db = await dbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbClear() {
  const db = await dbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbEnforceLimit() {
  const items = await dbGetAll();
  if (items.length <= MAX_GALLERY_ITEMS) return;
  const excess = items.slice(MAX_GALLERY_ITEMS); // oldest entries (already sorted newest first)
  await Promise.all(excess.map((item) => dbDeleteItem(item.id)));
}

async function migrateLegacyGallery() {
  let raw;
  try {
    raw = localStorage.getItem(LEGACY_GALLERY_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) {
      const ordered = arr.slice().reverse(); // oldest first so re-sort by id keeps original order
      for (const dataUrl of ordered) {
        try {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          await dbAddItem({ type: 'photo', blob, mimeType: blob.type || 'image/png', createdAt: Date.now() });
        } catch (err) {
          console.error('Failed to migrate a legacy photo:', err);
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse legacy gallery:', err);
  } finally {
    localStorage.removeItem(LEGACY_GALLERY_KEY);
  }
}

/* ---------- Gallery ---------- */
saveButton.addEventListener('click', async () => {
  if (!originalImageData) return;
  try {
    const blob = await composePhotoBlob();
    if (!blob) throw new Error('Falha ao gerar imagem');
    await dbAddItem({ type: 'photo', blob, mimeType: 'image/png', createdAt: Date.now() });
    await renderGallery();
    announce('Foto salva na galeria.');
  } catch (err) {
    console.error('Failed to save photo:', err);
    announce('Não foi possível salvar a foto.');
  }
});

function revokeGalleryObjectURLs() {
  galleryObjectURLs.forEach((url) => URL.revokeObjectURL(url));
  galleryObjectURLs = [];
}

function videoExtension(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

async function renderGallery() {
  const items = await dbGetAll();

  revokeGalleryObjectURLs();
  galleryList.innerHTML = '';

  const photoCount = items.filter((i) => i.type === 'photo').length;
  const videoCount = items.filter((i) => i.type === 'video').length;
  if (videoCount > 0) {
    galleryCount.textContent = `${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'} · ${videoCount} ${videoCount === 1 ? 'vídeo' : 'vídeos'}`;
  } else {
    galleryCount.textContent = `${photoCount} ${photoCount === 1 ? 'quadro' : 'quadros'}`;
  }
  galleryEmpty.classList.toggle('hidden', items.length > 0);

  items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.dataset.type = item.type;

    const objectUrl = URL.createObjectURL(item.blob);
    galleryObjectURLs.push(objectUrl);

    let media;
    if (item.type === 'video') {
      media = document.createElement('video');
      media.src = objectUrl;
      media.controls = true;
      media.preload = 'metadata';
      media.playsInline = true;
      media.setAttribute('aria-label', `Vídeo salvo ${idx + 1}`);
    } else {
      media = document.createElement('img');
      media.src = objectUrl;
      media.alt = `Foto salva ${idx + 1}`;
      media.loading = 'lazy';
    }

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'dl-btn';
    dlBtn.setAttribute('aria-label', item.type === 'video' ? `Baixar vídeo ${idx + 1}` : `Baixar foto ${idx + 1}`);
    dlBtn.title = 'Baixar';
    dlBtn.textContent = '↓';
    dlBtn.addEventListener('click', () => downloadGalleryItem(item));

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'rm-btn';
    rmBtn.setAttribute('aria-label', item.type === 'video' ? `Remover vídeo ${idx + 1}` : `Remover foto ${idx + 1}`);
    rmBtn.title = 'Remover';
    rmBtn.textContent = '×';
    rmBtn.addEventListener('click', () => removeFromGallery(item.id));

    actions.appendChild(dlBtn);
    actions.appendChild(rmBtn);

    li.appendChild(media);
    li.appendChild(actions);
    galleryList.appendChild(li);
  });
}

function downloadGalleryItem(item) {
  const url = URL.createObjectURL(item.blob);
  const stamp = new Date(item.createdAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  const ext = item.type === 'video' ? videoExtension(item.mimeType || '') : 'png';
  const link = document.createElement('a');
  link.href = url;
  link.download = `obscura-${item.type === 'video' ? 'video' : 'foto'}-${stamp}.${ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  announce(item.type === 'video' ? 'Download do vídeo iniciado.' : 'Download da foto iniciado.');
}

async function removeFromGallery(id) {
  try {
    await dbDeleteItem(id);
    await renderGallery();
    announce('Item removido da galeria.');
  } catch (err) {
    console.error('Failed to remove item:', err);
  }
}

clearGalleryBtn.addEventListener('click', async () => {
  const items = await dbGetAll();
  if (items.length === 0) return;
  await dbClear();
  await renderGallery();
  announce('Galeria limpa.');
});

/* ---------- Export current photo ---------- */
exportBtn.addEventListener('click', async () => {
  if (!originalImageData) return;
  try {
    const blob = await composePhotoBlob();
    if (!blob) throw new Error('Falha ao gerar imagem');
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const link = document.createElement('a');
    link.download = `obscura-foto-${stamp}.png`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    announce('Download iniciado.');
  } catch (err) {
    console.error('Failed to export photo:', err);
    announce('Não foi possível gerar o download.');
  }
});

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.style.setProperty('--mat-color', bgColorInput.value);
  renderFilterChips();
  renderStickerPicker();
  setCaptureMode('photo');

  try {
    await migrateLegacyGallery();
  } catch (err) {
    console.error('Legacy gallery migration failed:', err);
  }
  await renderGallery();

  startCamera(facingMode);
});
