import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { PDFDocument, rgb } from 'pdf-lib';
import { Capacitor, registerPlugin } from '@capacitor/core';
const NativePdfRenderer = registerPlugin('NativePdfRenderer');
const bytesToBase64 = (bytes) => {
  let binary = '';
  for (let i=0;i<bytes.length;i+=16384) {
    binary += String.fromCharCode(...bytes.subarray(i,i+16384));
  }
  return btoa(binary);
};
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  FileText, Upload, Type, Eraser, PenTool, Highlighter,
  Trash2, RotateCw, Download, Share2, ChevronRight, ChevronLeft,
  AlignRight, AlignCenter, AlignLeft, Check, X, Plus, CheckSquare, Palette
} from 'lucide-react';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const TEXT_COLORS = [
  { name: 'أسود', value: '#000000' },
  { name: 'أزرق داكن', value: '#1e3a8a' },
  { name: 'أزرق', value: '#2563eb' },
  { name: 'أحمر', value: '#dc2626' },
  { name: 'أخضر', value: '#16a34a' },
  { name: 'بنفسجي', value: '#7c3aed' },
  { name: 'رمادي', value: '#475569' },
  { name: 'أبيض', value: '#ffffff' }
];

const BG_COLORS = [
  { name: 'أبيض', value: '#ffffff' },
  { name: 'شفاف', value: 'transparent' },
  { name: 'أصفر فاتح', value: '#fef08a' },
  { name: 'أزرق فاتح', value: '#dbeafe' },
  { name: 'أخضر فاتح', value: '#dcfce7' },
  { name: 'أسود', value: '#000000' }
];

export default function App() {
  const [pdfBytes, setPdfBytes] = useState(null);
  const [fileName, setFileName] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageViewport, setPageViewport] = useState({ width: 595, height: 842 });
  const [activeTool, setActiveTool] = useState('select'); // select | smartText | addText | whiteout | highlight
  const [detectedItems, setDetectedItems] = useState([]);

  // Multi-select state for detected PDF text blocks
  const [selectedSmartIds, setSelectedSmartIds] = useState([]);

  // Edits stored per page: { [pageNum]: [ { id, type, x, y, width, height, text, fontSize, color, align, bgColor, dataUrl } ] }
  const [edits, setEdits] = useState({});
  const [selectedEditId, setSelectedEditId] = useState(null);

  // Modal states
  const [editingSmartGroup, setEditingSmartGroup] = useState(null);
  const [showSignModal, setShowSignModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [saveAsName, setSaveAsName] = useState('');
  const [showSaveAs, setShowSaveAs] = useState(false);
  const toastTimeoutRef = useRef(null);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const signCanvasRef = useRef(null);
  const [isDrawingSign, setIsDrawingSign] = useState(false);

  // Dragging state
  const [dragging, setDragging] = useState(null);

  const showToast = (msg) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setStatusMsg(msg);
    toastTimeoutRef.current = setTimeout(() => setStatusMsg(''), 6500);
  };

  // Load PDF File
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    setPdfBytes(bytes);
    setSaveAsName('');
    setFileName(file.name.replace(/\.pdf$/i, ''));
    setEdits({});
    setCurrentPage(1);
    setSelectedEditId(null);
    setSelectedSmartIds([]);
    showToast('تم فتح الملف بنجاح');
  };

  // Render Current Page & Extract Text Bounding Boxes
  useEffect(() => {
    if (!pdfBytes) return;
    let cancelled = false;

    const renderPage = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setNumPages(pdf.numPages);

        const page = await pdf.getPage(currentPage);
        const baseViewport = page.getViewport({ scale: 1 });
        setPageViewport({ width: baseViewport.width, height: baseViewport.height });

        const scale = 2.0;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        if (Capacitor.isNativePlatform()) {
          const result = await NativePdfRenderer.renderPdf({
            base64: bytesToBase64(pdfBytes),
            pageIndex: currentPage - 1
          });
          const nativeImage = new Image();
          await new Promise((resolve, reject) => {
            nativeImage.onload = resolve;
            nativeImage.onerror = reject;
            nativeImage.src = 'data:image/png;base64,' + result.pngBase64;
          });
          if (cancelled) return;
          ctx.drawImage(nativeImage, 0, 0, canvas.width, canvas.height);
        } else {
          await page.render({ canvasContext: ctx, viewport }).promise;
        }

        // Extract text items for Smart Text Editing
        const textContent = await page.getTextContent();
        const items = textContent.items
          .filter((item) => item.str && item.str.trim().length > 0)
          .map((item, idx) => {
            const tx = pdfjsLib.Util.transform(baseViewport.transform, item.transform);
            const fontHeight = Math.hypot(tx[2], tx[3]);
            const x = tx[4];
            const y = tx[5] - fontHeight;
            const width = item.width || item.str.length * (fontHeight * 0.5);
            return {
              id: `txt-${currentPage}-${idx}`,
              str: item.str,
              x: Math.max(0, x),
              y: Math.max(0, y),
              width: Math.max(16, width),
              height: Math.max(12, fontHeight * 1.25),
              fontSize: Math.round(fontHeight)
            };
          });
        if (!cancelled) {
          setDetectedItems(items);
          setSelectedSmartIds([]);
        }
      } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء عرض الصفحة');
      }
    };

    renderPage();
    return () => { cancelled = true; };
  }, [pdfBytes, currentPage]);

  // Add edit helper
  const addPageEdit = (pageNum, editObj) => {
    setEdits((prev) => ({
      ...prev,
      [pageNum]: [...(prev[pageNum] || []), editObj]
    }));
    setSelectedEditId(editObj.id);
  };

  const updatePageEdit = (pageNum, id, patch) => {
    setEdits((prev) => ({
      ...prev,
      [pageNum]: (prev[pageNum] || []).map((item) =>
        item.id === id ? { ...item, ...patch } : item
      )
    }));
  };

  const deletePageEdit = (pageNum, id) => {
    setEdits((prev) => ({
      ...prev,
      [pageNum]: (prev[pageNum] || []).filter((item) => item.id !== id)
    }));
    if (selectedEditId === id) setSelectedEditId(null);
  };

  // Handle tap on PDF canvas for quick tools
  const handleCanvasClick = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = pageViewport.width / rect.width;
    const scaleY = pageViewport.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (activeTool === 'addText') {
      const newEdit = {
        id: Date.now().toString(),
        type: 'text',
        x: Math.max(20, x - 75),
        y: Math.max(20, y - 16),
        width: 190,
        height: 36,
        text: 'اكتب النص هنا',
        fontSize: 16,
        color: '#000000',
        align: 'center',
        bgColor: 'transparent'
      };
      addPageEdit(currentPage, newEdit);
      setActiveTool('select');
    } else if (activeTool === 'whiteout') {
      const newEdit = {
        id: Date.now().toString(),
        type: 'whiteout',
        x: Math.max(10, x - 50),
        y: Math.max(10, y - 15),
        width: 110,
        height: 28,
        bgColor: '#ffffff'
      };
      addPageEdit(currentPage, newEdit);
      setActiveTool('select');
    } else if (activeTool === 'highlight') {
      const newEdit = {
        id: Date.now().toString(),
        type: 'highlight',
        x: Math.max(10, x - 60),
        y: Math.max(10, y - 10),
        width: 130,
        height: 20,
        bgColor: 'rgba(250, 204, 21, 0.45)'
      };
      addPageEdit(currentPage, newEdit);
      setActiveTool('select');
    } else {
      setSelectedEditId(null);
    }
  };

  // Toggle selection of one or multiple text blocks on the PDF
  const toggleSmartItemSelect = (item, e) => {
    e.stopPropagation();
    setSelectedSmartIds((prev) =>
      prev.includes(item.id)
        ? prev.filter((id) => id !== item.id)
        : [...prev, item.id]
    );
  };

  // Open Smart Group Editor for all selected text blocks
  const openSmartGroupEditor = () => {
    const chosen = detectedItems.filter((it) => selectedSmartIds.includes(it.id));
    if (chosen.length === 0) return;

    // Sort top-to-bottom, then right-to-left (for Arabic) or left-to-right
    const sorted = [...chosen].sort((a, b) => {
      if (Math.abs(a.y - b.y) > 8) return a.y - b.y;
      return b.x - a.x;
    });

    const minX = Math.min(...chosen.map((i) => i.x));
    const minY = Math.min(...chosen.map((i) => i.y));
    const maxX = Math.max(...chosen.map((i) => i.x + i.width));
    const maxY = Math.max(...chosen.map((i) => i.y + i.height));
    const avgFont = Math.round(chosen.reduce((acc, i) => acc + i.fontSize, 0) / chosen.length);

    const combinedText = sorted.map((i) => i.str).join(' ');

    setEditingSmartGroup({
      items: chosen,
      minX,
      minY,
      width: maxX - minX,
      height: maxY - minY,
      newText: combinedText,
      fontSize: avgFont || 14,
      color: '#000000',
      bgColor: '#ffffff',
      align: 'center',
      centerOnPage: false
    });
  };

  // Delete all selected text blocks immediately
  const deleteSelectedSmartItems = () => {
    showToast('لا يمكن حذف النص الأصلي بأمان من الملف الحالي، ولم يتم تعديل الصفحة.');
  };

  const applySmartGroupEdit = () => {
    if (!editingSmartGroup) return;
    const group = editingSmartGroup;
    const width = Math.max(20, group.centerOnPage ? pageViewport.width - 40 : group.width + 8);
    const x = group.centerOnPage ? 20 : Math.max(0, group.minX - 4);
    const minimumHeight = Math.max(24, group.newText.split('\n').length * group.fontSize * 1.4);
    const height = Math.max(group.height + 8, minimumHeight);
    // This is an editable visual draft, not a change to embedded source PDF text.
    // A white background masks the original; never silently claim font preservation.
    const overlay = {
      id: 'draft-' + Date.now(), type: 'text', x, y: Math.max(0, group.minY - 4),
      width: Math.min(width, pageViewport.width - x),
      height, text: group.newText, fontSize: group.fontSize,
      color: group.color, bgColor: '#ffffff', align: group.align,
      isVisualReplacement: true
    };
    addPageEdit(currentPage, overlay);
    setEditingSmartGroup(null);
    setSelectedSmartIds([]);
    setActiveTool('select');
    showToast('ظهرت المعاينة على الصفحة. هذه طبقة مرئية فوق الأصل وليست تعديلًا للخط المضمّن. راجعها قبل حفظ نسخة جديدة.');
  };

  // Touch / Pointer Dragging for overlays
  const startDrag = (e, edit, handle = 'move') => {
    e.stopPropagation();
    setSelectedEditId(edit.id);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setDragging({
      id: edit.id,
      handle,
      startX: clientX,
      startY: clientY,
      origX: edit.x,
      origY: edit.y,
      origW: edit.width,
      origH: edit.height
    });
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const scaleX = pageViewport.width / rect.width;
      const scaleY = pageViewport.height / rect.height;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = (clientX - dragging.startX) * scaleX;
      const dy = (clientY - dragging.startY) * scaleY;

      if (dragging.handle === 'move') {
        updatePageEdit(currentPage, dragging.id, {
          x: Math.max(0, Math.min(pageViewport.width - 20, dragging.origX + dx)),
          y: Math.max(0, Math.min(pageViewport.height - 20, dragging.origY + dy))
        });
      } else if (dragging.handle === 'resize') {
        updatePageEdit(currentPage, dragging.id, {
          width: Math.max(30, dragging.origW + dx),
          height: Math.max(16, dragging.origH + dy)
        });
      }
    };
    const onEnd = () => setDragging(null);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [dragging, currentPage, pageViewport]);

  // Signature Pad handlers
  const startSignDraw = (e) => {
    const canvas = signCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    setIsDrawingSign(true);
  };

  const drawSign = (e) => {
    if (!isDrawingSign || !signCanvasRef.current) return;
    const canvas = signCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const ctx = canvas.getContext('2d');
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const saveSignature = () => {
    const canvas = signCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    addPageEdit(currentPage, {
      id: Date.now().toString(),
      type: 'signature',
      x: pageViewport.width / 2 - 75,
      y: pageViewport.height / 2 - 35,
      width: 150,
      height: 70,
      dataUrl
    });
    setShowSignModal(false);
    setActiveTool('select');
    showToast('تمت إضافة التوقيع');
  };

  // Rotate or Delete Current Page
  const rotateCurrentPage = async () => {
    if (!pdfBytes) return;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPage(currentPage - 1);
    const currRot = page.getRotation().angle;
    page.setRotation({ type: 'degrees', angle: (currRot + 90) % 360 });
    const updated = await pdfDoc.save();
    setPdfBytes(updated);
    showToast('تم تدوير الصفحة 90 درجة');
  };

  const deleteCurrentPage = async () => {
    if (!pdfBytes || numPages <= 1) {
      showToast('لا يمكن حذف الصفحة الوحيدة');
      return;
    }
    const pdfDoc = await PDFDocument.load(pdfBytes);
    pdfDoc.removePage(currentPage - 1);
    const updated = await pdfDoc.save();
    setPdfBytes(updated);
    setCurrentPage((p) => Math.max(1, p - 1));
    showToast('تم حذف الصفحة');
  };

  // Render Text with full Arabic RTL & Multi-line support onto high-res PNG
  const renderTextAsCrispPng = (edit) => {
    const scale = 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(edit.width * scale);
    canvas.height = Math.ceil(edit.height * scale);
    const ctx = canvas.getContext('2d');

    if (edit.bgColor && edit.bgColor !== 'transparent') {
      ctx.fillStyle = edit.bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.fillStyle = edit.color || '#000000';
    ctx.font = `bold ${edit.fontSize * scale}px Cairo, Arial, sans-serif`;
    ctx.textBaseline = 'middle';

    const isArabic = /[\u0600-\u06FF]/.test(edit.text);
    ctx.direction = isArabic ? 'rtl' : 'ltr';

    let drawX = canvas.width / 2;
    ctx.textAlign = 'center';
    if (edit.align === 'right') {
      drawX = canvas.width - 8 * scale;
      ctx.textAlign = 'right';
    } else if (edit.align === 'left') {
      drawX = 8 * scale;
      ctx.textAlign = 'left';
    }

    const lines = String(edit.text).split('\n');
    const lineHeight = edit.fontSize * scale * 1.25;
    const totalTextHeight = lines.length * lineHeight;
    let startY = (canvas.height - totalTextHeight) / 2 + lineHeight / 2;

    lines.forEach((line) => {
      ctx.fillText(line, drawX, startY);
      startY += lineHeight;
    });

    return canvas.toDataURL('image/png');
  };

  // Build final PDF bytes
  const generateModifiedPdfBytes = async () => {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    for (const [pageStr, pageEdits] of Object.entries(edits)) {
      const pIdx = parseInt(pageStr, 10) - 1;
      if (pIdx < 0 || pIdx >= pages.length) continue;
      const page = pages[pIdx];
      const { height: pHeight } = page.getSize();

      for (const edit of pageEdits) {
        const pdfY = pHeight - edit.y - edit.height;

        if (edit.type === 'whiteout') {
          page.drawRectangle({
            x: edit.x,
            y: pdfY,
            width: edit.width,
            height: edit.height,
            color: rgb(1, 1, 1)
          });
        } else if (edit.type === 'highlight') {
          page.drawRectangle({
            x: edit.x,
            y: pdfY,
            width: edit.width,
            height: edit.height,
            color: rgb(0.98, 0.8, 0.08),
            opacity: 0.4
          });
        } else if (edit.type === 'text') {
          const pngUrl = renderTextAsCrispPng(edit);
          const pngBytes = await fetch(pngUrl).then((r) => r.arrayBuffer());
          const img = await pdfDoc.embedPng(pngBytes);
          page.drawImage(img, {
            x: edit.x,
            y: pdfY,
            width: edit.width,
            height: edit.height
          });
        } else if (edit.type === 'signature' && edit.dataUrl) {
          const pngBytes = await fetch(edit.dataUrl).then((r) => r.arrayBuffer());
          const img = await pdfDoc.embedPng(pngBytes);
          page.drawImage(img, {
            x: edit.x,
            y: pdfY,
            width: edit.width,
            height: edit.height
          });
        }
      }
    }
    return await pdfDoc.save();
  };

  // Convert Uint8Array to Base64 for Capacitor Filesystem
  const uint8ToBase64 = (bytes) => {
    return bytesToBase64(bytes);
  };

  // Export & Save / Share (Supports both Native Android APK & Web)
  const handleExportPdf = async (shareAfterSave = false, chosenName = '') => {
    if (!pdfBytes) return;
    setIsExporting(true);
    try {
      const finalBytes = await generateModifiedPdfBytes();
      const cleanName = String(chosenName || `${fileName || 'document'}_edited_${Date.now()}`).trim().replace(/[\\\\/:*?\"<>|]/g, '_').replace(/\.pdf$/i, '');
      const outName = `${cleanName || 'document_edited'}.pdf`;

      if (Capacitor.isNativePlatform()) {
        const base64Data = uint8ToBase64(finalBytes);
        const savedFile = await Filesystem.writeFile({
          path: outName,
          data: base64Data,
          directory: Directory.Documents
        });

        if (shareAfterSave) {
          await Share.share({
            title: outName,
            url: savedFile.uri,
            dialogTitle: 'مشاركة ملف الـ PDF المعدل'
          });
        } else {
          showToast(`تم حفظ نسخة باسم ${outName} في Documents. راجع الملف الناتج قبل استخدامه.`);
        }
      } else {
        const blob = new Blob([finalBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('تم تحميل الملف المعدل بنجاح!');
      }
    } catch (err) {
      console.error(err);
      showToast('حدث خطأ أثناء حفظ الملف');
    } finally {
      setIsExporting(false);
    }
  };

  const currentEdits = edits[currentPage] || [];
  const selectedEdit = currentEdits.find((e) => e.id === selectedEditId);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top App Bar */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-white" />
          </div>
          <div className="truncate">
            <h1 className="font-bold text-xs leading-tight">PDF Studio Pro</h1>
            <p className="text-[10px] text-slate-400 truncate">
              {fileName ? `${fileName}.pdf` : 'محرر وقارئ PDF'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <label className="bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold px-2.5 py-2 rounded-xl cursor-pointer flex items-center gap-1 border border-slate-700">
            <Upload className="w-3.5 h-3.5 text-indigo-400" />
            <span>فتح</span>
            <input type="file" accept="application/pdf" onChange={handleFileUpload} className="hidden" />
          </label>

          {pdfBytes && (
            <>
              <button
                onClick={() => {setSaveAsName(`${fileName || 'document'}_edited`);setShowSaveAs(true);}}
                disabled={isExporting}
                className="bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition text-[11px] font-bold px-3 py-2 rounded-xl flex items-center gap-1 shadow-lg shadow-indigo-600/30"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isExporting ? '...' : 'حفظ باسم'}</span>
              </button>
              <button
                onClick={() => handleExportPdf(true)}
                disabled={isExporting}
                className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition text-[11px] font-bold p-2 rounded-xl flex items-center"
                title="مشاركة الملف"
              >
                <Share2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Toast Notification */}
      {statusMsg && (
        <div role="status" aria-live="polite" className="fixed left-4 right-4 bottom-24 z-[100] mx-auto max-w-lg bg-slate-800 border border-indigo-400 text-white text-sm leading-relaxed text-center font-semibold px-4 py-3 rounded-xl shadow-2xl whitespace-normal break-words">
          {statusMsg}
        </div>
      )}

      {/* Main Content Area */}
      {!pdfBytes ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 rounded-3xl bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center mb-5">
            <FileText className="w-10 h-10 text-indigo-400" />
          </div>
          <h2 className="text-xl font-extrabold mb-2">اقرأ وعدّل أي ملف PDF من موبايلك</h2>
          <p className="text-sm text-slate-400 max-w-xs mb-6 leading-relaxed">
            حدد كلمة أو سطور كاملة باللمس، امسحها أو عدّلها، غيّر الألوان، سنتر النصوص، أضف توقيعك، واحفظ أو شارك الملف فورًا.
          </p>
          <label className="bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition text-white font-bold px-6 py-3.5 rounded-2xl cursor-pointer flex items-center gap-2 shadow-xl shadow-indigo-600/30">
            <Upload className="w-5 h-5" />
            <span>اختر ملف PDF من الهاتف</span>
            <input type="file" accept="application/pdf" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      ) : (
        <>
          {/* Selected Overlay Element Properties Bar (Text Editor Style) */}
          {selectedEdit && (
            <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 space-y-2">
              {selectedEdit.type === 'text' ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      dir="auto"
                      value={selectedEdit.text}
                      onChange={(e) => updatePageEdit(currentPage, selectedEdit.id, { text: e.target.value })}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white flex-1 min-w-0"
                    />
                    <button
                      onClick={() => updatePageEdit(currentPage, selectedEdit.id, { fontSize: Math.max(8, selectedEdit.fontSize - 2) })}
                      className="px-2 py-1.5 bg-slate-800 rounded-lg text-xs font-bold"
                    >A-</button>
                    <button
                      onClick={() => updatePageEdit(currentPage, selectedEdit.id, { fontSize: Math.min(72, selectedEdit.fontSize + 2) })}
                      className="px-2 py-1.5 bg-slate-800 rounded-lg text-xs font-bold"
                    >A+</button>
                    <button
                      onClick={() => updatePageEdit(currentPage, selectedEdit.id, { align: 'right' })}
                      className={`p-1.5 rounded-lg ${selectedEdit.align === 'right' ? 'bg-indigo-600' : 'bg-slate-800'}`}
                    ><AlignRight className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={() => updatePageEdit(currentPage, selectedEdit.id, { align: 'center', x: 30, width: pageViewport.width - 60 })}
                      className={`p-1.5 rounded-lg ${selectedEdit.align === 'center' ? 'bg-indigo-600' : 'bg-slate-800'}`}
                      title="سنترة في الصفحة"
                    ><AlignCenter className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={() => updatePageEdit(currentPage, selectedEdit.id, { align: 'left' })}
                      className={`p-1.5 rounded-lg ${selectedEdit.align === 'left' ? 'bg-indigo-600' : 'bg-slate-800'}`}
                    ><AlignLeft className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={() => deletePageEdit(currentPage, selectedEdit.id)}
                      className="p-1.5 bg-rose-600/20 text-rose-400 rounded-lg"
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>

                  {/* Quick Color Swatches for Selected Text */}
                  <div className="flex items-center justify-between gap-2 pt-0.5 overflow-x-auto">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">لون النص:</span>
                      {TEXT_COLORS.map((c) => (
                        <button
                          key={c.value}
                          onClick={() => updatePageEdit(currentPage, selectedEdit.id, { color: c.value })}
                          style={{ backgroundColor: c.value }}
                          className={`w-5 h-5 rounded-full border ${
                            selectedEdit.color === c.value ? 'ring-2 ring-indigo-400 border-white scale-110' : 'border-slate-600'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">اسحب العنصر لتحريكه أو من الزاوية لتغيير حجمه</span>
                  <button
                    onClick={() => deletePageEdit(currentPage, selectedEdit.id)}
                    className="p-1.5 bg-rose-600/20 text-rose-400 rounded-lg"
                  ><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          )}

          {/* Smart Text Multi-Select Action Bar */}
          {activeTool === 'smartText' && (
            <div className="bg-indigo-950/90 border-b border-indigo-500/40 px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-indigo-200 font-semibold">
                {selectedSmartIds.length === 0
                  ? 'المس كلمة أو عدة كلمات/سطور لتحديدها'
                  : `تم تحديد ${selectedSmartIds.length} عنصر`}
              </span>
              {selectedSmartIds.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={deleteSelectedSmartItems}
                    className="bg-rose-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>مسح</span>
                  </button>
                  <button
                    onClick={openSmartGroupEditor}
                    className="bg-indigo-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>تعديل / سنترة</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* PDF Viewer Canvas Container */}
          <div className="flex-1 overflow-auto p-3 flex flex-col items-center justify-start bg-slate-950">
            <div
              ref={containerRef}
              onClick={handleCanvasClick}
              className="relative bg-white shadow-2xl rounded-sm overflow-hidden"
              style={{
                width: '100%',
                maxWidth: '520px',
                aspectRatio: `${pageViewport.width} / ${pageViewport.height}`
              }}
            >
              <canvas ref={canvasRef} className="w-full h-full block pointer-events-none" />

              {/* Detected Smart Text Boxes (Multi-select enabled) */}
              {activeTool === 'smartText' &&
                detectedItems.map((item) => {
                  const isPicked = selectedSmartIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={(e) => toggleSmartItemSelect(item, e)}
                      style={{
                        left: `${(item.x / pageViewport.width) * 100}%`,
                        top: `${(item.y / pageViewport.height) * 100}%`,
                        width: `${(item.width / pageViewport.width) * 100}%`,
                        height: `${(item.height / pageViewport.height) * 100}%`
                      }}
                      className={`absolute cursor-pointer rounded-[2px] transition ${
                        isPicked
                          ? 'border-2 border-emerald-500 bg-emerald-500/30 z-20'
                          : 'border border-indigo-500/60 bg-indigo-500/10 hover:bg-indigo-500/25 z-10'
                      }`}
                    />
                  );
                })}

              {/* Applied Overlays (Whiteouts, Texts, Highlights, Signatures) */}
              {currentEdits.map((edit) => {
                const isSelected = edit.id === selectedEditId;
                return (
                  <div
                    key={edit.id}
                    onMouseDown={(e) => startDrag(e, edit, 'move')}
                    onTouchStart={(e) => startDrag(e, edit, 'move')}
                    onClick={(e) => { e.stopPropagation(); setSelectedEditId(edit.id); }}
                    style={{
                      left: `${(edit.x / pageViewport.width) * 100}%`,
                      top: `${(edit.y / pageViewport.height) * 100}%`,
                      width: `${(edit.width / pageViewport.width) * 100}%`,
                      height: `${(edit.height / pageViewport.height) * 100}%`,
                      backgroundColor: edit.bgColor || 'transparent',
                      color: edit.color || '#000',
                      fontSize: `${(edit.fontSize || 14) * 0.72}px`,
                      textAlign: edit.align || 'center'
                    }}
                    className={`absolute flex items-center justify-center px-1 font-bold leading-tight cursor-move ${
                      isSelected ? 'ring-2 ring-indigo-500 z-20' : 'z-10'
                    }`}
                  >
                    {edit.type === 'text' && (
                      <span className="w-full whitespace-pre-wrap break-words" dir="auto">{edit.text}</span>
                    )}
                    {edit.type === 'signature' && edit.dataUrl && (
                      <img src={edit.dataUrl} alt="sign" className="w-full h-full object-contain pointer-events-none" />
                    )}

                    {/* Resize Handle */}
                    {isSelected && (
                      <div
                        onMouseDown={(e) => startDrag(e, edit, 'resize')}
                        onTouchStart={(e) => startDrag(e, edit, 'resize')}
                        className="w-4 h-4 bg-indigo-600 border-2 border-white rounded-full absolute -bottom-2 -right-2 cursor-nwse-resize"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Page Navigation & Page Controls */}
            <div className="mt-4 mb-24 flex items-center gap-3 bg-slate-900 border border-slate-800 px-4 py-2 rounded-2xl shadow-lg">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg bg-slate-800 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="text-xs font-bold">
                صفحة {currentPage} من {numPages}
              </span>
              <button
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                className="p-1.5 rounded-lg bg-slate-800 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="h-4 w-[1px] bg-slate-700 mx-1" />

              <button onClick={rotateCurrentPage} title="تدوير الصفحة" className="p-1.5 rounded-lg bg-slate-800 text-slate-300">
                <RotateCw className="w-4 h-4" />
              </button>
              <button onClick={deleteCurrentPage} title="حذف الصفحة" className="p-1.5 rounded-lg bg-slate-800 text-rose-400">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Bottom Toolbar */}
          <nav className="fixed bottom-0 inset-x-0 z-30 bg-slate-900/95 backdrop-blur border-t border-slate-800 px-2 py-2 flex items-center justify-around">
            <ToolBtn
              active={activeTool === 'smartText'}
              onClick={() => {
                setActiveTool(activeTool === 'smartText' ? 'select' : 'smartText');
                setSelectedSmartIds([]);
              }}
              icon={<Type className="w-5 h-5" />}
              label="تحديد نص"
            />
            <ToolBtn
              active={activeTool === 'addText'}
              onClick={() => setActiveTool('addText')}
              icon={<Plus className="w-5 h-5" />}
              label="إضافة نص"
            />
            <ToolBtn
              active={activeTool === 'whiteout'}
              onClick={() => setActiveTool('whiteout')}
              icon={<Eraser className="w-5 h-5" />}
              label="ممحاة"
            />
            <ToolBtn
              active={activeTool === 'highlight'}
              onClick={() => setActiveTool('highlight')}
              icon={<Highlighter className="w-5 h-5" />}
              label="تظليل"
            />
            <ToolBtn
              active={showSignModal}
              onClick={() => setShowSignModal(true)}
              icon={<PenTool className="w-5 h-5" />}
              label="توقيع"
            />
          </nav>
        </>
      )}

      {/* Save As: never overwrite the original document. */}
      {showSaveAs && (
        <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4">
            <h3 className="font-bold text-lg">حفظ نسخة جديدة</h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              التعديلات المرئية تُحفظ كطبقات فوق صفحة PDF، ولا تعدّل حروف أو خطوط النص الأصلي. تأكد من المعاينة قبل الاستخدام.
            </p>
            <label className="text-xs text-slate-300 block">اسم الملف الجديد</label>
            <input dir="auto" value={saveAsName} onChange={(e) => setSaveAsName(e.target.value)}
              className="w-full bg-slate-800 text-white rounded-xl px-3 py-3 border border-slate-600" />
            <div className="flex gap-2">
              <button onClick={() => setShowSaveAs(false)} className="flex-1 bg-slate-700 rounded-xl py-3">إلغاء</button>
              <button onClick={() => {setShowSaveAs(false);handleExportPdf(false,saveAsName);}}
                disabled={isExporting || !saveAsName.trim()}
                className="flex-1 bg-indigo-600 rounded-xl py-3 disabled:opacity-40">حفظ PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Group Text Editor Modal (Full Rich Options) */}
      {editingSmartGroup && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">تعديل وتنسيق النص المحدد</h3>
              <button onClick={() => setEditingSmartGroup(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">النص (يمكنك التعديل أو الحذف أو إضافة أسطر):</label>
              <textarea
                rows={3}
                dir="auto"
                value={editingSmartGroup.newText}
                onChange={(e) => setEditingSmartGroup({ ...editingSmartGroup, newText: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white leading-relaxed"
              />
            </div>

            {/* Alignment & Font Size */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">الحجم:</span>
                <input
                  type="number"
                  value={editingSmartGroup.fontSize}
                  onChange={(e) => setEditingSmartGroup({ ...editingSmartGroup, fontSize: Number(e.target.value) || 14 })}
                  className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-center"
                />
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditingSmartGroup({ ...editingSmartGroup, align: 'right', centerOnPage: false })}
                  className={`p-2 rounded-lg ${editingSmartGroup.align === 'right' && !editingSmartGroup.centerOnPage ? 'bg-indigo-600' : 'bg-slate-800'}`}
                ><AlignRight className="w-4 h-4" /></button>
                <button
                  onClick={() => setEditingSmartGroup({ ...editingSmartGroup, align: 'center', centerOnPage: true })}
                  className={`p-2 rounded-lg ${editingSmartGroup.centerOnPage ? 'bg-indigo-600' : 'bg-slate-800'}`}
                  title="سنترة في منتصف الصفحة"
                ><AlignCenter className="w-4 h-4" /></button>
                <button
                  onClick={() => setEditingSmartGroup({ ...editingSmartGroup, align: 'left', centerOnPage: false })}
                  className={`p-2 rounded-lg ${editingSmartGroup.align === 'left' && !editingSmartGroup.centerOnPage ? 'bg-indigo-600' : 'bg-slate-800'}`}
                ><AlignLeft className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Text Color Picker */}
            <div>
              <span className="text-xs text-slate-400 block mb-1.5">لون الخط:</span>
              <div className="flex items-center gap-2 flex-wrap">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setEditingSmartGroup({ ...editingSmartGroup, color: c.value })}
                    style={{ backgroundColor: c.value }}
                    className={`w-7 h-7 rounded-full border ${
                      editingSmartGroup.color === c.value ? 'ring-2 ring-indigo-400 border-white scale-110' : 'border-slate-600'
                    }`}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            {/* Background Color Picker */}
            <div>
              <span className="text-xs text-slate-400 block mb-1.5">خلفية النص:</span>
              <div className="flex items-center gap-2 flex-wrap">
                {BG_COLORS.map((b) => (
                  <button
                    key={b.value}
                    onClick={() => setEditingSmartGroup({ ...editingSmartGroup, bgColor: b.value })}
                    style={{ backgroundColor: b.value === 'transparent' ? '#1e293b' : b.value }}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                      editingSmartGroup.bgColor === b.value ? 'ring-2 ring-indigo-400 border-white' : 'border-slate-700'
                    } ${b.value === '#ffffff' || b.value === '#fef08a' || b.value === '#dbeafe' || b.value === '#dcfce7' ? 'text-slate-900' : 'text-white'}`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-2">
              <button
                onClick={applySmartGroupEdit}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/30"
              >
                <Check className="w-4 h-4" />
                <span>تطبيق التعديل على الصفحة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signature Modal */}
      {showSignModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">ارسم توقيعك</h3>
              <button onClick={() => setShowSignModal(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <canvas
              ref={signCanvasRef}
              width={340}
              height={160}
              onMouseDown={startSignDraw}
              onMouseMove={drawSign}
              onMouseUp={() => setIsDrawingSign(false)}
              onTouchStart={startSignDraw}
              onTouchMove={drawSign}
              onTouchEnd={() => setIsDrawingSign(false)}
              className="w-full h-40 bg-white rounded-2xl touch-none cursor-crosshair"
            />
            <div className="flex gap-2.5">
              <button
                onClick={() => {
                  const c = signCanvasRef.current;
                  c?.getContext('2d').clearRect(0, 0, c.width, c.height);
                }}
                className="flex-1 bg-slate-800 py-2.5 rounded-xl text-xs font-bold"
              >
                مسح اللوحة
              </button>
              <button
                onClick={saveSignature}
                className="flex-1 bg-indigo-600 py-2.5 rounded-xl text-xs font-bold text-white"
              >
                إدراج التوقيع
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition ${
        active ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold">{label}</span>
    </button>
  );
}
