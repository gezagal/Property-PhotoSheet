export async function prepareImage(
  source: string,
  maxBytes: number,
  maxDimension = 1200,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Egy kép nem olvasható.'));
    element.src = source;
  });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A képtömörítés nem támogatott ebben a böngészőben.');

  let dimension = Math.min(maxDimension, Math.max(image.naturalWidth, image.naturalHeight));
  try {
    while (dimension >= 1) {
      const ratio = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.84, 0.72, 0.6, 0.48]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const bytes = base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
        if (bytes <= maxBytes) return { dataUrl, width: canvas.width, height: canvas.height };
      }
      dimension = Math.floor(dimension * 0.8);
    }
    throw new Error('A kép a megadott méretkorlátra nem tömöríthető.');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
