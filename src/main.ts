import './style.css';
import { registerSW } from 'virtual:pwa-register';
import {
  allLabels,
  BUILT_IN_LABELS,
  DEFAULT_TEMPLATES,
  normalizeCustomLabels,
  normalizeTemplates,
  type PhotoTemplates,
  type TemplateName,
} from './labels';
import { buildPdf, formatAddress } from './pdf';
import {
  loadCustomLabels,
  loadLocal,
  loadTemplates,
  saveCustomLabels,
  saveLocal,
  saveTemplates,
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
const orderDialog = byId<HTMLDialogElement>('orderDialog');
const labelsDialog = byId<HTMLDialogElement>('labelsDialog');
const templatesDialog = byId<HTMLDialogElement>('templatesDialog');
const customLabelInput = byId<HTMLInputElement>('customLabelInput');
const customLabelsList = byId('customLabelsList');
const templateItems = byId('templateItems');
const templateTabTitle = byId('templateTabTitle');
const templateItemCount = byId('templateItemCount');
const captionLabels = byId<HTMLDataListElement>('captionLabels');
const builtInLabels = byId('builtInLabels');
const saveSessionButton = byId<HTMLButtonElement>('saveSession');
const openOrderEditorButton = byId<HTMLButtonElement>('openOrderEditor');
const clearPhotosButton = byId<HTMLButtonElement>('clearPhotos');
const loadingOverlay = byId('loadingOverlay');
const loadingProgress = byId('loadingProgress');
const scrollToTopButton = byId<HTMLButtonElement>('scrollToTop');
const settingsButton = byId<HTMLButtonElement>('settingsButton');
const settingsMenu = byId('settingsMenu');

let photos: StoredPhoto[] = [];
let customLabels: string[] = [];
let templates: PhotoTemplates = normalizeTemplates(undefined);
let activeTemplate: TemplateName = 'lakás';
let saveTimer = 0;
let toastTimer = 0;
let draggedPhotoId: string | null = null;
let draggedTemplateItem: { name: TemplateName; index: number } | null = null;
let deferredInstall: BeforeInstallPromptEvent | null = null;
let lockedScrollPosition = 0;

function currentSession(): SessionData {
  return {
    version: 3,
    address: addressInput.value.trim(),
    hrsz: hrszInput.value.trim(),
    photos,
    customLabels,
    templates: normalizeTemplates(templates),
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

function lockPageScroll(): void {
  if (document.body.classList.contains('modal-open')) return;
  lockedScrollPosition = window.scrollY;
  document.body.style.top = `-${lockedScrollPosition}px`;
  document.body.classList.add('modal-open');
}

function unlockPageScroll(): void {
  if (document.querySelector('dialog[open]')) return;
  document.body.classList.remove('modal-open');
  document.body.style.removeProperty('top');
  window.scrollTo({ top: lockedScrollPosition, behavior: 'auto' });
}

function openDialog(dialog: HTMLDialogElement): void {
  lockPageScroll();
  try {
    dialog.showModal();
  } catch (error) {
    unlockPageScroll();
    throw error;
  }
}

function updateScrollToTopButton(): void {
  scrollToTopButton.classList.toggle('visible', window.scrollY > 240);
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

function safeSession(value: unknown, fallbackTemplates: PhotoTemplates = templates): SessionData {
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
    version: 3,
    address: candidate.address.slice(0, 240),
    hrsz: candidate.hrsz.slice(0, 80),
    photos: validPhotos,
    customLabels: normalizeCustomLabels(candidate.customLabels),
    templates: normalizeTemplates(candidate.templates, fallbackTemplates),
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
  openOrderEditorButton.disabled = photos.length < 2;
  clearPhotosButton.disabled = photos.length === 0;
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
  subject = 'fotó',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn';
  if (label === 'Törlés') button.classList.add('delete-photo');
  else button.classList.add('move-photo');
  button.textContent = symbol;
  button.title = label;
  button.disabled = disabled;
  button.setAttribute('aria-label', `${label}: ${index + 1}. ${subject}`);
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
    const previewActions = document.createElement('div');
    previewActions.className = 'mini-preview-actions';
    previewActions.append(
      createRowButton('↑', 'Feljebb', index, () => movePhoto(index, index - 1), index === 0),
      createRowButton('↓', 'Lejjebb', index, () => movePhoto(index, index + 1), index === photos.length - 1),
    );
    previewItem.append(previewImage, badge, previewActions);
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

function persistTemplates(render = true): void {
  templates = normalizeTemplates(templates);
  try {
    saveTemplates(templates);
  } catch (error) {
    notify(`A sablonok nem menthetők: ${errorMessage(error)}`);
  }
  if (render) renderTemplateEditor();
  scheduleSave();
}

function moveTemplateItem(fromIndex: number, toIndex: number): void {
  const items = templates[activeTemplate];
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return;
  const [item] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, item);
  persistTemplates();
}

function renderTemplateEditor(): void {
  const items = templates[activeTemplate];
  const templateTitle = activeTemplate === 'lakás' ? 'Lakás sablon' : 'Ház sablon';
  templateTabTitle.textContent = templateTitle;
  templateItemCount.textContent = `${items.length} elem`;
  templateItems.replaceChildren();

  items.forEach((value, index) => {
    const row = document.createElement('div');
    row.className = 'template-item';

    const number = document.createElement('span');
    number.className = 'template-item-number';
    number.innerHTML = `<span aria-hidden="true">⠿</span>${index + 1}`;
    number.draggable = true;
    number.title = 'Húzd a sorrend módosításához';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.maxLength = 100;
    input.setAttribute('list', 'captionLabels');
    input.setAttribute('aria-label', `${templateTitle} ${index + 1}. eleme`);
    input.addEventListener('input', () => {
      items[index] = input.value.slice(0, 100);
      try {
        saveTemplates(templates);
      } catch (error) {
        notify(`A sablonok nem menthetők: ${errorMessage(error)}`);
      }
      scheduleSave();
    });
    input.addEventListener('blur', () => {
      items[index] = input.value.trim().replace(/\s+/g, ' ');
      input.value = items[index];
      persistTemplates(false);
    });

    number.addEventListener('dragstart', (event) => {
      draggedTemplateItem = { name: activeTemplate, index };
      row.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', `${activeTemplate}:${index}`);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragenter', (event) => {
      if (!draggedTemplateItem || draggedTemplateItem.name !== activeTemplate) return;
      event.preventDefault();
      if (draggedTemplateItem.index !== index) row.classList.add('drag-over');
    });
    row.addEventListener('dragover', (event) => {
      if (!draggedTemplateItem || draggedTemplateItem.name !== activeTemplate) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('dragleave', (event) => {
      if (!row.contains(event.relatedTarget as Node | null)) row.classList.remove('drag-over');
    });
    row.addEventListener('drop', (event) => {
      if (!draggedTemplateItem || draggedTemplateItem.name !== activeTemplate) return;
      event.preventDefault();
      row.classList.remove('drag-over');
      moveTemplateItem(draggedTemplateItem.index, index);
    });
    number.addEventListener('dragend', () => {
      draggedTemplateItem = null;
      row.classList.remove('dragging');
      templateItems.querySelectorAll('.drag-over').forEach((element) => element.classList.remove('drag-over'));
    });

    const controls = document.createElement('div');
    controls.className = 'template-item-controls';
    controls.append(
      createRowButton('↑', 'Feljebb', index, () => moveTemplateItem(index, index - 1), index === 0, 'sablonelem'),
      createRowButton('↓', 'Lejjebb', index, () => moveTemplateItem(index, index + 1), index === items.length - 1, 'sablonelem'),
      createRowButton('✕', 'Törlés', index, () => {
        items.splice(index, 1);
        persistTemplates();
      }, false, 'sablonelem'),
    );

    row.append(number, input, controls);
    templateItems.append(row);
  });
}

function selectTemplateTab(name: TemplateName): void {
  activeTemplate = name;
  document.querySelectorAll<HTMLButtonElement>('.template-tab').forEach((button) => {
    const isActive = button.dataset.template === name;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  renderTemplateEditor();
}

function closeSettingsMenu(): void {
  settingsMenu.hidden = true;
  settingsButton.setAttribute('aria-expanded', 'false');
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

function applyTemplate(name: TemplateName): void {
  photos.forEach((photo, index) => {
    photo.caption = templates[name][index] ?? '';
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

    openDialog(previewDialog);
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
  templates = session.templates;
  persistTemplates();
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
    templates = loadTemplates();
  } catch (error) {
    notify(errorMessage(error));
    templates = normalizeTemplates(undefined);
  }

  try {
    const stored = await loadLocal();
    if (stored) {
      const session = safeSession(stored, templates);
      addressInput.value = session.address;
      hrszInput.value = session.hrsz;
      photos = session.photos;
      customLabels = normalizeCustomLabels([...customLabels, ...session.customLabels]);
      templates = session.templates;
    }
  } catch (error) {
    notify(`A helyi munka nem tölthető be: ${errorMessage(error)}`);
  }

  renderLabelOptions();
  renderCustomLabels();
  renderTemplateEditor();
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

openOrderEditorButton.addEventListener('click', () => openDialog(orderDialog));
byId('closeOrderEditor').addEventListener('click', () => orderDialog.close());
clearPhotosButton.addEventListener('click', () => {
  if (!photos.length || !window.confirm(`Biztosan törlöd mind a(z) ${photos.length} képet?`)) return;
  photos = [];
  orderDialog.close();
  renderPhotos();
  scheduleSave();
  notify('Minden kép törölve.');
});

settingsButton.addEventListener('click', (event) => {
  event.stopPropagation();
  const willOpen = settingsMenu.hidden;
  settingsMenu.hidden = !willOpen;
  settingsButton.setAttribute('aria-expanded', String(willOpen));
});
settingsMenu.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', closeSettingsMenu);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettingsMenu();
});

byId('manageLabels').addEventListener('click', () => {
  closeSettingsMenu();
  renderCustomLabels();
  openDialog(labelsDialog);
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

byId('manageTemplates').addEventListener('click', () => {
  closeSettingsMenu();
  selectTemplateTab(activeTemplate);
  openDialog(templatesDialog);
});
byId('closeTemplates').addEventListener('click', () => templatesDialog.close());
document.querySelectorAll<HTMLButtonElement>('.template-tab').forEach((button) => {
  button.addEventListener('click', () => selectTemplateTab(button.dataset.template as TemplateName));
});
byId('addTemplateItem').addEventListener('click', () => {
  templates[activeTemplate].push('');
  persistTemplates();
  requestAnimationFrame(() => {
    templateItems.querySelectorAll<HTMLInputElement>('input').item(templates[activeTemplate].length - 1)?.focus();
  });
});
byId('resetTemplate').addEventListener('click', () => {
  const name = activeTemplate === 'lakás' ? 'Lakás' : 'Ház';
  if (!window.confirm(`Biztosan visszaállítod a ${name} sablon alapértelmezett elemeit és sorrendjét?`)) return;
  templates[activeTemplate] = [...DEFAULT_TEMPLATES[activeTemplate]];
  persistTemplates();
  notify(`${name} sablon visszaállítva.`);
});

[orderDialog, previewDialog, labelsDialog, templatesDialog].forEach((dialog) => {
  dialog.addEventListener('close', unlockPageScroll);
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

window.addEventListener('scroll', updateScrollToTopButton, { passive: true });
scrollToTopButton.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
});
updateScrollToTopButton();

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
