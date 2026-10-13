import { jsPDF } from 'jspdf';
import type { SessionData, StoredPhoto } from './storage';

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const margin = 12;
const gap = 5;
const top = 23;
const rowH = 85;
const cellW = (PAGE_WIDTH - margin * 2 - gap) / 2;
const imageH = cellW * 2 / 3;
const captionTopOffset = imageH + 3;
const captionMaxLines = 4;
const captionFontSize = 8;
const fontName = 'NotoSans';

function contain(img: HTMLImageElement, width: number, height: number) {
  const ratio = Math.min(width / img.naturalWidth, height / img.naturalHeight);
  return { width: img.naturalWidth * ratio, height: img.naturalHeight * ratio };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Egy kép nem olvasható.'));
    image.src = src;
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function loadPdfFont(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error('A PDF betűkészlete nem tölthető be.');
  return toBase64(new Uint8Array(await response.arrayBuffer()));
}

async function registerFonts(doc: jsPDF): Promise<void> {
  const [regular, bold] = await Promise.all([
    loadPdfFont('/fonts/NotoSans-Regular.ttf'),
    loadPdfFont('/fonts/NotoSans-Bold.ttf'),
  ]);
  doc.addFileToVFS('NotoSans-Regular.ttf', regular);
  doc.addFont('NotoSans-Regular.ttf', fontName, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', bold);
  doc.addFont('NotoSans-Bold.ttf', fontName, 'bold');
}

function fitCaptionLines(doc: jsPDF, caption: string, maxWidth: number): string[] {
  const lines = doc.splitTextToSize(caption, maxWidth) as string[];
  if (lines.length <= captionMaxLines) return lines;

  const visibleLines = lines.slice(0, captionMaxLines);
  let lastLine = visibleLines[captionMaxLines - 1].trimEnd();
  while (lastLine && doc.getTextWidth(`${lastLine}…`) > maxWidth) {
    lastLine = lastLine.slice(0, -1).trimEnd();
  }
  visibleLines[captionMaxLines - 1] = `${lastLine}…`;
  return visibleLines;
}

export function formatAddress(value: string): string {
  const kinds = new Set([
    'utca', 'út', 'tér', 'körút', 'köz', 'sor', 'sétány', 'dűlő', 'liget',
    'part', 'rakpart', 'lejtő', 'forduló', 'átjáró', 'sikátor', 'fasor',
  ]);
  return value.trim().split(/\s+/).map((word) =>
    /^\d|\//.test(word)
      ? word
      : kinds.has(word.toLowerCase().replace(/[.,]/g, ''))
        ? word.toLowerCase()
        : word[0]?.toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

async function addPhoto(doc: jsPDF, photo: StoredPhoto, index: number): Promise<void> {
  const column = index % 2;
  const row = Math.floor(index / 2);
  const x = margin + column * (cellW + gap);
  const y = top + row * rowH;
  const image = await loadImage(photo.dataUrl);
  const size = contain(image, cellW, imageH);

  doc.setFillColor(242, 242, 242);
  doc.rect(x, y, cellW, imageH, 'F');
  doc.addImage(
    photo.dataUrl,
    'JPEG',
    x + (cellW - size.width) / 2,
    y + (imageH - size.height) / 2,
    size.width,
    size.height,
    undefined,
    'FAST',
  );

  doc.setFont(fontName, 'bold');
  doc.setFontSize(captionFontSize);
  const caption = photo.caption.trim();
  if (!caption) return;

  const lines = fitCaptionLines(doc, caption, cellW - 4);
  doc.text(lines, x + cellW / 2, y + captionTopOffset, {
    align: 'center',
    lineHeightFactor: 1.1,
  });
}

export async function buildPdf(data: SessionData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  await registerFonts(doc);

  const pageCount = Math.ceil(data.photos.length / 6);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (pageIndex) doc.addPage();

    doc.setFont(fontName, 'bold');
    doc.setFontSize(9);
    const header = `${formatAddress(data.address)}    hrsz: ${data.hrsz}`;
    const headerLines = doc.splitTextToSize(header, PAGE_WIDTH - margin * 2).slice(0, 2);
    doc.text(headerLines, PAGE_WIDTH / 2, 10, {
      align: 'center',
      lineHeightFactor: 1.1,
    });
    doc.setDrawColor(205);
    doc.line(margin, 19, PAGE_WIDTH - margin, 19);

    const pagePhotos = data.photos.slice(pageIndex * 6, pageIndex * 6 + 6);
    for (let photoIndex = 0; photoIndex < pagePhotos.length; photoIndex += 1) {
      await addPhoto(doc, pagePhotos[photoIndex], photoIndex);
    }

    doc.setFont(fontName, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(String(pageIndex + 1), PAGE_WIDTH - margin, PAGE_HEIGHT - 7, { align: 'right' });
    doc.setTextColor(0);
  }
  return doc;
}
