import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { allLabels, BUILT_IN_LABELS, normalizeCustomLabels, TEMPLATES } from './labels';
import { buildPdf, formatAddress } from './pdf';
import {
  loadCustomLabels,
  loadLocal,
  saveCustomLabels,
  saveLocal,
  type SessionData,
  type StoredPhoto,
} from './storage';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

interface JsonFileHandle {
  getFile(): Promise<File>;
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    excludeAcceptAllOption: boolean;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<JsonFileHandle[]>;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Hiányzó felületi elem: #${id}`);
  return element as T;
}

const addressInput = byId<HTMLInputElement>('address');
const hrszInput = byId<HTMLInputElement>('hrsz');
const photoInput = byId<HTMLInputElement>('photoInput');
const sessionInput = byId<HTMLInputElement>('sessionInput');
const photoList = byId('photoList');
const miniPreview = byId('miniPreview');
const statusElement = byId('status');
const toast = byId('toast');
const previewDialog = byId<HTMLDialogElement>('previewDialog');
const previewPages = byId('previewPages');
const labelsDialog = byId<HTMLDialogElement>('labelsDialog');
const customLabelInput = byId<HTMLInputElement>('customLabelInput');
const customLabelsList = byId('customLabelsList');
const captionLabels = byId<HTMLDataListElement>('captionLabels');
const builtInLabels = byId('builtInLabels');
const saveSessionButton = byId<HTMLButtonElement>('saveSession');
const loadingOverlay = byId('loadingOverlay');
const loadingProgress = byId('loadingProgress');

let photos: StoredPhoto[] = [];
let customLabels: string[] = [];
let saveTimer = 0;
let toastTimer = 0;
let draggedPhotoId: string | null = null;
let deferredInstall: BeforeInstallPromptEvent | null = null;

function currentSession(): SessionData {
  return {
    version: 2,
    address: addressInput.value.trim(),
    hrsz: hrszInput.value.trim(),
    photos,
    customLabels,
    updatedAt: Date.now(),
  };
}

function notify(text: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = text;
  toast.classList.add('show');
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function showLoadingOverlay(current: number, total: number): void {
  loadingProgress.textContent = `${current} / ${total}`;
  loadingOverlay.hidden = false;
  document.body.classList.add('loading');
}

function hideLoadingOverlay(): void {
  loadingOverlay.hidden = true;
  document.body.classList.remove('loading');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ismeretlen hiba történt.';
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveLocal(currentSession()).catch((error: unknown) => {
      statusElement.textContent = `Az automatikus mentés nem sikerült: ${errorMessage(error)}`;
      statusElement.className = 'status error';
    });
  }, 350);
}

function createPhotoId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `photo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function safeSession(value: unknown): SessionData {
  if (!value || typeof value !== 'object') throw new Error('Érvénytelen munkafájl.');
  const candidate = value as Partial<SessionData> & { version?: number };

  if (
    typeof candidate.address !== 'string' ||
    typeof candidate.hrsz !== 'string' ||
    !Array.isArray(candidate.photos) ||
    candidate.photos.length > 150
  ) {
    throw new Error('Érvénytelen vagy túl nagy munkafájl.');
  }

  const validPhotos = candidate.photos.map((photo: unknown): StoredPhoto => {
    if (!photo || typeof photo !== 'object') throw new Error('A munkafájl hibás fotóadatot tartalmaz.');
    const item = photo as Partial<StoredPhoto>;
    if (
      typeof item.dataUrl !== 'string' ||
      !/^data:image\/(jpeg|png|webp);base64,/i.test(item.dataUrl) ||
      item.dataUrl.length > 12_000_000
    ) {
      throw new Error('A munkafájl nem támogatott vagy túl nagy képet tartalmaz.');
    }

    return {
      id: typeof item.id === 'string' && item.id ? item.id : createPhotoId(),
      dataUrl: item.dataUrl,
      caption: typeof item.caption === 'string' ? item.caption.slice(0, 160) : '',
    };
  });

  return {
    version: 2,
    address: candidate.address.slice(0, 240),
    hrsz: candidate.hrsz.slice(0, 80),
    photos: validPhotos,
    customLabels: normalizeCustomLabels(candidate.customLabels),
    updatedAt: Date.now(),
  };
}

function fileName(): string {
  return (formatAddress(addressInput.value) || 'ingatlan')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '_');
}

function validateDetails(): void {
  if (!addressInput.value.trim() || !hrszInput.value.trim()) {
    throw new Error('Add meg a címet és a helyrajzi számot.');
  }
}

function validateDocument(): void {
  validateDetails();
  if (!photos.length) throw new Error('Adj hozzá legalább egy fotót.');
}

function updateStatus(): void {
  statusElement.textContent = photos.length
    ? `${photos.length} fotó betöltve`
    : '';
  statusElement.className = photos.length ? 'status success' : 'status';
  saveSessionButton.disabled = !addressInput.value.trim() || !hrszInput.value.trim();
}

function movePhoto(fromIndex: number, toIndex: number): void {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= photos.length ||
    toIndex >= photos.length ||
    fromIndex === toIndex
  ) {
    return;
  }

  const [photo] = photos.splice(fromIndex, 1);
  photos.splice(toIndex, 0, photo);
  renderPhotos();
  scheduleSave();
}

function createRowButton(
  symbol: string,
  label: string,
  index: number,
  action: () => void,
  disabled = false,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  if (label === 'Törlés') button.classList.add('delete-photo');
  else button.classList.add('move-photo');
  button.textContent = symbol;
  button.title = label;
  button.disabled = disabled;
  button.setAttribute('aria-label', `${label}: ${index + 1}. fotó`);
  button.addEventListener('click', action);
  return button;
}

function renderPhotos(): void {
  photoList.replaceChildren();
  miniPreview.replaceChildren();

  for (const [index, photo] of photos.entries()) {
    const row = document.createElement('article');
    row.className = 'photo-row';
    row.draggable = true;
    row.dataset.photoId = photo.id;

    const number = document.createElement('div');
    number.className = 'photo-number';
    number.innerHTML = `<span aria-hidden="true">⠿</span>${index + 1}`;

    const image = document.createElement('img');
    image.src = photo.dataUrl;
    image.alt = photo.caption || `${index + 1}. fotó`;

    let previewBadge: HTMLDivElement | null = null;
    const input = document.createElement('input');
    input.className = 'caption';
    input.setAttribute('list', 'captionLabels');
    input.placeholder = 'Felirat...';
    input.maxLength = 160;
    input.value = photo.caption;
    input.setAttribute('aria-label', `${index + 1}. fotó felirata`);
    input.addEventListener('input', () => {
      photo.caption = input.value;
      image.alt = photo.caption || `${index + 1}. fotó`;
      if (previewBadge) previewBadge.textContent = `${index + 1}. ${photo.caption || '–'}`;
      scheduleSave();
    });

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.append(
      createRowButton('↑', 'Feljebb', index, () => movePhoto(index, index - 1), index === 0),
      createRowButton('↓', 'Lejjebb', index, () => movePhoto(index, index + 1), index === photos.length - 1),
      createRowButton('✕', 'Törlés', index, () => {
        photos.splice(index, 1);
        renderPhotos();
        scheduleSave();
      }),
    );

    row.addEventListener('dragstart', (event) => {
      draggedPhotoId = photo.id;
      row.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', photo.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (draggedPhotoId !== photo.id) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('drag-over');
      const sourceId = draggedPhotoId ?? event.dataTransfer?.getData('text/plain');
      movePhoto(photos.findIndex((item) => item.id === sourceId), index);
    });
    row.addEventListener('dragend', () => {
      draggedPhotoId = null;
      row.classList.remove('dragging');
      photoList.querySelectorAll('.drag-over').forEach((element) => element.classList.remove('drag-over'));
    });

    row.append(number, image, input, actions);
    photoList.append(row);

    const previewItem = document.createElement('div');
    previewItem.className = 'mini-preview-item';
    previewItem.draggable = true;
    const previewImage = document.createElement('img');
    previewImage.src = photo.dataUrl;
    previewImage.alt = photo.caption || `${index + 1}. fotó`;
    previewImage.draggable = false;
    const badge = document.createElement('div');
    badge.className = 'mini-preview-badge';
    badge.textContent = `${index + 1}. ${photo.caption || '–'}`;
    previewBadge = badge;
    previewItem.append(previewImage, badge);
    previewItem.addEventListener('dragstart', (event) => {
      draggedPhotoId = photo.id;
      previewItem.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', photo.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    previewItem.addEventListener('dragenter', (event) => {
      event.preventDefault();
      if (draggedPhotoId !== photo.id) previewItem.classList.add('drag-over');
    });
    previewItem.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    previewItem.addEventListener('dragleave', (event) => {
      if (!previewItem.contains(event.relatedTarget as Node | null)) {
        previewItem.classList.remove('drag-over');
      }
    });
    previewItem.addEventListener('drop', (event) => {
      event.preventDefault();
      previewItem.classList.remove('drag-over');
      const sourceId = event.dataTransfer?.getData('text/plain') || draggedPhotoId;
      movePhoto(photos.findIndex((item) => item.id === sourceId), index);
    });
    previewItem.addEventListener('dragend', () => {
      draggedPhotoId = null;
      previewItem.classList.remove('dragging');
      miniPreview.querySelectorAll('.drag-over').forEach((element) => element.classList.remove('drag-over'));
    });
    miniPreview.append(previewItem);
  }

  const addRow = document.createElement('button');
  addRow.type = 'button';
  addRow.className = 'add-photo-row';
  addRow.innerHTML = '<span class="add-number">+</span><span class="add-box">+</span><span>Új kép hozzáadása</span>';
  addRow.addEventListener('click', () => photoInput.click());
  photoList.append(addRow);

  const addPreview = document.createElement('button');
  addPreview.type = 'button';
  addPreview.className = 'mini-preview-item mini-preview-add';
  addPreview.textContent = '+';
  addPreview.setAttribute('aria-label', 'Új kép hozzáadása');
  addPreview.addEventListener('click', () => photoInput.click());
  miniPreview.append(addPreview);

  updateStatus();
}

function renderLabelOptions(): void {
  captionLabels.replaceChildren(
    ...allLabels(customLabels).map((label) => {
      const option = document.createElement('option');
      option.value = label;
      return option;
    }),
  );
  builtInLabels.textContent = BUILT_IN_LABELS.join(' · ');
}

function renderCustomLabels(): void {
  customLabelsList.replaceChildren();
  if (!customLabels.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = 'Még nincs saját felirat.';
    customLabelsList.append(empty);
    return;
  }

  for (const label of customLabels) {
    const row = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = label;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn danger small';
    removeButton.textContent = 'Törlés';
    removeButton.setAttribute('aria-label', `${label} saját felirat törlése`);
    removeButton.addEventListener('click', () => {
      customLabels = customLabels.filter((item) => item !== label);
      persistCustomLabels();
    });
    row.append(text, removeButton);
    customLabelsList.append(row);
  }
}

function persistCustomLabels(): void {
  customLabels = normalizeCustomLabels(customLabels);
  try {
    saveCustomLabels(customLabels);
  } catch (error) {
    notify(`A feliratlista nem menthető: ${errorMessage(error)}`);
  }
  renderLabelOptions();
  renderCustomLabels();
  scheduleSave();
}

function addCustomLabel(): void {
  const label = customLabelInput.value.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!label) {
    customLabelInput.focus();
    return;
  }

  const existing = allLabels(customLabels).some(
    (item) => item.localeCompare(label, 'hu', { sensitivity: 'base' }) === 0,
  );
  if (existing) {
    notify('Ez a felirat már szerepel a listában.');
    return;
  }

  customLabels.push(label);
  customLabelInput.value = '';
  persistCustomLabels();
  customLabelInput.focus();
}

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 30_000_000) {
      reject(new Error(`${file.name}: a fájl túl nagy (maximum 30 MB).`));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name}: a fájl nem olvasható.`));
    reader.onabort = () => reject(new Error(`${file.name}: az olvasás megszakadt.`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`${file.name}: nem támogatott képformátum.`));
      image.onload = () => {
        let width = image.naturalWidth;
        let height = image.naturalHeight;
        if (!width || !height) {
          reject(new Error(`${file.name}: a kép mérete érvénytelen.`));
          return;
        }

        const ratio = Math.min(1, 1800 / width, 1200 / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('A böngésző nem tudja feldolgozni a képet.'));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function addFiles(files: FileList | File[]): Promise<void> {
  const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
  if (!imageFiles.length) {
    notify('Nem található támogatott képfájl.');
    return;
  }

  let failed = 0;
  showLoadingOverlay(0, imageFiles.length);

  try {
    for (const [index, file] of imageFiles.entries()) {
      try {
        photos.push({ id: createPhotoId(), dataUrl: await resizeImage(file), caption: '' });
      } catch (error) {
        failed += 1;
        notify(errorMessage(error));
      } finally {
        showLoadingOverlay(index + 1, imageFiles.length);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }
  } finally {
    hideLoadingOverlay();
  }

  renderPhotos();
  scheduleSave();
  if (failed) notify(`${failed} kép nem tölthető be.`);
}

function applyTemplate(name: keyof typeof TEMPLATES): void {
  photos.forEach((photo, index) => {
    photo.caption = TEMPLATES[name][index] ?? '';
  });
  renderPhotos();
  scheduleSave();
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function savePdf(): Promise<void> {
  const button = byId<HTMLButtonElement>('savePdf');
  try {
    validateDocument();
    button.disabled = true;
    statusElement.textContent = 'PDF készítése...';
    statusElement.className = 'status working';
    const document = await buildPdf(currentSession());
    document.save(`${fileName()}_fotolap.pdf`);
    statusElement.textContent = `PDF elkészült (${Math.ceil(photos.length / 6)} oldal).`;
    statusElement.className = 'status success';
  } catch (error) {
    notify(errorMessage(error));
    statusElement.textContent = errorMessage(error);
    statusElement.className = 'status error';
  } finally {
    button.disabled = false;
  }
}

function showPreview(): void {
  try {
    validateDocument();
    previewPages.replaceChildren();

    for (let pageIndex = 0; pageIndex < Math.ceil(photos.length / 6); pageIndex += 1) {
      const page = document.createElement('section');
      page.className = 'preview-page';
      const header = document.createElement('div');
      header.className = 'preview-head';
      header.textContent = `${formatAddress(addressInput.value)}    hrsz: ${hrszInput.value}`;
      const grid = document.createElement('div');
      grid.className = 'preview-grid';

      for (const photo of photos.slice(pageIndex * 6, pageIndex * 6 + 6)) {
        const cell = document.createElement('div');
        cell.className = 'preview-cell';
        const image = document.createElement('img');
        image.src = photo.dataUrl;
        image.alt = photo.caption;
        const caption = document.createElement('div');
        caption.textContent = photo.caption || '\u00a0';
        cell.append(image, caption);
        grid.append(cell);
      }

      const pageNumber = document.createElement('div');
      pageNumber.className = 'preview-page-number';
      pageNumber.textContent = String(pageIndex + 1);
      page.append(header, grid, pageNumber);
      previewPages.append(page);
    }

    previewDialog.showModal();
  } catch (error) {
    notify(errorMessage(error));
  }
}

function mergeSessionLabels(labels: string[]): void {
  customLabels = normalizeCustomLabels([...customLabels, ...labels]);
  persistCustomLabels();
}

async function importSessionFile(file: File): Promise<void> {
  if (!file.name.toLocaleLowerCase('hu').endsWith('.json')) {
    throw new Error('Csak JSON munkafájl nyitható meg.');
  }
  if (file.size > 200_000_000) throw new Error('A munkafájl túl nagy.');

  const session = safeSession(JSON.parse(await file.text()));
  addressInput.value = session.address;
  hrszInput.value = session.hrsz;
  photos = session.photos;
  mergeSessionLabels(session.customLabels);
  renderPhotos();
  scheduleSave();
  notify('Munka és saját feliratok betöltve.');
}

async function restoreLocalState(): Promise<void> {
  try {
    customLabels = loadCustomLabels();
  } catch (error) {
    notify(errorMessage(error));
    customLabels = [];
  }

  try {
    const stored = await loadLocal();
    if (stored) {
      const session = safeSession(stored);
      addressInput.value = session.address;
      hrszInput.value = session.hrsz;
      photos = session.photos;
      customLabels = normalizeCustomLabels([...customLabels, ...session.customLabels]);
    }
  } catch (error) {
    notify(`A helyi munka nem tölthető be: ${errorMessage(error)}`);
  }

  renderLabelOptions();
  renderCustomLabels();
  renderPhotos();
}

byId('pickPhotos').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', async () => {
  if (photoInput.files) await addFiles(photoInput.files);
  photoInput.value = '';
});

const dropZone = byId('pickPhotos');
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag');
  if (event.dataTransfer?.files) await addFiles(event.dataTransfer.files);
});

byId('flatTemplate').addEventListener('click', () => applyTemplate('lakás'));
byId('houseTemplate').addEventListener('click', () => applyTemplate('ház'));
byId('clearCaptions').addEventListener('click', () => {
  if (!photos.some((photo) => photo.caption) || window.confirm('Biztosan törlöd az összes fotó feliratát?')) {
    photos.forEach((photo) => {
      photo.caption = '';
    });
    renderPhotos();
    scheduleSave();
  }
});

saveSessionButton.addEventListener('click', () => {
  try {
    validateDetails();
    download(
      new Blob([JSON.stringify(currentSession())], { type: 'application/json' }),
      `${fileName()}_fotolap.json`,
    );
    notify('Munka exportálva.');
  } catch (error) {
    notify(errorMessage(error));
  }
});

byId('loadSession').addEventListener('click', async () => {
  const pickerWindow = window as FilePickerWindow;
  if (!pickerWindow.showOpenFilePicker) {
    sessionInput.click();
    return;
  }

  try {
    const [handle] = await pickerWindow.showOpenFilePicker({
      multiple: false,
      excludeAcceptAllOption: true,
      types: [{
        description: 'JSON munkafájl',
        accept: { 'application/json': ['.json'] },
      }],
    });
    if (handle) await importSessionFile(await handle.getFile());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    notify(errorMessage(error));
  }
});
sessionInput.addEventListener('change', async () => {
  try {
    const file = sessionInput.files?.[0];
    if (!file) return;
    await importSessionFile(file);
  } catch (error) {
    notify(errorMessage(error));
  } finally {
    sessionInput.value = '';
  }
});

byId('previewPdf').addEventListener('click', showPreview);
byId('savePdf').addEventListener('click', savePdf);
byId('closePreview').addEventListener('click', () => previewDialog.close());
byId('savePdfFromPreview').addEventListener('click', () => {
  previewDialog.close();
  void savePdf();
});

byId('manageLabels').addEventListener('click', () => {
  renderCustomLabels();
  labelsDialog.showModal();
  customLabelInput.focus();
});
byId('closeLabels').addEventListener('click', () => labelsDialog.close());
byId('addCustomLabel').addEventListener('click', addCustomLabel);
customLabelInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addCustomLabel();
  }
});

addressInput.addEventListener('input', () => {
  updateStatus();
  scheduleSave();
});
hrszInput.addEventListener('input', () => {
  updateStatus();
  scheduleSave();
});

const installButton = byId<HTMLButtonElement>('installBtn');
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;

if (isIos && !isStandalone) installButton.hidden = false;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event as BeforeInstallPromptEvent;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (deferredInstall) {
    await deferredInstall.prompt();
    deferredInstall = null;
  } else {
    notify('iPhone-on: Safari → Megosztás → Főképernyőhöz adás');
  }
});

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateServiceWorker(true);
  },
  onOfflineReady() {
    notify('Az alkalmazás offline használatra kész.');
  },
});

if (new URLSearchParams(window.location.search).has('loading-demo')) {
  let demoProgress = 5;
  const demoTotal = 50;
  showLoadingOverlay(demoProgress, demoTotal);
  window.setInterval(() => {
    demoProgress = demoProgress >= demoTotal ? 1 : demoProgress + 1;
    showLoadingOverlay(demoProgress, demoTotal);
  }, 700);
}

void restoreLocalState();
