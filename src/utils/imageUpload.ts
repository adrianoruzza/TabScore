import {
  decodeBase64DataUrlToBytes,
  disposePdfDocument,
  hasPdfMagicHeader,
  loadPdfDocumentFromBytes,
} from './pdfViewer';

const ACCEPTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
]);
const ACCEPTED_ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/pdf',
]);

const MAX_DIMENSION_PX = 1400;
const RAW_PASSTHROUGH_MAX_BYTES = 180_000;
const TARGET_MAX_BYTES = 420_000;

// Limite cautelativo per mantenere l'archivio compatibile con la quota localStorage (~5 MB)
export const MAX_PDF_BYTES = 2_500_000;

export function isSupportedPlateImageFile(file: File): boolean {
  if (ACCEPTED_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
    return true;
  }
  return /\.(png|jpe?g)$/i.test(file.name);
}

export function isPdfAttachmentFile(file: File): boolean {
  return (
    file.type.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.name)
  );
}

export function isSupportedPlateAttachmentFile(file: File): boolean {
  if (ACCEPTED_ATTACHMENT_MIME_TYPES.has(file.type.toLowerCase())) {
    return true;
  }
  return /\.(png|jpe?g|pdf)$/i.test(file.name);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Impossibile leggere il file selezionato.'));
      }
    };
    reader.onerror = () =>
      reject(new Error('Errore durante la lettura del file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('File immagine non valido o danneggiato.'));
    img.src = src;
  });
}

function normalizePdfDataUrl(rawDataUrl: string): string {
  const commaIdx = rawDataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Contenuto PDF non valido.');
  }
  const base64Part = rawDataUrl.slice(commaIdx + 1);
  return `data:application/pdf;base64,${base64Part}`;
}

export async function processPlateImageFile(
  file: File
): Promise<{ dataUrl: string; fileName: string }> {
  if (!isSupportedPlateImageFile(file)) {
    throw new Error('Formato non supportato. Seleziona un file PNG o JPG.');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);

  const longestSide = Math.max(img.naturalWidth, img.naturalHeight);
  if (file.size <= RAW_PASSTHROUGH_MAX_BYTES && longestSide <= MAX_DIMENSION_PX) {
    return {
      dataUrl: rawDataUrl,
      fileName: file.name,
    };
  }

  const scale = longestSide > MAX_DIMENSION_PX ? MAX_DIMENSION_PX / longestSide : 1;
  const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
  const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: rawDataUrl, fileName: file.name };
  }

  // Paint white backdrop before drawing in case a transparent PNG is exported as JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const isPng =
    file.type.toLowerCase() === 'image/png' || /\.png$/i.test(file.name);

  if (isPng) {
    const pngDataUrl = canvas.toDataURL('image/png');
    if (pngDataUrl.length <= TARGET_MAX_BYTES) {
      return { dataUrl: pngDataUrl, fileName: file.name };
    }
  }

  let optimized = canvas.toDataURL('image/jpeg', 0.84);
  if (optimized.length > TARGET_MAX_BYTES) {
    optimized = canvas.toDataURL('image/jpeg', 0.72);
  }
  if (optimized.length > TARGET_MAX_BYTES) {
    optimized = canvas.toDataURL('image/jpeg', 0.6);
  }

  return {
    dataUrl: optimized,
    fileName: file.name,
  };
}

export async function processPlateAttachmentFile(
  file: File
): Promise<{ dataUrl: string; fileName: string; kind: 'image' | 'pdf'; numPages?: number }> {
  if (!isSupportedPlateAttachmentFile(file)) {
    throw new Error(
      'Formato non supportato. Seleziona un file PNG, JPG o PDF.'
    );
  }

  if (isPdfAttachmentFile(file)) {
    if (file.size === 0) {
      throw new Error('Il file PDF selezionato è vuoto.');
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(
        `Il file PDF supera il limite consentito (${(MAX_PDF_BYTES / 1_000_000).toFixed(1).replace('.', ',')} MB) per il salvataggio nell'archivio.`
      );
    }

    const rawDataUrl = await readFileAsDataUrl(file);
    const pdfDataUrl = normalizePdfDataUrl(rawDataUrl);
    const bytes = decodeBase64DataUrlToBytes(pdfDataUrl);
    if (!hasPdfMagicHeader(bytes)) {
      throw new Error('Il file selezionato non è un documento PDF valido.');
    }

    const pdfDoc = await loadPdfDocumentFromBytes(bytes);
    const numPages = pdfDoc.numPages;
    await disposePdfDocument(pdfDoc);

    return {
      dataUrl: pdfDataUrl,
      fileName: /\.pdf$/i.test(file.name) ? file.name : `${file.name}.pdf`,
      kind: 'pdf',
      numPages,
    };
  }

  const processedImg = await processPlateImageFile(file);
  return {
    ...processedImg,
    kind: 'image',
  };
}
