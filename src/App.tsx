
import React, { useEffect, useRef, useState } from 'react'
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef, PDFString } from 'pdf-lib'
import { saveDirHandle, loadDirHandle, clearDirHandle } from './storage'

const hasFSA = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

type Rect = { x: number; y: number; w: number; h: number };

export default function App() {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [status, setStatus] = useState<string>('');
  const [warn, setWarn] = useState<string>('');
  const [remember, setRemember] = useState<boolean>(true);
  const [overwriteInstant, setOverwriteInstant] = useState<boolean>(true);
  const [rect, setRect] = useState<Rect | null>(null); // coords-based targeting
  const inputRef = useRef<HTMLInputElement>(null);

  const canonicalTarget = 'AlternativeDownloadLinkPleaseRead.pdf';

  useEffect(() => {
    // Auto-restore saved folder on mount
    (async () => {
      if (!hasFSA) return;
      const saved = await loadDirHandle();
      if (saved) {
        // @ts-ignore
        const opts = { mode: 'readwrite' };
        // @ts-ignore
        const perm = await (saved as any).queryPermission(opts);
        if (perm !== 'granted') {
          // @ts-ignore
          const req = await (saved as any).requestPermission(opts);
          if (req !== 'granted') {
            setWarn('Saved folder found but permission was not granted. Choose folder again.');
            return;
          }
        }
        setDirHandle(saved);
        setStatus('Restored your save folder from last time ✅');
      }
    })();
  }, []);

  const chooseFolder = async () => {
    setWarn('');
    setStatus('');
    if (!hasFSA) {
      setWarn('Your browser does not support choosing a Desktop folder directly. Use Chrome/Edge, or use the fallback save.');
      return;
    }
    try {
      const handle = await (window as any).showDirectoryPicker();
      setDirHandle(handle);
      setStatus('Folder selected.');
      if (remember) {
        const ok = await saveDirHandle(handle);
        if (!ok) setWarn('Could not remember folder (IndexedDB error).');
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setWarn('Failed to open folder: ' + e?.message);
      }
    }
  };

  const clearRemembered = async () => {
    await clearDirHandle();
    setStatus('Cleared remembered folder.');
  };

  const ensurePermission = async (handle: FileSystemHandle) => {
    // @ts-ignore
    const opts = { mode: 'readwrite' };
    // @ts-ignore
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    // @ts-ignore
    return (await handle.requestPermission(opts)) === 'granted';
  };

  const cleanNumberedCopies = async () => {
    if (!dirHandle) return;
    try {
      // @ts-ignore
      for await (const [name] of (dirHandle as any).entries()) {
        if (/^AlternativeDownloadLinkPleaseRead \(\d+\)\.pdf$/i.test(name)) {
          // @ts-ignore
          await (dirHandle as any).removeEntry(name);
        }
      }
    } catch {
      // ignore
    }
  };

  const extractFirstUriAndAnnots = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = pdfDoc.getPages();
    let firstUrl: string | null = null;
    const allAnnots: { pageIndex: number; ref: PDFRef; dict: PDFDict; rect: [number, number, number, number] }[] = [];
    for (let p = 0; p < pages.length; p++) {
      const page = pages[p];
      const annotsRef = page.node.get(PDFName.of('Annots'));
      if (!annotsRef) continue;
      const annots = pdfDoc.context.lookup(annotsRef) as PDFArray;
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const annotRef = annots.get(i) as PDFRef;
        const annot = pdfDoc.context.lookup(annotRef) as PDFDict;
        if (!annot) continue;
        const subType = annot.get(PDFName.of('Subtype'));
        if (subType !== PDFName.of('Link')) continue;
        const A = annot.get(PDFName.of('A'));
        if (!A) continue;
        const action = pdfDoc.context.lookup(A) as PDFDict;
        if (!action) continue;
        const S = action.get(PDFName.of('S'));
        if (S !== PDFName.of('URI')) continue;
        if (!firstUrl) {
          const URI = action.get(PDFName.of('URI')) as any;
          if (URI) {
            try {
              const str = (URI as any).decodeText ? (URI as any).decodeText() : String(URI);
              if (typeof str === 'string' && str.trim().length > 0) firstUrl = str.trim();
            } catch {}
          }
        }
        const rect = annot.get(PDFName.of('Rect')) as PDFArray | undefined;
        if (rect && rect.size && rect.size() === 4) {
          const r = [rect.get(0) as any, rect.get(1) as any, rect.get(2) as any, rect.get(3) as any].map((n:any)=> Number(n?.number ?? n));
          allAnnots.push({ pageIndex: p, ref: annotRef, dict: annot, rect: r as [number,number,number,number]});
        }
      }
    }
    return { firstUrl, allAnnots };
  };

  const intersects = (r: [number,number,number,number], area: Rect) => {
    const [x1,y1,x2,y2] = r;
    const ax1 = area.x, ay1 = area.y, ax2 = area.x + area.w, ay2 = area.y + area.h;
    return !(x2 < ax1 || x1 > ax2 || y2 < ay1 || y1 > ay2);
  };

  const rewritePdfUris = async (file: File, newUrl: string, target: Rect | null): Promise<Uint8Array> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });

    const pages = pdfDoc.getPages();
    let changed = 0;
    let largestArea = 0;
    let largestAnnot: { page: any; dict: PDFDict } | null = null;

    for (const page of pages) {
      const annotsRef = page.node.get(PDFName.of('Annots'));
      if (!annotsRef) continue;
      const annots = pdfDoc.context.lookup(annotsRef) as PDFArray;
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const annotRef = annots.get(i) as PDFRef;
        const annot = pdfDoc.context.lookup(annotRef) as PDFDict;
        if (!annot) continue;
        const subType = annot.get(PDFName.of('Subtype'));
        if (subType !== PDFName.of('Link')) continue;
        const A = annot.get(PDFName.of('A'));
        if (!A) continue;
        const action = pdfDoc.context.lookup(A) as PDFDict;
        if (!action) continue;
        const S = action.get(PDFName.of('S'));
        if (S !== PDFName.of('URI')) continue;

        const rectArr = annot.get(PDFName.of('Rect')) as PDFArray | undefined;
        let doChange = false;
        if (target && rectArr && rectArr.size && rectArr.size() === 4) {
          const r = [rectArr.get(0) as any, rectArr.get(1) as any, rectArr.get(2) as any, rectArr.get(3) as any].map((n:any)=> Number(n?.number ?? n));
          if (intersects(r as [number,number,number,number], target)) doChange = true;
        }

        if (target) {
          if (doChange) {
            action.set(PDFName.of('URI'), PDFString.of(newUrl));
            changed++;
          }
        } else {
          // No coords -> choose largest link rect and change only that
          if (rectArr && rectArr.size && rectArr.size() === 4) {
            const r = [rectArr.get(0) as any, rectArr.get(1) as any, rectArr.get(2) as any, rectArr.get(3) as any].map((n:any)=> Number(n?.number ?? n));
            const area = Math.abs((r[2]-r[0]) * (r[3]-r[1]));
            if (area > largestArea) {
              largestArea = area;
              largestAnnot = { page, dict: action };
            }
          }
        }
      }
    }

    if (!target && largestAnnot) {
      largestAnnot.dict.set(PDFName.of('URI'), PDFString.of(newUrl));
      changed++;
    }

    if (changed === 0) {
      // Fallback: add a small invisible link at top-left on the first page
      const first = pages[0];
      const { height } = first.getSize();
      const annotsExisting = first.node.get(PDFName.of('Annots'));
      const arr = annotsExisting ? (pdfDoc.context.lookup(annotsExisting) as PDFArray) : pdfDoc.context.obj([]);
      const annot = pdfDoc.context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Link'),
        Rect: pdfDoc.context.obj([0, height - 20, 120, height]),
        Border: pdfDoc.context.obj([0, 0, 0]),
        A: pdfDoc.context.obj({
          S: PDFName.of('URI'),
          URI: PDFString.of(newUrl),
        }),
      });
      const ref = pdfDoc.context.register(annot);
      // @ts-ignore
      if (arr.push) arr.push(ref);
      first.node.set(PDFName.of('Annots'), arr);
    }

    return await pdfDoc.save();
  };

  const saveToDesktopFolder = async (data: Uint8Array) => {
    if (!dirHandle) {
      setWarn('Pick your Desktop (or any) folder first.');
      return;
    }
    if (!(await ensurePermission(dirHandle))) {
      setWarn('No permission to write to that folder.');
      return;
    }
    try {
      await cleanNumberedCopies();
      const fileHandle = await dirHandle.getFileHandle(canonicalTarget, { create: true });
      // @ts-ignore
      if (!(await ensurePermission(fileHandle))) {
        setWarn('No permission to write the file.');
        return;
      }
      // @ts-ignore
      const writable = await fileHandle.createWritable({ keepExistingData: !overwriteInstant });
      await writable.write(data);
      await writable.close();
      setStatus(`Saved as ${canonicalTarget} ✅`);
    } catch (e: any) {
      setWarn('Failed saving to chosen folder: ' + e?.message);
    }
  };

  const fallbackBrowserSave = async (data: Uint8Array) => {
    const blob = new Blob([data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = canonicalTarget;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus('Saved via browser download (check your default folder).');
  };

  const processFile = async (file: File) => {
    setWarn('');
    setStatus('');
    if (file.type !== 'application/pdf') {
      setWarn('Please select a PDF.');
      return;
    }
    const originalName = file.name.trim();
    if (!/^download\.pdf$/i.test(originalName)) {
      setWarn('Please upload the MyDesigns file named exactly "Download.pdf".');
      return;
    }
    try {
      const { firstUrl } = await extractFirstUriAndAnnots(file);
      if (!firstUrl) {
        setWarn('No link annotation found in the PDF. Make sure this is the original MyDesigns Download.pdf.');
        return;
      }
      const edited = await rewritePdfUris(file, firstUrl, rect);
      if (hasFSA && dirHandle) {
        await saveToDesktopFolder(edited);
      } else if (hasFSA && !dirHandle) {
        setWarn('Choose your Desktop folder first.');
      } else {
        await fallbackBrowserSave(edited);
      }
    } catch (err: any) {
      setWarn('Failed to update PDF link: ' + (err?.message || String(err)));
    }
  };

  const onPickPDF = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    e.target.value = '';
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const updateRect = (k: keyof Rect, v: string) => {
    const num = Number(v);
    if (Number.isNaN(num)) return;
    setRect(prev => {
      const base = prev ?? { x: 0, y: 0, w: 0, h: 0 };
      return { ...base, [k]: num };
    });
  };

  const clearRect = () => setRect(null);

  return (
    <div className="wrap">
      <div className="card">
        <h1>Auto-extract MD link → <span className="mono">AlternativeDownloadLinkPleaseRead.pdf</span></h1>
        <p>Drop/select your original MyDesigns <span className="mono">Download.pdf</span>. I’ll extract the embedded link automatically and update only the button area (by coords), or the largest link if no coords, then save to your Desktop.</p>

        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="btn" onClick={chooseFolder} disabled={!hasFSA}>
            {dirHandle ? 'Change Save Folder' : 'Choose Save Folder (Desktop)'}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={remember} onChange={(e)=> setRemember(e.target.checked)} />
            Remember folder
          </label>
          <button className="btn secondary" onClick={clearRemembered}>
            Clear remembered
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={overwriteInstant} onChange={(e)=> setOverwriteInstant(e.target.checked)} />
            Overwrite instantly
          </label>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 8, width:'100%'}}>
            <div><label>X<br/><input type="number" value={rect?.x ?? ''} onChange={e=>updateRect('x', e.target.value)} style={{ width:'100%', padding:'8px', borderRadius:8, border:'1px solid #2a3443', background:'#0f172a', color:'#e5e7eb' }}/></label></div>
            <div><label>Y<br/><input type="number" value={rect?.y ?? ''} onChange={e=>updateRect('y', e.target.value)} style={{ width:'100%', padding:'8px', borderRadius:8, border:'1px solid #2a3443', background:'#0f172a', color:'#e5e7eb' }}/></label></div>
            <div><label>W<br/><input type="number" value={rect?.w ?? ''} onChange={e=>updateRect('w', e.target.value)} style={{ width:'100%', padding:'8px', borderRadius:8, border:'1px solid #2a3443', background:'#0f172a', color:'#e5e7eb' }}/></label></div>
            <div><label>H<br/><input type="number" value={rect?.h ?? ''} onChange={e=>updateRect('h', e.target.value)} style={{ width:'100%', padding:'8px', borderRadius:8, border:'1px solid #2a3443', background:'#0f172a', color:'#e5e7eb' }}/></label></div>
          </div>
          <button className="btn secondary" onClick={clearRect}>Use Largest Link</button>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          style={{
            marginTop: 16,
            border: '2px dashed #2a3443',
            borderRadius: 12,
            padding: '40px',
            textAlign: 'center',
            color: '#9fb3c8',
            background: '#0f172a88'
          }}
          title="Drag & drop your Download.pdf here"
        >
          Drag & Drop your <span className="mono">Download.pdf</span> here
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            onChange={onPickPDF}
            title="Pick your MD Download.pdf"
          />
          <button className="btn secondary" onClick={() => inputRef.current?.click()}>
            Select PDF
          </button>
        </div>

        {status && <div className="status">{status}</div>}
        {warn && <div className="status warn">{warn}</div>}

        <p className="hint" style={{ marginTop: 18 }}>
          Rules: Upload must be <span className="mono">Download.pdf</span>. Output is always <span className="mono">AlternativeDownloadLinkPleaseRead.pdf</span>. Numbered copies in the folder are removed automatically.
        </p>
      </div>
    </div>
  );
}
