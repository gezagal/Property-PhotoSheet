import './style.css';
import { registerSW } from 'virtual:pwa-register';
import {
  allLabels,
  BUILT_IN_LABELS,
  DEFAULT_TEMPLATES,
  normalizeCustomLabels,
  normalizeTemplates,
  rankLabels,
  type PhotoTemplates,
  type TemplateName,
} from './labels';
import { buildPdf, formatAddress } from './pdf';
import { prepareImage } from './images';
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
const orderDialogContent = byId('orderDialogContent');
const selectedPhotoCount = byId('selectedPhotoCount');
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
const aiCaptionSuggestionsButton = byId<HTMLButtonElement>('aiCaptionSuggestions');
const aiSuggestionsMenu = byId('aiSuggestionsMenu');
const suggestWithOpenAiButton = byId<HTMLButtonElement>('suggestWithOpenAi');
const newWorkButton = byId<HTMLButtonElement>('newWork');
const loadingOverlay = byId('loadingOverlay');
const loadingProgress = byId('loadingProgress');
const loadingTitle = byId('loadingTitle');
const photoUploadCard = byId('photoUploadCard');
const dropZone = byId<HTMLButtonElement>('pickPhotos');
const togglePhotoUploadButton = byId<HTMLButtonElement>('togglePhotoUpload');
const scrollToTopButton = byId<HTMLButtonElement>('scrollToTop');
const scrollToBottomButton = byId<HTMLButtonElement>('scrollToBottom');
const settingsButton = byId<HTMLButtonElement>('settingsButton');
const settingsMenu = byId('settingsMenu');

let photos: StoredPhoto[] = [];
let customLabels: string[] = [];
let templates: PhotoTemplates = normalizeTemplates(undefined);
let activeTemplate: TemplateName = 'lakás';
let photoUploadExpanded = true;
let previousPhotoCount = 0;
let saveTimer = 0;
let toastTimer = 0;
let draggedPhotoId: string | null = null;
let draggedPhotoIds: string[] = [];
let orderDropTarget: { id: string; after: boolean } | null = null;
let orderDragSlots: Array<{ left: number; top: number; width: number; height: number }> = [];
let orderDragPointer: { x: number; y: number } | null = null;
let photoDragContainer: HTMLElement | null = null;
const selectedPhotoIds = new Set<string>();
let draggedTemplateItem: { name: TemplateName; index: number } | null = null;
let orderAutoScrollFrame = 0;
let orderAutoScrollSpeed = 0;
let deferredInstall: BeforeInstallPromptEvent | null = null;
let lockedScrollPosition = 0;
let suggestingCaptions = false;

const ORDER_AUTO_SCROLL_ZONE = 140;
const ORDER_AUTO_SCROLL_MAX_SPEED = 22;

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

function showLoadingOverlay(current: number, total: number, title = 'Képek betöltése…'): void {
  loadingTitle.textContent = title;
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

function updatePageScrollButtons(): void {
  const maximumScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  scrollToTopButton.classList.toggle('visible', window.scrollY > 240);
  scrollToBottomButton.classList.toggle('visible', window.scrollY < maximumScroll - 240);
}

function renderPhotoUploadSection(): void {
  photoUploadCard.classList.toggle('collapsed', !photoUploadExpanded);
  dropZone.hidden = !photoUploadExpanded;
  togglePhotoUploadButton.setAttribute('aria-expanded', String(photoUploadExpanded));
  togglePhotoUploadButton.innerHTML = photoUploadExpanded
    ? 'Összecsukás <span aria-hidden="true">⌃</span>'
    : 'Kinyitás <span aria-hidden="true">⌄</span>';
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

function safeFileNamePart(value: string, fallback: string, maximumLength: number): string {
  const sanitized = value
    .normalize('NFC')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._ ]+|[._ ]+$/g, '')
    .slice(0, maximumLength)
    .replace(/[._ ]+$/g, '');
  return sanitized || fallback;
}

function fileName(): string {
  return safeFileNamePart(formatAddress(addressInput.value), 'ingatlan', 140);
}

function pdfFileName(): string {
  const address = fileName();
  const propertyNumber = safeFileNamePart(hrszInput.value, 'hrsz', 70);
  return `${address}_${propertyNumber}_fotolap.pdf`;
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
  if (!photos.length) {
    photoUploadExpanded = true;
  } else if (previousPhotoCount === 0) {
    photoUploadExpanded = false;
  }
  previousPhotoCount = photos.length;
  renderPhotoUploadSection();
  statusElement.textContent = photos.length
    ? `${photos.length} fotó betöltve`
    : '';
  statusElement.className = photos.length ? 'status success' : 'status';
  saveSessionButton.disabled = !addressInput.value.trim() || !hrszInput.value.trim();
  openOrderEditorButton.disabled = photos.length < 2;
  clearPhotosButton.disabled = photos.length === 0;
  requestAnimationFrame(updatePageScrollButtons);
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
  selectedPhotoIds.clear();
  renderPhotos();
  scheduleSave();
}

function photoGroupPlacement(photoIds: string[], targetId: string, after: boolean) {
  const movingIds = new Set(photoIds);
  if (!movingIds.size || movingIds.has(targetId)) return null;

  const movingPhotos = photos.filter((photo) => movingIds.has(photo.id));
  const remainingPhotos = photos.filter((photo) => !movingIds.has(photo.id));
  const targetIndex = remainingPhotos.findIndex((photo) => photo.id === targetId);
  if (!movingPhotos.length || targetIndex < 0) return null;

  const insertionIndex = targetIndex + (after ? 1 : 0);
  const reordered = [...remainingPhotos];
  reordered.splice(insertionIndex, 0, ...movingPhotos);
  if (reordered.every((photo, index) => photo.id === photos[index]?.id)) return null;
  return { reordered, insertionIndex, count: movingPhotos.length };
}

function movePhotoGroup(photoIds: string[], targetId: string, after: boolean): void {
  const placement = photoGroupPlacement(photoIds, targetId, after);
  if (!placement) return;

  photos = placement.reordered;
  selectedPhotoIds.clear();
  renderPhotos();
  scheduleSave();
}

function clearOrderDropPreview(): void {
  orderDropTarget = null;
  [miniPreview, photoList].forEach((container) => {
    container.classList.remove('previewing-drop');
    container.querySelectorAll('.order-drop-placeholder').forEach((item) => item.remove());
    container.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((item) => {
      item.style.removeProperty('order');
    });
  });
}

function isOutside(element: HTMLElement, event: MouseEvent): boolean {
  const bounds = element.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom;
}

function beginPhotoDrag(container: HTMLElement, photoIds: string[]): void {
  photoDragContainer = container;
  draggedPhotoIds = photoIds;
  draggedPhotoId = photoIds[0] ?? null;
  const bounds = container.getBoundingClientRect();
  const items = Array.from(container.querySelectorAll<HTMLElement>('[data-photo-id]'));
  orderDragSlots = items.map((item) => {
    const slot = item.getBoundingClientRect();
    return { left: slot.left - bounds.left, top: slot.top - bounds.top, width: slot.width, height: slot.height };
  });
  items.forEach((item) => item.classList.toggle('dragging', photoIds.includes(item.dataset.photoId ?? '')));
}

function showOrderDropPreview(target: HTMLElement, targetId: string, after: boolean): void {
  const container = photoDragContainer;
  if (!container) return;
  if (orderDropTarget?.id === targetId && orderDropTarget.after === after) return;
  const placement = photoGroupPlacement(draggedPhotoIds, targetId, after);
  if (!placement) {
    clearOrderDropPreview();
    return;
  }

  const height = target.getBoundingClientRect().height;
  const items = new Map(
    Array.from(container.querySelectorAll<HTMLElement>('[data-photo-id]'))
      .map((item) => [item.dataset.photoId, item]),
  );
  container.querySelectorAll('.order-drop-placeholder').forEach((item) => item.remove());
  placement.reordered.forEach((photo, index) => {
    if (draggedPhotoIds.includes(photo.id)) {
      const placeholder = document.createElement('div');
      placeholder.className = 'order-drop-placeholder';
      placeholder.style.order = String(index);
      placeholder.style.height = `${height}px`;
      placeholder.setAttribute('aria-hidden', 'true');
      container.append(placeholder);
    } else {
      const item = items.get(photo.id);
      if (item) item.style.order = String(index);
    }
  });
  orderDropTarget = { id: targetId, after };
  container.classList.add('previewing-drop');
}

function updateOrderDropPreview(pointerX: number, pointerY: number): void {
  if (!photoDragContainer || !orderDragSlots.length) return;
  orderDragPointer = { x: pointerX, y: pointerY };
  const bounds = photoDragContainer.getBoundingClientRect();
  const x = pointerX - bounds.left;
  const y = pointerY - bounds.top;
  let closestIndex = 0;
  let closestDistance = Infinity;
  // Frozen slots prevent shifted cards from changing the target under a stationary pointer.
  orderDragSlots.forEach((slot, index) => {
    const distance = Math.hypot(x - slot.left - slot.width / 2, y - slot.top - slot.height / 2);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  const remainingPhotos = photos.filter((photo) => !draggedPhotoIds.includes(photo.id));
  if (!remainingPhotos.length) return;
  const insertionIndex = Math.min(closestIndex, remainingPhotos.length);
  const targetPhoto = remainingPhotos[Math.min(insertionIndex, remainingPhotos.length - 1)];
  const target = Array.from(photoDragContainer.querySelectorAll<HTMLElement>('[data-photo-id]'))
    .find((item) => item.dataset.photoId === targetPhoto.id);
  if (target) showOrderDropPreview(target, targetPhoto.id, insertionIndex === remainingPhotos.length);
}

function finishOrderDrag(): void {
  stopOrderAutoScroll();
  clearOrderDropPreview();
  draggedPhotoId = null;
  draggedPhotoIds = [];
  orderDragSlots = [];
  orderDragPointer = null;
  photoDragContainer = null;
  [miniPreview, photoList].forEach((container) => {
    container.querySelectorAll('.dragging').forEach((element) => element.classList.remove('dragging'));
  });
}

function updateSelectedPhotoCount(): void {
  const count = selectedPhotoIds.size;
  selectedPhotoCount.textContent = `${count} ${count === 1 ? 'kép kijelölve' : 'kép kijelölve'}`;
}

function stopOrderAutoScroll(): void {
  orderAutoScrollSpeed = 0;
  if (orderAutoScrollFrame) cancelAnimationFrame(orderAutoScrollFrame);
  orderAutoScrollFrame = 0;
}

function runOrderAutoScroll(): void {
  if (!orderAutoScrollSpeed || !orderDialog.open) {
    stopOrderAutoScroll();
    return;
  }
  orderDialogContent.scrollTop += orderAutoScrollSpeed;
  orderAutoScrollFrame = requestAnimationFrame(runOrderAutoScroll);
}

function updateOrderAutoScroll(pointerY: number): void {
  const bounds = orderDialogContent.getBoundingClientRect();
  let speed = 0;

  if (pointerY < bounds.top + ORDER_AUTO_SCROLL_ZONE) {
    const intensity = Math.min(1, (bounds.top + ORDER_AUTO_SCROLL_ZONE - pointerY) / ORDER_AUTO_SCROLL_ZONE);
    speed = -Math.ceil(4 + intensity * (ORDER_AUTO_SCROLL_MAX_SPEED - 4));
  } else if (pointerY > bounds.bottom - ORDER_AUTO_SCROLL_ZONE) {
    const intensity = Math.min(1, (pointerY - (bounds.bottom - ORDER_AUTO_SCROLL_ZONE)) / ORDER_AUTO_SCROLL_ZONE);
    speed = Math.ceil(4 + intensity * (ORDER_AUTO_SCROLL_MAX_SPEED - 4));
  }

  orderAutoScrollSpeed = speed;
  if (speed && !orderAutoScrollFrame) orderAutoScrollFrame = requestAnimationFrame(runOrderAutoScroll);
  if (!speed) stopOrderAutoScroll();
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
  clearOrderDropPreview();
  photoList.replaceChildren();
  miniPreview.replaceChildren();
  const photoIds = new Set(photos.map((photo) => photo.id));
  selectedPhotoIds.forEach((id) => {
    if (!photoIds.has(id)) selectedPhotoIds.delete(id);
  });
  updateSelectedPhotoCount();
  updateAiSuggestionsAvailability();

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
    input.addEventListener('focus', () => renderLabelOptions(input.value));
    input.addEventListener('input', () => {
      renderLabelOptions(input.value);
      photo.caption = input.value;
      updateAiSuggestionsAvailability();
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
      beginPhotoDrag(photoList, [photo.id]);
      event.dataTransfer?.setData('text/plain', photo.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', finishOrderDrag);

    row.append(number, image, input, actions);
    photoList.append(row);

    const previewItem = document.createElement('div');
    previewItem.className = 'mini-preview-item';
    previewItem.dataset.photoId = photo.id;
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
    const deletePreviewButton = document.createElement('button');
    deletePreviewButton.type = 'button';
    deletePreviewButton.className = 'mini-preview-control mini-preview-delete';
    deletePreviewButton.textContent = '✕';
    deletePreviewButton.title = 'Kép törlése';
    deletePreviewButton.draggable = false;
    deletePreviewButton.setAttribute('aria-label', `Törlés: ${index + 1}. fotó`);
    deletePreviewButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    deletePreviewButton.addEventListener('dragstart', (event) => event.preventDefault());
    deletePreviewButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!window.confirm(`Biztosan törlöd a(z) ${index + 1}. képet?`)) return;
      photos.splice(index, 1);
      renderPhotos();
      scheduleSave();
      notify('Kép törölve.');
      if (!photos.length) orderDialog.close();
    });
    const selectPreviewButton = document.createElement('button');
    selectPreviewButton.type = 'button';
    selectPreviewButton.className = 'mini-preview-control mini-preview-select';
    selectPreviewButton.textContent = selectedPhotoIds.has(photo.id) ? '✓' : '○';
    selectPreviewButton.title = selectedPhotoIds.has(photo.id) ? 'Kijelölés megszüntetése' : 'Kép kijelölése';
    selectPreviewButton.draggable = false;
    selectPreviewButton.setAttribute('role', 'checkbox');
    selectPreviewButton.setAttribute('aria-checked', String(selectedPhotoIds.has(photo.id)));
    selectPreviewButton.setAttribute('aria-label', `Kijelölés: ${index + 1}. fotó`);
    selectPreviewButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    selectPreviewButton.addEventListener('dragstart', (event) => event.preventDefault());
    selectPreviewButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (selectedPhotoIds.has(photo.id)) selectedPhotoIds.delete(photo.id);
      else selectedPhotoIds.add(photo.id);
      renderPhotos();
    });
    if (selectedPhotoIds.has(photo.id)) previewItem.classList.add('selected');
    previewItem.append(previewImage, badge, previewActions, deletePreviewButton, selectPreviewButton);
    previewItem.addEventListener('dragstart', (event) => {
      const movingIds = selectedPhotoIds.has(photo.id)
        ? photos.filter((item) => selectedPhotoIds.has(item.id)).map((item) => item.id)
        : [photo.id];
      beginPhotoDrag(miniPreview, movingIds);
      event.dataTransfer?.setData('text/plain', JSON.stringify(draggedPhotoIds));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    previewItem.addEventListener('dragend', finishOrderDrag);
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

function renderLabelOptions(query = ''): void {
  captionLabels.replaceChildren(
    ...rankLabels(allLabels(customLabels), query).map((label) => {
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
    input.addEventListener('focus', () => renderLabelOptions(input.value));
    input.addEventListener('input', () => {
      renderLabelOptions(input.value);
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

async function suggestCaptions(): Promise<void> {
  if (suggestingCaptions) return;
  const targets = photos
    .filter((photo) => !photo.caption.trim())
    .map((photo) => ({ id: photo.id, dataUrl: photo.dataUrl }));
  if (!targets.length) {
    notify('Nincs üres feliratú kép.');
    return;
  }
  if (!window.confirm(
    `Az OpenAI használata plusz költséggel jár, amelyet az OpenAI API-fiókodban számolnak el.\n\n` +
    `${targets.length} üres feliratú kép tömörített másolatát továbbítjuk az OpenAI szolgáltatásának elemzésre.\n\n` +
    `Folytatod a fizetős feliratjavaslatot?`,
  )) return;

  suggestingCaptions = true;
  renderPhotos();
  let suggested = 0;
  let unmatched = 0;
  let failed = 0;
  let failureMessage = '';
  showLoadingOverlay(0, targets.length, 'AI-feliratjavaslat készítése…');

  try {
    for (const [index, target] of targets.entries()) {
      try {
        const aiImage = await prepareImage(target.dataUrl, 300_000, 1280);
        const response = await fetch('/.netlify/functions/suggest-label', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: aiImage.dataUrl, labels: allLabels(customLabels) }),
          signal: AbortSignal.timeout(45_000),
        });
        const result: unknown = await response.json();
        if (!response.ok) {
          const message = result && typeof result === 'object' && 'error' in result &&
            typeof result.error === 'string'
            ? result.error
            : `A feliratjavaslat kérése sikertelen (HTTP ${response.status}).`;
          throw new Error(message);
        }
        if (
          !result ||
          typeof result !== 'object' ||
          !('label' in result) ||
          (result.label !== null && typeof result.label !== 'string')
        ) {
          throw new Error('Érvénytelen választ adott az AI-felirat szolgáltatás.');
        }

        const photo = photos.find((item) => item.id === target.id);
        if (photo && !photo.caption.trim()) {
          if (typeof result.label === 'string' && allLabels(customLabels).includes(result.label)) {
            photo.caption = result.label;
            suggested += 1;
            scheduleSave();
          } else {
            unmatched += 1;
          }
        }
        renderPhotos();
      } catch (error) {
        failed += 1;
        failureMessage ||= errorMessage(error);
        break;
      } finally {
        showLoadingOverlay(index + 1, targets.length, 'AI-feliratjavaslat készítése…');
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }
  } finally {
    suggestingCaptions = false;
    hideLoadingOverlay();
    renderPhotos();
    if (suggested || unmatched) scheduleSave();
  }

  if (failed) {
    notify(failureMessage || 'Az AI-feliratjavaslat kérése sikertelen.');
  } else if (unmatched) {
    notify(`${suggested} felirat javasolva; ${unmatched} képnél nem volt biztos találat.`);
  } else {
    notify(`${suggested} AI-feliratjavaslat elkészült.`);
  }
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
    document.save(pdfFileName());
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
togglePhotoUploadButton.addEventListener('click', () => {
  photoUploadExpanded = !photoUploadExpanded;
  renderPhotoUploadSection();
  requestAnimationFrame(updatePageScrollButtons);
});
photoInput.addEventListener('change', async () => {
  if (photoInput.files) await addFiles(photoInput.files);
  photoInput.value = '';
});

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
function updateAiSuggestionsAvailability(): void {
  aiCaptionSuggestionsButton.disabled = suggestingCaptions || !photos.some((photo) => !photo.caption.trim());
  suggestWithOpenAiButton.disabled = aiCaptionSuggestionsButton.disabled;
  if (aiCaptionSuggestionsButton.disabled) closeAiSuggestionsMenu();
}

function closeAiSuggestionsMenu(): void {
  aiSuggestionsMenu.hidden = true;
  aiCaptionSuggestionsButton.setAttribute('aria-expanded', 'false');
}

aiCaptionSuggestionsButton.addEventListener('click', (event) => {
  event.stopPropagation();
  closeSettingsMenu();
  const willOpen = aiSuggestionsMenu.hidden;
  aiSuggestionsMenu.hidden = !willOpen;
  aiCaptionSuggestionsButton.setAttribute('aria-expanded', String(willOpen));
});
aiSuggestionsMenu.addEventListener('click', (event) => event.stopPropagation());
suggestWithOpenAiButton.addEventListener('click', () => {
  closeAiSuggestionsMenu();
  aiCaptionSuggestionsButton.focus();
  void suggestCaptions();
});
document.addEventListener('click', closeAiSuggestionsMenu);
document.addEventListener('focusin', (event) => {
  if (event.target instanceof Node && !aiSuggestionsMenu.parentElement?.contains(event.target)) {
    closeAiSuggestionsMenu();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !aiSuggestionsMenu.hidden) {
    closeAiSuggestionsMenu();
    aiCaptionSuggestionsButton.focus();
  }
});
aiCaptionSuggestionsButton.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    closeSettingsMenu();
    aiSuggestionsMenu.hidden = false;
    aiCaptionSuggestionsButton.setAttribute('aria-expanded', 'true');
    suggestWithOpenAiButton.focus();
  }
});
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

newWorkButton.addEventListener('click', async () => {
  const hasCurrentWork = Boolean(addressInput.value.trim() || hrszInput.value.trim() || photos.length);
  if (!hasCurrentWork) {
    notify('Nincs törölhető aktuális munka.');
    return;
  }

  const confirmed = window.confirm(
    'Biztosan új munkát kezdesz?\n\nHa a jelenlegi munkát nem mentetted el, minden adat és kép végleg elvész.',
  );
  if (!confirmed) return;

  window.clearTimeout(saveTimer);
  addressInput.value = '';
  hrszInput.value = '';
  photoInput.value = '';
  photos = [];
  renderPhotos();

  try {
    await saveLocal(currentSession());
    notify('Új munka létrehozva.');
    addressInput.focus();
  } catch (error) {
    notify(`Az új munka helyi mentése sikertelen: ${errorMessage(error)}`);
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
[miniPreview, photoList].forEach((container) => {
  container.addEventListener('dragover', (event) => {
    if (photoDragContainer !== container) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    updateOrderDropPreview(event.clientX, event.clientY);
  });
  container.addEventListener('dragleave', (event) => {
    if (photoDragContainer === container && isOutside(container, event)) {
      orderDragPointer = null;
      clearOrderDropPreview();
    }
  });
  container.addEventListener('drop', (event) => {
    if (photoDragContainer !== container) return;
    event.preventDefault();
    if (orderDropTarget) movePhotoGroup(draggedPhotoIds, orderDropTarget.id, orderDropTarget.after);
    finishOrderDrag();
  });
});
orderDialogContent.addEventListener('scroll', () => {
  if (orderDragPointer) updateOrderDropPreview(orderDragPointer.x, orderDragPointer.y);
});
window.addEventListener('scroll', () => {
  if (photoDragContainer === photoList && orderDragPointer) {
    updateOrderDropPreview(orderDragPointer.x, orderDragPointer.y);
  }
});
orderDialog.addEventListener('dragover', (event) => {
  if (!draggedPhotoId) return;
  event.preventDefault();
  updateOrderAutoScroll(event.clientY);
  if (!(event.target instanceof Node) || !miniPreview.contains(event.target)) {
    orderDragPointer = null;
    clearOrderDropPreview();
  }
});
orderDialog.addEventListener('dragleave', (event) => {
  if (isOutside(orderDialog, event)) {
    stopOrderAutoScroll();
    orderDragPointer = null;
    clearOrderDropPreview();
  }
});
orderDialog.addEventListener('drop', finishOrderDrag);
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
  closeAiSuggestionsMenu();
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
orderDialog.addEventListener('close', finishOrderDrag);

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

window.addEventListener('scroll', updatePageScrollButtons, { passive: true });
window.addEventListener('resize', updatePageScrollButtons, { passive: true });
scrollToTopButton.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
});
scrollToBottomButton.addEventListener('click', () => {
  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
});
updatePageScrollButtons();

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
