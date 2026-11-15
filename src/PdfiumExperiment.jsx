import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { PdfCanvas } from 'pdfcanvas';
import modernWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(binary);
};

export default function PdfiumExperiment({ sourceBytes, fileName, onClose }) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const [status, setStatus] = useState('جارٍ تحميل محرك PDFium...');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sourceBytes || !hostRef.current) return;
    let cancelled = false;
    const assetUrl = (path) => new URL(path, document.baseURI).href;
    const engine = new PdfCanvas(hostRef.current, {
      workerSrc: modernWorker,
      cMapUrl: assetUrl('pdfjs/cmaps/'),
      standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
      wasmUrl: assetUrl('pdfjs/wasm/'),
      pdfiumWasmUrl: assetUrl('pdfium/pdfium.wasm'),
      fontAssetsUrl: assetUrl('fonts/'),
      initialZoom: 'fit-width',
      onError: (err) => {
        if (!cancelled) setStatus('خطأ في المحرك: ' + (err?.message || String(err)));
      }
    });
    engineRef.current = engine;
    (async () => {
      try {
        await engine.load(new Uint8Array(sourceBytes), { fileName: (fileName || 'document') + '.pdf' });
        if (cancelled) return;
        engine.setTool('text-edit');
        setReady(true);
        setStatus('اضغط على سطر نص أصلي لتجربة التحرير. جرّب الحذف أولًا على نسخة اختبارية.');
      } catch (e) {
        if (!cancelled) setStatus('فشل فتح الملف: ' + (e?.message || String(e)));
      }
    })();
    return () => {
      cancelled = true;
      engineRef.current = null;
      try { engine.destroy(); } catch (e) { console.warn('PDFium cleanup', e); }
    };
  }, [sourceBytes, fileName]);

  const run = (fn) => {
    try { fn(engineRef.current); }
    catch (e) { setStatus('تعذّر تنفيذ الأمر: ' + (e?.message || String(e))); }
  };

  const exportExperiment = async () => {
    if (!engineRef.current || busy) return;
    setBusy(true);
    try {
      const output = await engineRef.current.exportPdf({ fileName: (fileName || 'document') + '_pdfium_test.pdf' });
      const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
      if (!bytes.length || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
        throw new Error('ملف PDF غير صالح');
      }
      const safe = (fileName || 'document').replace(/[\\/:*?"<>|]/g, '_');
      const name = safe + '_PDFium_test_' + Date.now() + '.pdf';
      if (Capacitor.isNativePlatform()) {
        await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Documents });
        setStatus('حُفظت نسخة تجريبية باسم ' + name + ' في Documents؛ افتحها وتأكد من النص والخط.');
      } else {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setStatus('تم تنزيل نسخة PDFium التجريبية.');
      }
    } catch (e) {
      setStatus('فشل تصدير النسخة: ' + (e?.message || String(e)));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950 text-white flex flex-col" dir="rtl">
      <div className="bg-slate-900 border-b border-slate-700 px-3 py-2 flex items-center gap-2 flex-wrap">
        <button type="button" onClick={onClose} className="bg-slate-700 rounded-lg px-3 py-2 text-sm">رجوع</button>
        <span className="font-bold text-sm flex-1">اختبار PDFium — تحرير النص الأصلي</span>
        <button type="button" disabled={!ready} onClick={() => run((e) => e.setTool('text-edit'))}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm disabled:opacity-50">تحديد / تعديل</button>
        <button type="button" disabled={!ready} onClick={() => run((e) => e.deleteSelection())}
          className="rounded-lg bg-rose-700 px-3 py-2 text-sm disabled:opacity-50">حذف المحدد</button>
        <button type="button" disabled={!ready} onClick={() => run((e) => e.undo())}
          className="rounded-lg bg-slate-700 px-3 py-2 text-sm disabled:opacity-50">تراجع</button>
        <button type="button" disabled={!ready || busy} onClick={exportExperiment}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm disabled:opacity-50">
          {busy ? 'جارٍ الحفظ' : 'حفظ نسخة تجربة'}
        </button>
      </div>
      <div role="status" aria-live="polite" className="px-3 py-2 text-xs leading-relaxed bg-amber-950/70 text-amber-100">
        {status}
        <div className="mt-1 text-amber-200">تجريبي: بعض الخطوط العربية أو المستندات المعقدة لا تدعم استبدال النص بدقة؛ افحص النسخة قبل اعتمادها. لا يتم تعديل الملف الأصلي.</div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden" style={{direction:'ltr'}} ref={hostRef} />
    </div>
  );
}
