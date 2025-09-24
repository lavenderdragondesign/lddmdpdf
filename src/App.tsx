
import React, { useEffect, useRef, useState } from 'react'
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef, PDFString } from 'pdf-lib'
import { saveDirHandle, loadDirHandle, clearDirHandle } from './storage'

const hasFSA = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
const TEMPLATE_PATH = '/AlternativeDownloadLinkPleaseRead.pdf'; // exact OG design

export default function App() {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [status, setStatus] = useState<string>('');
  const [warn, setWarn] = useState<string>('');
  const [remember, setRemember] = useState<boolean>(true);
  const [overwriteInstant, setOverwriteInstant] = useState<boolean>(true);
  const inputRef = useRef<HTMLInputElement>(null);

const [templateBytes, setTemplateBytes] = useState<Uint8Array | null>(null);


useEffect(() => {
  (async () => {
    try {
      const res = await fetch(TEMPLATE_PATH);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        setTemplateBytes(new Uint8Array(ab));
        setTemplateName('OG Template');
      }
    } catch {}
  })();
}, []);


// Listen for messages from the browser extension and auto-save
useEffect(() => {
  function onMsg(e: MessageEvent) {
    if (!e || !e.data || e.data.source !== 'lddmd-ext' || e.data.type !== 'MD_URL') return;
    const url = String(e.data.url || '').trim();
    if (!url) return;
    (async () => {
      try {
        setLastUrl(url);
        const edited = await injectUrlIntoTemplate(url, templateBytes);
        if (hasFSA && dirHandle) {
          await saveToFolder(edited);
        } else if (hasFSA && !dirHandle) {
          setWarn('Choose your save folder first.');
        } else {
          const blob = new Blob([edited], { type: 'application/pdf' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'AlternativeDownloadLinkPleaseRead.pdf';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } catch (e: any) {
        setWarn('Auto-save failed: ' + (e?.message || String(e)));
      }
    })();
  }
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}, [templateBytes, dirHandle]);


function deriveFolderNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const tail = parts.slice(-2).join('-') || parts.join('-') || 'md-link';
    return `md-${tail}`.replace(/[^a-zA-Z0-9-_]/g, '-');
  } catch {
    return 'md-link';
  }
}

  const canonicalTarget = 'AlternativeDownloadLinkPleaseRead.pdf';

  useEffect(() => {
    // Restore saved folder handle without permission prompts
    (async () => {
      if (!hasFSA) return;
      const saved = await loadDirHandle();
      if (saved) {
        setDirHandle(saved);
        setStatus('Restored your save folder from last time. Permission will be requested when you save.');
      }
    })();
  }, []);


// Listen for messages from the browser extension and auto-save
useEffect(() => {
  function onMsg(e: MessageEvent) {
    if (!e || !e.data || e.data.source !== 'lddmd-ext' || e.data.type !== 'MD_URL') return;
    const url = String(e.data.url || '').trim();
    if (!url) return;
    (async () => {
      try {
        setLastUrl(url);
        const edited = await injectUrlIntoTemplate(url, templateBytes);
        if (hasFSA && dirHandle) {
          await saveToFolder(edited);
        } else if (hasFSA && !dirHandle) {
          setWarn('Choose your save folder first.');
        } else {
          const blob = new Blob([edited], { type: 'application/pdf' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'AlternativeDownloadLinkPleaseRead.pdf';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } catch (e: any) {
        setWarn('Auto-save failed: ' + (e?.message || String(e)));
      }
    })();
  }
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}, [templateBytes, dirHandle]);

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
        try { await saveDirHandle(handle); } catch { /* ignore */ }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setWarn('Failed to open folder: ' + e?.message);
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
    } catch {}
  };

  // Extract first /URI from MD's Download.pdf
  const extractFirstUri = async (file: File): Promise<string | null> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = pdfDoc.getPages();
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
        const URI = action.get(PDFName.of('URI')) as any;
        if (URI) {
          try {
            const str = (URI as any).decodeText ? (URI as any).decodeText() : String(URI);
            if (typeof str === 'string' && str.trim().length > 0) return str.trim();
          } catch {}
        }
      }
    }
    return null;
  };

  // Load the exact OG PDF and replace its link annotation(s) with mdUrl
  const injectUrlIntoTemplate = async (mdUrl: string, tplBytes?: Uint8Array | null): Promise<Uint8Array> => {
    const res = await fetch(TEMPLATE_PATH);
    if (!res.ok) throw new Error('Failed to load OG template PDF');
    const tempBytes = new Uint8Array(await res.arrayBuffer());

    const pdfDoc = await PDFDocument.load(tempBytes, { updateMetadata: false });
    const pages = pdfDoc.getPages();
    let changed = 0;

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

        // Replace URI
        action.set(PDFName.of('URI'), PDFString.of(mdUrl));
        changed++;
      }
    }

    if (changed === 0) {
      // In case the OG file lacked link annotations, we won't alter visuals.
      // But we can add a small invisible link at the top-left to ensure at least one clickable area.
      const first = pages[0];
      const { height } = first.getSize();
      const arr = (first.node.get(PDFName.of('Annots')) as any) || pdfDoc.context.obj([]);
      const annot = pdfDoc.context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Link'),
        Rect: pdfDoc.context.obj([0, height - 20, 120, height]),
        Border: pdfDoc.context.obj([0, 0, 0]),
        A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of(mdUrl) }),
      });
      const ref = pdfDoc.context.register(annot);
      if ((arr as any).push) (arr as any).push(ref);
      first.node.set(PDFName.of('Annots'), arr);
    }

    return await pdfDoc.save();
  };

  const saveToFolder = async (data: Uint8Array) => {
    if (!hasFSA) {
      // Fallback browser save
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
      return;
    }
    if (!dirHandle) {
      setWarn('Pick a subfolder (e.g., Desktop/MyPDFs) first.');
      return;
    }
    // Ask for permission only during this user-initiated flow
    // @ts-ignore
    const ok = await ensurePermission(dirHandle);
    if (!ok) {
      setWarn('No permission to write to that folder.');
      return;
    }
    try {
      // remove numbered dupes
      try {
        // @ts-ignore
        for await (const [name] of (dirHandle as any).entries()) {
          if (/^AlternativeDownloadLinkPleaseRead \(\d+\)\.pdf$/i.test(name)) {
            // @ts-ignore
            await (dirHandle as any).removeEntry(name);
          }
        }
      } catch {}
      const fileHandle = await dirHandle.getFileHandle(canonicalTarget, { create: true });
      // @ts-ignore
      const writable = await fileHandle.createWritable({ keepExistingData: !overwriteInstant });
      await writable.write(data);
      await writable.close();
      setStatus(`Saved as ${canonicalTarget} ✅`);
    } catch (e: any) {
      setWarn('Failed saving: ' + e?.message);
    }
  };

  
const processFiles = async (files: FileList | File[]) => {
  setWarn('');
  setStatus('');
  const list = Array.from(files).filter(f => f.type === 'application/pdf' && /^download\.pdf$/i.test(f.name.trim()));
  if (list.length === 0) {
    setWarn('Drop/select one or more MyDesigns "Download.pdf" files.');
    return;
  }
  if (!hasFSA) {
    // Fallback: build and trigger browser downloads one by one
    for (const file of list) {
      const url = await extractFirstUri(file);
      if (!url) continue;
      const out = await injectUrlIntoTemplate(url, templateBytes);
      const blob = new Blob([out], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'AlternativeDownloadLinkPleaseRead.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setStatus(`Saved ${list.length} file(s) via browser download.`);
    return;
  }
  if (!dirHandle) {
    setWarn('Pick a save folder (e.g., Desktop/MyPDFs) first.');
    return;
  }
  // @ts-ignore
  const ok = await ensurePermission(dirHandle);
  if (!ok) {
    setWarn('No permission to write to that folder.');
    return;
  }

  let success = 0, skipped = 0;
  for (const file of list) {
    try {
      const url = await extractFirstUri(file);
      if (!url) { skipped++; continue; }
      const out = await injectUrlIntoTemplate(url, templateBytes);
      const subName = deriveFolderNameFromUrl(url);
      // Create per-file subfolder so we can keep the canonical filename without numbers
      // @ts-ignore
      const subDir = await dirHandle.getDirectoryHandle(subName, { create: true });
      // Clean numbered dupes inside subfolder (very rare)
      try {
        // @ts-ignore
        for await (const [name] of (subDir as any).entries()) {
          if (/^AlternativeDownloadLinkPleaseRead \(\d+\)\.pdf$/i.test(name)) {
            // @ts-ignore
            await (subDir as any).removeEntry(name);
          }
        }
      } catch {}

      const fileHandle = await subDir.getFileHandle('AlternativeDownloadLinkPleaseRead.pdf', { create: true });
      // @ts-ignore
      const writable = await fileHandle.createWritable({ keepExistingData: false });
      await writable.write(out);
      await writable.close();
      success++;
    } catch {
      skipped++;
    }
  }
  setStatus(`Batch complete: ${success} saved, ${skipped} skipped.`);
};

  
const onPickTemplate = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.type !== 'application/pdf') {
    setWarn('Template must be a PDF.');
    e.target.value = '';
    return;
  }
  const ab = await file.arrayBuffer();
  setTemplateBytes(new Uint8Array(ab));
  setTemplateName(file.name);
  setStatus('Custom template loaded.');
  e.target.value = '';
};

const resetTemplate = async () => {
  try {
    const res = await fetch(TEMPLATE_PATH);
    if (!res.ok) throw new Error('Failed to load OG template PDF');
    const ab = await res.arrayBuffer();
    setTemplateBytes(new Uint8Array(ab));
    setTemplateName('OG Template');
    setStatus('Reverted to OG template.');
  } catch (e: any) {
    setWarn('Could not load OG template: ' + (e?.message || String(e)));
  }
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
      const url = await extractFirstUri(file);
      if (!url) {
        setWarn('No link found in your Download.pdf');
        return;
      }
      const edited = await injectUrlIntoTemplate(url); // keeps exact OG design
      await saveToFolder(edited);
    } catch (err: any) {
      setWarn('Failed to build OG AlternativeDownloadLinkPleaseRead.pdf: ' + (err?.message || String(err)));
    }
  };

  

const onPickPDF = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  if (files.length > 1) {
    setWarn(`Multiple files detected; processing the first one only to keep the output name clean.`);
  }
  const file = files[0];
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

  return (
    <div className="wrap">
      <div className="card">
        <h1>Use OG PDF ⟶ Inject MD Link ⟶ Save <span className="mono">AlternativeDownloadLinkPleaseRead.pdf</span></h1>
        <p>Drop/select your original MyDesigns <span className="mono">Download.pdf</span>. I’ll extract the embedded link and inject it into your exact OG PDF (bundled), preserving the design 1:1, then save it to your chosen folder.</p>

        <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="btn" onClick={chooseFolder} disabled={!hasFSA}>
            {dirHandle ? 'Change Save Folder' : 'Choose Save Folder (Desktop/MyPDFs)'}
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

        <div onDrop={onDrop} onDragOver={onDragOver}
          style={{ marginTop: 16, border: '2px dashed #2a3443', borderRadius: 12, padding: '40px', textAlign: 'center', color: '#9fb3c8', background: '#0f172a88' }}
          title="Drag & drop your Download.pdf here">
          Drag & Drop your <span className="mono">Download.pdf</span> here
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <input ref={inputRef} type="file" accept="application/pdf" onChange={onPickPDF} title="Pick your MD Download.pdf" />
          <button className="btn secondary" onClick={() => inputRef.current?.click()}>
            Select PDF
          </button>
        </div>

        {status && <div className="status">{status}</div>}
        {warn && <div className="status warn">{warn}</div>}

        <p className="hint" style={{ marginTop: 18 }}>
          Output is always <span className="mono">AlternativeDownloadLinkPleaseRead.pdf</span>. Numbered copies in the folder are removed automatically.
        </p>
      </div>
    </div>
  );
}
