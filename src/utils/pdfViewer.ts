import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerConfigured = false;

export function ensurePdfJsWorker(): void {
  if (workerConfigured) return;
  if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    workerConfigured = true;
  }
}

export function isPdfDataUrl(dataUrl: string | undefined | null): boolean {
  if (!dataUrl) return false;
  return /^data:application\/pdf(?:;[^,]*)?;base64,/i.test(dataUrl);
}

export function decodeBase64DataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Dati PDF non validi.');
  }
  const base64 = dataUrl.slice(commaIdx + 1).replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function hasPdfMagicHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  // "%PDF-" in ASCII
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

export type PdfDocumentProxy = Awaited<
  ReturnType<typeof pdfjsLib.getDocument>['promise']
>;

type PdfRenderTask = {
  cancel: () => void;
  promise: Promise<unknown>;
};

const activeCanvasRenderTasks = new WeakMap<HTMLCanvasElement, PdfRenderTask>();
const canvasRenderTokens = new WeakMap<HTMLCanvasElement, number>();

export function isPdfRenderCancelledError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String((err as { name?: unknown }).name ?? '') : '';
  const message =
    'message' in err ? String((err as { message?: unknown }).message ?? '') : '';
  return (
    name === 'RenderingCancelledException' ||
    name === 'AbortException' ||
    message.toLowerCase().includes('rendering cancelled')
  );
}

export function cancelCanvasPdfRender(
  canvas: HTMLCanvasElement | null | undefined
): void {
  if (!canvas) return;
  const nextToken = (canvasRenderTokens.get(canvas) ?? 0) + 1;
  canvasRenderTokens.set(canvas, nextToken);
  const existing = activeCanvasRenderTasks.get(canvas);
  if (existing) {
    try {
      existing.cancel();
    } catch {
      // Ignore cancellation errors if already settled
    }
    activeCanvasRenderTasks.delete(canvas);
  }
}

export async function loadPdfDocumentFromBytes(
  bytes: Uint8Array
): Promise<PdfDocumentProxy> {
  ensurePdfJsWorker();
  // Pass a copy because PDF.js transfers the underlying ArrayBuffer to its worker
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const task = pdfjsLib.getDocument({ data: copy });
  try {
    return await task.promise;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('password')) {
      throw new Error(
        'Il file PDF è protetto da password e non può essere aperto.'
      );
    }
    throw new Error('Il file PDF selezionato non è valido o è danneggiato.');
  }
}

export async function loadPdfDocumentFromDataUrl(
  dataUrl: string
): Promise<PdfDocumentProxy> {
  const bytes = decodeBase64DataUrlToBytes(dataUrl);
  if (!hasPdfMagicHeader(bytes)) {
    throw new Error('Il file PDF allegato non è valido o è danneggiato.');
  }
  return loadPdfDocumentFromBytes(bytes);
}

export async function disposePdfDocument(doc: PdfDocumentProxy): Promise<void> {
  try {
    await doc.loadingTask.destroy();
  } catch {
    // Ignore cleanup errors on already-terminated tasks
  }
}

export async function renderPdfPageToCanvas(
  pdfDoc: PdfDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetCssWidth: number,
  maxDevicePixelRatio = 2.5,
  isCancelled?: () => boolean
): Promise<{ width: number; height: number } | null> {
  const myToken = (canvasRenderTokens.get(canvas) ?? 0) + 1;
  canvasRenderTokens.set(canvas, myToken);

  const previousTask = activeCanvasRenderTasks.get(canvas);
  if (previousTask) {
    try {
      previousTask.cancel();
    } catch {
      // Ignore cancel errors
    }
    try {
      await previousTask.promise;
    } catch {
      // Previous render cancelled or failed; wait for PDF.js to release canvas
    }
    if (activeCanvasRenderTasks.get(canvas) === previousTask) {
      activeCanvasRenderTasks.delete(canvas);
    }
  }

  const isStale = () =>
    canvasRenderTokens.get(canvas) !== myToken || Boolean(isCancelled?.());

  if (isStale()) return null;

  const safePage = Math.max(1, Math.min(pdfDoc.numPages, pageNumber));
  const page = await pdfDoc.getPage(safePage);

  if (isStale()) return null;

  const baseViewport = page.getViewport({ scale: 1 });
  const cssScale = Math.max(0.2, targetCssWidth / Math.max(1, baseViewport.width));
  const dpr =
    typeof window !== 'undefined'
      ? Math.min(maxDevicePixelRatio, window.devicePixelRatio || 1)
      : 1;
  const renderViewport = page.getViewport({ scale: cssScale * dpr });

  canvas.width = Math.max(1, Math.floor(renderViewport.width));
  canvas.height = Math.max(1, Math.floor(renderViewport.height));
  canvas.style.width = `${Math.max(1, Math.round(renderViewport.width / dpr))}px`;
  canvas.style.height = `${Math.max(1, Math.round(renderViewport.height / dpr))}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Contesto grafico canvas non disponibile.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({
    canvasContext: ctx,
    viewport: renderViewport,
    canvas,
  });
  activeCanvasRenderTasks.set(canvas, renderTask);

  try {
    await renderTask.promise;
  } catch (err) {
    if (isStale() || isPdfRenderCancelledError(err)) {
      return null;
    }
    throw err;
  } finally {
    if (activeCanvasRenderTasks.get(canvas) === renderTask) {
      activeCanvasRenderTasks.delete(canvas);
    }
  }

  if (isStale()) return null;

  return {
    width: Math.round(renderViewport.width / dpr),
    height: Math.round(renderViewport.height / dpr),
  };
}
