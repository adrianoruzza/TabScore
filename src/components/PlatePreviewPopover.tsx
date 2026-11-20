import {
  Check,
  FileText,
  ImagePlus,
  Maximize2,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Plate } from '../types/gradebook';
import { processPlateAttachmentFile } from '../utils/imageUpload';
import {
  cancelCanvasPdfRender,
  disposePdfDocument,
  isPdfDataUrl,
  isPdfRenderCancelledError,
  loadPdfDocumentFromDataUrl,
  renderPdfPageToCanvas,
  type PdfDocumentProxy,
} from '../utils/pdfViewer';

interface PlatePreviewPopoverProps {
  plate: Plate;
  anchorRect: DOMRect;
  onUpdateTitle: (newTitle: string) => void;
  onUpdateImage: (
    image: { dataUrl: string; fileName: string } | null
  ) => boolean;
  onOpenFullViewer: () => void;
  onClose: () => void;
}

export function PlatePreviewPopover({
  plate,
  anchorRect,
  onUpdateTitle,
  onUpdateImage,
  onOpenFullViewer,
  onClose,
}: PlatePreviewPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
  });
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(plate.title);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [imgError, setImgError] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);

  const isPdf = isPdfDataUrl(plate.imageDataUrl);

  useEffect(() => {
    setTitleDraft(plate.title);
    setEditingTitle(false);
    setError('');
    setImgError(false);
  }, [plate.id, plate.title, plate.imageDataUrl]);

  useEffect(() => {
    const dataUrl = plate.imageDataUrl;
    if (!dataUrl || !isPdfDataUrl(dataUrl)) {
      setPdfPageCount(null);
      setPdfPreviewLoading(false);
      return;
    }

    let cancelled = false;
    let activeDoc: PdfDocumentProxy | null = null;
    const canvasAtStart = pdfCanvasRef.current;
    setPdfPreviewLoading(true);
    setPdfPageCount(null);

    void (async () => {
      try {
        const doc = await loadPdfDocumentFromDataUrl(dataUrl);
        if (cancelled) {
          await disposePdfDocument(doc);
          return;
        }
        activeDoc = doc;
        setPdfPageCount(doc.numPages);
        const canvas = pdfCanvasRef.current;
        if (canvas) {
          await renderPdfPageToCanvas(doc, 1, canvas, 300, 2.5, () => cancelled);
        }
      } catch (err) {
        if (!cancelled && !isPdfRenderCancelledError(err)) {
          setError(
            err instanceof Error
              ? err.message
              : 'Impossibile visualizzare il file PDF allegato.'
          );
        }
      } finally {
        if (!cancelled) {
          setPdfPreviewLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelCanvasPdfRender(pdfCanvasRef.current ?? canvasAtStart);
      if (activeDoc) {
        void disposePdfDocument(activeDoc);
      }
    };
  }, [plate.id, plate.imageDataUrl]);

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchorRect.left;
    if (left + rect.width > vw - 12) {
      left = Math.max(12, vw - rect.width - 12);
    }

    let top = anchorRect.bottom + 6;
    if (top + rect.height > vh - 12) {
      const aboveTop = anchorRect.top - rect.height - 6;
      top = aboveTop >= 12 ? aboveTop : Math.max(12, vh - rect.height - 12);
    }

    setPos({ top, left });
  }, [anchorRect, plate.imageDataUrl, editingTitle, error]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        !target?.closest(`[data-plate-preview-trigger="${plate.id}"]`)
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose, plate.id]);

  const handleSelectedFile = async (file: File | undefined | null) => {
    if (!file) return;
    setError('');
    setIsProcessing(true);
    try {
      const processed = await processPlateAttachmentFile(file);
      const saved = onUpdateImage({
        dataUrl: processed.dataUrl,
        fileName: processed.fileName,
      });
      if (!saved) {
        setError(
          'Spazio di archiviazione locale esaurito. Rimuovi qualche allegato o usa un file più leggero.'
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Errore durante il caricamento del file.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    void handleSelectedFile(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    void handleSelectedFile(file);
  };

  const saveTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== plate.title) {
      onUpdateTitle(trimmed);
    }
    setEditingTitle(false);
  };

  const popoverNode = (
    <div
      ref={popoverRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-50 w-[min(340px,calc(100vw-20px))] rounded-lg border border-slate-300 bg-white p-3.5 shadow-2xl"
      role="dialog"
      aria-label={`Anteprima Tavola ${plate.number}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-extrabold text-blue-900">
              T{plate.number}
            </span>
            <span className="text-[11px] font-medium text-slate-400">·</span>
            <span className="text-[11px] font-medium text-slate-500">
              Anteprima tavola
            </span>
          </div>

          {editingTitle ? (
            <div className="mt-1.5 flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setTitleDraft(plate.title);
                    setEditingTitle(false);
                  }
                }}
                className="h-8 min-w-0 flex-1 rounded border border-blue-600 px-2 text-xs font-medium text-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={saveTitle}
                title="Salva titolo"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-blue-700 text-white hover:bg-blue-800"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="mt-0.5 flex items-start justify-between gap-1.5">
              <div className="text-xs font-semibold leading-snug text-slate-900">
                {plate.title}
              </div>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(plate.title);
                  setEditingTitle(true);
                }}
                title="Modifica titolo tavola"
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-700"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Chiudi anteprima"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Attachment Preview Area (PNG / JPG / PDF) */}
      <div className="mt-3 space-y-2.5">
        {plate.imageDataUrl ? (
          <div className="space-y-2">
            <div className="group relative overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              {isPdf ? (
                <div
                  onClick={() => {
                    onClose();
                    onOpenFullViewer();
                  }}
                  className="relative flex max-h-[220px] min-h-[140px] w-full cursor-zoom-in items-center justify-center overflow-hidden bg-slate-100 p-2"
                >
                  <canvas
                    ref={pdfCanvasRef}
                    className="max-h-[204px] max-w-full rounded border border-slate-200 bg-white object-contain shadow-sm"
                  />
                  {pdfPreviewLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-xs font-medium text-slate-600">
                      Caricamento anteprima PDF...
                    </div>
                  )}
                  <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded border border-slate-300 bg-white/95 px-1.5 py-0.5 text-[10px] font-bold text-slate-800 shadow-sm">
                    <FileText className="h-3 w-3 text-rose-600" />
                    <span>
                      PDF
                      {pdfPageCount
                        ? ` · ${pdfPageCount} ${pdfPageCount === 1 ? 'pag.' : 'pagg.'}`
                        : ''}
                    </span>
                  </div>
                </div>
              ) : imgError ? (
                <div className="flex min-h-[120px] items-center justify-center bg-rose-50/70 px-4 py-5 text-center text-xs font-medium text-rose-700">
                  Anteprima immagine non leggibile. Usa &quot;Sostituisci&quot; per ricaricare il file.
                </div>
              ) : (
                <img
                  src={plate.imageDataUrl}
                  alt={`Anteprima ${plate.title}`}
                  onError={() => setImgError(true)}
                  onClick={() => {
                    onClose();
                    onOpenFullViewer();
                  }}
                  className="max-h-[220px] w-full cursor-zoom-in object-contain"
                />
              )}
              {!imgError && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenFullViewer();
                  }}
                  title={isPdf ? 'Apri PDF a schermo intero' : 'Ingrandisci immagine'}
                  className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded border border-slate-300 bg-white/95 px-2 py-1 text-[11px] font-medium text-slate-800 shadow-sm hover:bg-white"
                >
                  <Maximize2 className="h-3 w-3" />
                  {isPdf ? 'Apri PDF' : 'Ingrandisci'}
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-slate-500">
                {plate.imageName || (isPdf ? 'Documento PDF allegato' : 'Immagine allegata')}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-8 items-center gap-1 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" />
                  Sostituisci
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    onUpdateImage(null);
                    setError('');
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Rimuovi
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-md border border-dashed px-4 py-5 text-center transition-colors ${
              isDraggingFile
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-300 bg-slate-50/70'
            }`}
          >
            <ImagePlus className="h-6 w-6 text-slate-400" />
            <p className="mt-1.5 text-xs font-medium text-slate-700">
              Nessun file associato
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Carica o trascina un’anteprima PNG, JPG o PDF
            </p>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {isProcessing ? 'Caricamento...' : 'Carica (PNG / JPG / PDF)'}
            </button>
          </div>
        )}

        {error && (
          <p className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700">
            {error}
          </p>
        )}

        {plate.notes && (
          <div className="border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-700">Annotazioni: </span>
            {plate.notes}
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return popoverNode;
  }
  return createPortal(popoverNode, document.body);
}
