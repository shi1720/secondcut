'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, Circle, CircleMinus, CirclePlus, ImagePlus, Layers3, Leaf, LoaderCircle, Minus, MousePointer2, Plus, RotateCcw, Scissors, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { applyExclusions, decodeMask, encodeMask, nestPatterns, planSvg } from '../lib/nesting';
import type { BinaryMask, Exclusion, NestResult, Pattern } from '../lib/nesting';
import { paintDisk } from '../lib/mask';
import type { PromptPoint } from '../lib/mask';
import type { ProjectDocument, ProjectRecord } from '../lib/project-schema';
import { calibratePhotoWidth } from '../lib/calibration';
import { AuthPanel } from '../components/auth-panel';
import { apiFetch, resolvePhotoUrl } from '../lib/firebase-api';
import { auth } from '../lib/firebase';

type User = { name: string; email: string } | null;
type Step = 'photo' | 'review' | 'plan' | 'library';
type Tool = 'foreground' | 'background' | 'add' | 'erase' | 'defect' | 'calibrate';
const initialPatterns = (): Pattern[] => [
  { id: 'tag', name: 'Luggage tag', widthMm: 65, heightMm: 35, quantity: 8, value: 120, shape: 'rectangle', rotate: true },
  { id: 'coaster', name: 'Round coaster', widthMm: 70, heightMm: 70, quantity: 6, value: 180, shape: 'ellipse', rotate: true },
];
const colors = ['#f3c47e', '#c2d5bc', '#c5cbe0', '#e5b4ad', '#dfd3a2', '#abd2cd'];
const steps: { id: Step; number: string; title: string; caption: string }[] = [
  { id: 'photo', number: '01', title: 'Photograph', caption: 'Find your material' },
  { id: 'review', number: '02', title: 'Review', caption: 'Make the edges yours' },
  { id: 'plan', number: '03', title: 'Cutting plan', caption: 'Arrange the possibilities' },
  { id: 'library', number: '04', title: 'Your library', caption: 'Keep good ideas' },
];
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(path, options);
  let body: T & { error?: string };
  try { body = await response.json() as T & { error?: string }; } catch { throw new Error('The workspace returned an unreadable response. Please retry.'); }
  if (!response.ok) throw new Error(body.error || 'The request could not finish. Please retry.');
  return body;
}
function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function localPhoto(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photograph.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photograph smaller than 20 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 64 || bitmap.height < 64) throw new Error('Use a photograph at least 64 pixels on each side.');
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('This image is too large to edit safely. Resize it below 40 megapixels first.');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image preparation is unavailable in this browser.');
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .9);
  } finally { bitmap.close(); }
}

function ProjectPhoto({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false; setUrl(''); setFailed(false);
    resolvePhotoUrl(path).then(value => { if (!cancelled) setUrl(value); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);
  return url && !failed ? <img src={url} alt={name} onError={() => setFailed(true)} /> : <span className="photo-placeholder">{failed ? 'Photograph unavailable' : 'Loading photograph…'}</span>;
}

export default function Studio({ user }: { user: User }) {
  const [step, setStep] = useState<Step>('photo');
  const [image, setImage] = useState('/demo/leather.png');
  const [displayImage, setDisplayImage] = useState('/demo/leather.png');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [name, setName] = useState('Caramel leather offcut');
  const [imageSize, setImageSize] = useState({ width: 1254, height: 1254 });
  const [points, setPoints] = useState<PromptPoint[]>([{ x: .5, y: .45, label: 1 }, { x: .02, y: .02, label: 0 }]);
  const [mask, setMask] = useState<BinaryMask | null>(null);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [tool, setTool] = useState<Tool>('foreground');
  const [brush, setBrush] = useState(12);
  const [widthMm, setWidthMm] = useState(300);
  const [clearanceMm, setClearanceMm] = useState(2);
  const [gapMm, setGapMm] = useState(2);
  const [calibrated, setCalibrated] = useState(false);
  const [referencePoints, setReferencePoints] = useState<{ x: number; y: number }[]>([]);
  const [referenceMm, setReferenceMm] = useState(50);
  const [reviewed, setReviewed] = useState(false);
  const [patterns, setPatterns] = useState<Pattern[]>(initialPatterns);
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');
  const [model, setModel] = useState('Not segmented');
  const [modelScore, setModelScore] = useState<number | null>(null);
  const [plan, setPlan] = useState<NestResult | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [library, setLibrary] = useState<ProjectRecord[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [undoCount, setUndoCount] = useState(0);
  const [keyboardPoint, setKeyboardPoint] = useState({ x: .5, y: .5 });
  const [keyboardActive, setKeyboardActive] = useState(false);
  const editHistory = useRef<{ mask: BinaryMask; exclusions: Exclusion[] }[]>([]);
  const libraryRequest = useRef(0);
  // Firebase UID survives guest-to-account linking and profile changes.
  const identity = user ? auth.currentUser?.uid || user.email : null;
  const previousIdentity = useRef<string | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const dragging = useRef(false);
  const operation = useRef(0);
  const effectiveMask = mask ? applyExclusions(mask, exclusions) : null;
  const sample = image.startsWith('/demo/');
  const materialFraction = effectiveMask ? effectiveMask.data.reduce((sum, pixel) => sum + (pixel ? 1 : 0), 0) / effectiveMask.data.length : 0;
  const heightMm = widthMm * imageSize.height / imageSize.width;
  const ready = !!mask && reviewed && calibrated && imageLoaded;
  const requested = patterns.reduce((sum, pattern) => sum + pattern.quantity, 0);
  const patternError = patterns.some(pattern => !pattern.name.trim()) ? 'Give every pattern a name.' : requested > 100 ? 'Request at most 100 pieces per layout.' : patterns.some(pattern => ![pattern.widthMm, pattern.heightMm, pattern.quantity, pattern.value].every(Number.isFinite) || pattern.widthMm < 5 || pattern.heightMm < 5 || pattern.widthMm > 3000 || pattern.heightMm > 3000 || !Number.isInteger(pattern.quantity) || pattern.quantity < 1 || pattern.quantity > 30 || pattern.value < 0 || pattern.value > 1_000_000) ? 'Use dimensions from 5 to 3000 mm, whole quantities from 1 to 30, and a nonnegative piece value.' : '';
  const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

  const refreshLibrary = useCallback(async () => {
    if (!identity) return;
    const request = ++libraryRequest.current; setLoadingLibrary(true);
    try { const data = await api<{ projects: ProjectRecord[] }>('/api/projects'); if (libraryRequest.current === request) setLibrary(data.projects); }
    catch (caught) { if (libraryRequest.current === request) setError((caught as Error).message); }
    finally { if (libraryRequest.current === request) setLoadingLibrary(false); }
  }, [identity]);
  const clearEdits = useCallback(() => { editHistory.current = []; setUndoCount(0); }, []);
  const newImage = useCallback((url: string, title: string) => {
    operation.current++; setBusy(''); clearEdits(); setSourceRevision(current => current + 1); setImageLoaded(false); setImage(url); setName(title); setMask(null); setPlan(null); setExclusions([]); setReviewed(false); setCalibrated(false); setReferencePoints([]); setOpenedId(null);
    setModel('Not segmented'); setModelScore(null); setPoints([{ x: .5, y: .45, label: 1 }, { x: .02, y: .02, label: 0 }]); setTool('foreground'); setStep('photo'); setError(''); setNotice('');
  }, [clearEdits]);

  useEffect(() => {
    let cancelled = false; setImageLoaded(false);
    if (image.startsWith('/api/photos/')) setDisplayImage('');
    resolvePhotoUrl(image).then(url => {
      if (cancelled) return;
      setDisplayImage(url);
      // A cached image can finish before this effect, especially after modal sign-in.
      const photo = photoRef.current;
      if (photo?.complete && photo.naturalWidth > 0 && photo.src === new URL(url, window.location.href).href) {
        setImageSize({ width: photo.naturalWidth, height: photo.naturalHeight }); setImageLoaded(true);
      }
    }).catch(caught => { if (!cancelled) { setDisplayImage(''); setError((caught as Error).message || 'Your source photograph could not be opened.'); } });
    return () => { cancelled = true; };
  }, [image, user?.email, sourceRevision]);
  useEffect(() => {
    // Image edits can rerun this effect; only an identity transition may reset
    // private source state or request a fresh account library.
    const previous = previousIdentity.current;
    if (previous === identity) return;
    previousIdentity.current = identity;
    if (previous) {
      setLibrary([]); libraryRequest.current++; operation.current++; setBusy(''); setLoadingLibrary(false);
      if (image.startsWith('/api/photos/')) newImage('/demo/leather.png', 'Caramel leather offcut');
    }
    if (identity) void refreshLibrary();
  }, [identity, image, newImage, refreshLibrary]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d'); if (!context) return;
    if (!mask || !overlay) { context.clearRect(0, 0, canvas.width, canvas.height); return; }
    canvas.width = mask.width; canvas.height = mask.height;
    const data = context.createImageData(mask.width, mask.height);
    const effective = applyExclusions(mask, exclusions);
    for (let i = 0; i < effective.data.length; i++) {
      if (effective.data[i]) { data.data[i * 4] = 28; data.data[i * 4 + 1] = 91; data.data[i * 4 + 2] = 75; data.data[i * 4 + 3] = step === 'plan' && plan ? 22 : 70; }
      else { data.data[i * 4] = 247; data.data[i * 4 + 1] = 244; data.data[i * 4 + 2] = 237; data.data[i * 4 + 3] = step === 'photo' ? 0 : 115; }
    }
    context.putImageData(data, 0, 0);
  }, [mask, exclusions, overlay, step, plan]);

  function rememberEdit() {
    if (!mask) return;
    editHistory.current = [...editHistory.current.slice(-11), { mask: { ...mask, data: new Uint8Array(mask.data) }, exclusions: exclusions.map(item => ({ ...item })) }];
    setUndoCount(editHistory.current.length);
  }
  function undoEdit() {
    const previous = editHistory.current.pop();
    if (!previous) return;
    setMask(previous.mask); setExclusions(previous.exclusions); setUndoCount(editHistory.current.length); invalidateMask();
  }
  function invalidateMask() { setReviewed(false); setPlan(null); }
  async function upload(file?: File) {
    if (!file || busy) return;
    setError(''); setBusy('Preparing your photograph…');
    try { newImage(await localPhoto(file), file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'My material remnant'); }
    catch (caught) { setError((caught as Error).message); }
    finally { setBusy(''); }
  }
  async function segment() {
    setError(''); setNotice(''); setPlan(null); setReviewed(false);
    if (!points.some(point => point.label === 1)) { setError('Add a material point inside the remnant first.'); return; }
    if (!displayImage || !imageLoaded) { setError('Wait for your photograph to load before running image AI.'); return; }
    const token = ++operation.current; setBusy('Loading on-device image AI…');
    try {
      const { segmentMaterial } = await import('../lib/segmentation');
      const result = await segmentMaterial(displayImage, points, message => { if (operation.current === token) setBusy(message); });
      if (operation.current !== token) return;
      clearEdits(); setMask(result.mask); setModel(result.model); setModelScore(result.score); setStep('review'); setTool('defect'); setOverlay(true);
      setNotice('Material found. Check the green area, mark defects, and confirm your photo scale.');
    } catch (caught) { if (operation.current === token) setError((caught as Error).message || 'Image AI could not finish. Adjust points and retry.'); }
    finally { if (operation.current === token) setBusy(''); }
  }
  function manualMask() {
    if (!imageLoaded) { setError('Wait for your photograph to load before editing.'); return; }
    clearEdits();
    const scale = Math.min(1, 512 / Math.max(imageSize.width, imageSize.height));
    const width = Math.max(16, Math.round(imageSize.width * scale)), height = Math.max(16, Math.round(imageSize.height * scale));
    setMask({ width, height, data: new Uint8Array(width * height) }); setModel('Manual painted mask'); setModelScore(null); setExclusions([]); invalidateMask(); setStep('review'); setTool('add'); setNotice('Manual mode: paint the usable material green. No model result is being substituted.');
  }
  function canvasAction(event: React.PointerEvent<HTMLDivElement>, moving = false) {
    if (busy || !imageLoaded || step === 'plan' || step === 'library') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    applyCanvasPoint(x, y, moving);
  }
  function applyCanvasPoint(x: number, y: number, moving = false) {
    if (busy || !imageLoaded || step === 'plan' || step === 'library') return;
    if (tool === 'calibrate') {
      if (moving) return;
      setReferencePoints(current => current.length >= 2 ? [{ x, y }] : [...current, { x, y }]); setCalibrated(false); setPlan(null);
    } else if (tool === 'foreground' || tool === 'background') {
      if (moving) return;
      if (points.length >= 32) { setError('Use at most 32 prompt points. Undo a point before adding another.'); return; }
      setPoints(current => [...current, { x, y, label: tool === 'foreground' ? 1 : 0 }]);
      if (mask) { setMask(null); clearEdits(); invalidateMask(); setModelScore(null); setNotice('Prompt changed. Run image AI again to get an updated mask.'); }
    } else if (mask && (tool === 'add' || tool === 'erase')) {
      setMask(current => current ? paintDisk(current, x, y, brush, tool === 'add' ? 1 : 0) : null); invalidateMask();
    } else if (mask && tool === 'defect' && !moving) {
      if (exclusions.length >= 100) { setError('Use at most 100 defect exclusions.'); return; }
      setExclusions(current => [...current, { x, y, r: brush / mask.width }]); invalidateMask();
    }
  }
  async function generatePlan() {
    setError('');
    if (!ready || !effectiveMask) { setError('Review the material mask and confirm the full photo width before planning.'); setStep('review'); return; }
    if (patternError) { setError(patternError); return; }
    const token = ++operation.current; setBusy('Arranging your pieces…'); setPlan(null);
    try { const result = await nestPatterns(effectiveMask, widthMm, patterns, clearanceMm, gapMm, message => { if (operation.current === token) setBusy(message); }, heightMm); if (operation.current !== token) return; setPlan(result); setStep('plan'); setNotice(result.placements.length ? 'Your layout is ready. Verify the exported scale bar before cutting.' : 'No requested pieces fit. Try smaller pieces or review the material selection.'); }
    catch (caught) { if (operation.current === token) setError((caught as Error).message); }
    finally { if (operation.current === token) setBusy(''); }
  }
  function exportSvg() {
    if (!plan || !ready || !effectiveMask) return;
    downloadText(planSvg(plan, widthMm, heightMm, effectiveMask, name), `${name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'secondcut'}-cutting-plan.svg`, 'image/svg+xml');
    setNotice('SVG downloaded. Print at 100%, verify the 50 mm bar with a ruler, and inspect all edges and defects before cutting.');
  }
  async function saveProject() {
    if (!user || !mask) return;
    const token = ++operation.current; setError(''); setBusy('Saving your project…');
    let uploaded: string | null = null;
    try {
      let storedImage = image;
      if (!image.startsWith('/')) {
        const blob = await (await fetch(image)).blob();
        const photo = await api<{ url: string }>('/api/photos', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        storedImage = photo.url; uploaded = photo.url;
        if (operation.current !== token) return;
      }
      const body: ProjectDocument = { name, image: storedImage, widthMm, clearanceMm, gapMm, mask: encodeMask(mask), exclusions, patterns, reviewed, model, points, currency };
      const saved = await api<{ project: ProjectRecord }>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      uploaded = null; if (operation.current !== token) return; setImage(storedImage); setOpenedId(saved.project.id); setLibrary(current => [saved.project, ...current]); setNotice('A new project revision is saved in your private library.');
    } catch (caught) {
      if (uploaded) { try { await api(uploaded, { method: 'DELETE' }); } catch { /* Workspace erasure can remove an interrupted upload. */ } }
      if (operation.current === token) setError((caught as Error).message);
    } finally { if (operation.current === token) setBusy(''); }
  }
  function openProject(project: ProjectRecord) {
    operation.current++; setBusy(''); clearEdits(); setSourceRevision(current => current + 1); setImageLoaded(false); setImage(project.image); setName(project.name); setWidthMm(project.widthMm); setClearanceMm(project.clearanceMm); setGapMm(project.gapMm);
    setMask(decodeMask(project.mask)); setExclusions(project.exclusions); setPatterns(project.patterns); setPoints(project.points); setModel(project.model); setCurrency(project.currency);
    setPlan(null); setCalibrated(false); setReviewed(false); setModelScore(null); setReferencePoints([]); setOpenedId(project.id); setStep('review'); setTool('defect'); setError(''); setNotice('Project reopened. Recheck the material and confirm its saved scale before a new layout.');
  }
  function changePattern(id: string, change: Partial<Pattern>) { setPatterns(current => current.map(pattern => pattern.id === id ? { ...pattern, ...change } : pattern)); setPlan(null); }
  function goStep(next: Step) { setStep(next); if (next === 'photo') setTool('foreground'); if (next === 'review' && mask) setTool('defect'); }

  return <div className="studio-app">
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload material photograph" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
    <header className="site-header"><a className="wordmark" href="/" aria-label="SecondCut home"><span className="brand-symbol"><Scissors size={24} strokeWidth={1.5} /></span>second<span>cut</span></a><div className="header-note"><span className="live-dot" /> A LITTLE LESS WASTE. A LOT MORE POSSIBILITY.</div><div className="header-actions"><a className="source-link" href="https://github.com/shi1720/secondcut" target="_blank" rel="noreferrer">The story & source <ArrowUpRight size={14} /></a><AuthPanel user={user} className="button small outline" /></div></header>
    <main className="studio-main">
      <section className="intro"><div><div className="eyebrow"><span /> THE REMNANT STUDIO</div><h1>Good material.<br className="mobile-break" /> <em>More possibilities.</em></h1><p>Find the pieces hiding in your offcuts. Photograph, refine, and plan a second life.</p></div><div className="intro-stamp"><Leaf size={22} strokeWidth={1.3} /><span>Made for makers.<br /><strong>Built around what’s left.</strong></span></div></section>
      <nav className="steps" aria-label="Studio workflow">{steps.map(item => <button key={item.id} className={step === item.id ? 'current' : ''} onClick={() => goStep(item.id)} disabled={!!busy} aria-current={step === item.id ? 'step' : undefined}><span className="step-number">{item.number}</span><span><strong>{item.title}</strong><small>{item.caption}</small></span><ArrowRight size={16} /></button>)}</nav>
      {error && <div className="message error" role="alert"><CircleMinus size={18} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="message notice" role="status"><Check size={17} /><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={16} /></button></div>}
      {step === 'library' ? <section className="library-section"><div className="section-title"><div><div className="eyebrow">IDEAS WORTH KEEPING</div><h2>Your material library.</h2><p>Source photographs, reviewed masks and pattern settings. Layouts recompute when you return.</p></div>{user && <button className="button outline" onClick={() => void refreshLibrary()} disabled={loadingLibrary}><RotateCcw size={15} />Refresh library</button>}</div>{!user ? <div className="empty-state"><Layers3 size={36} strokeWidth={1.2} /><h3>A home for your next good idea.</h3><p>Try everything locally. Sign in to keep your source photographs and projects in a private workspace.</p><AuthPanel user={user} className="button primary" label="Sign in to save projects" /></div> : loadingLibrary ? <div className="empty-state"><LoaderCircle className="spin" />Opening your library…</div> : !library.length ? <div className="empty-state"><Layers3 size={36} strokeWidth={1.2} /><h3>A fresh shelf.</h3><p>Your first saved project will live here. Start with a remnant and see what fits.</p><button className="button primary" onClick={() => setStep('photo')}>Back to the studio <ArrowRight size={16} /></button></div> : <div className="project-grid">{library.map(project => <article className="project-card" key={project.id}><button className="project-image" onClick={() => openProject(project)} aria-label={`Open ${project.name}`}><ProjectPhoto path={project.image} name={project.name} /></button><div className="project-info"><span className="eyebrow">{project.image.startsWith('/demo/') ? 'SYNTHETIC SAMPLE' : 'YOUR MATERIAL'}</span><h3>{project.name}</h3><p>{project.patterns.length} pattern types · {project.widthMm} mm photo width</p><small>{new Date(project.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</small><div><button className="button outline" onClick={() => openProject(project)}>Open project <ArrowUpRight size={14} /></button><button className="icon-button" aria-label={`Delete ${project.name}`} onClick={async () => { if (!window.confirm('Delete this project revision and its photograph if no other saved project uses it?')) return; try { await api(`/api/projects?id=${project.id}`, { method: 'DELETE' }); setLibrary(current => current.filter(other => other.id !== project.id)); if (openedId === project.id) newImage('/demo/leather.png', 'Caramel leather offcut'); } catch (caught) { setError((caught as Error).message); } }}><Trash2 size={16} /></button></div></div></article>)}</div>}{user && <div className="library-privacy"><ShieldCheck size={19} /><p>Your photographs stay private to your signed-in workspace. Browser AI runs locally. Up to 50 project revisions and 50 MB of photos.</p><button onClick={async () => { if (!window.confirm('Permanently erase ALL your saved projects and ALL uploaded photographs, including unfinished uploads? This cannot be undone.')) return; setBusy('Erasing your workspace…'); try { await api('/api/projects', { method: 'DELETE' }); setLibrary([]); newImage('/demo/leather.png', 'Caramel leather offcut'); setNotice('Your saved workspace and uploaded photographs have been erased.'); } catch (caught) { setError((caught as Error).message); } finally { setBusy(''); } }}>Erase my workspace</button></div>}</section> : <div className="workbench">
        <section className="canvas-panel"><div className="canvas-heading"><div><span className="eyebrow">{sample ? 'SAMPLE MATERIAL / SYNTHETIC PHOTO' : 'YOUR MATERIAL / LOCAL PHOTOGRAPH'}</span><h2>{name}</h2></div><button className="icon-button" aria-label="Upload a different photograph" title="Upload a different photograph" onClick={() => fileRef.current?.click()} disabled={!!busy}><ImagePlus size={19} /></button></div>
          <div className="canvas-toolbar"><span><MousePointer2 size={14} />{step === 'photo' ? tool === 'foreground' ? 'Click inside the material' : 'Click on the background' : step === 'review' ? tool === 'calibrate' ? 'Click two measured reference marks' : tool === 'defect' ? 'Click a defect to exclude it' : tool === 'add' ? 'Paint to add usable material' : tool === 'erase' ? 'Paint to remove material' : 'Refine your prompt points' : 'Reviewed layout preview'}</span>{mask && <label className="overlay-toggle"><input type="checkbox" checked={overlay} onChange={event => setOverlay(event.target.checked)} />Show mask</label>}</div>
          <div className="canvas-bed"><div className={`photo-stage tool-${tool}`} style={{ aspectRatio: `${imageSize.width}/${imageSize.height}` }} onPointerDown={event => { if (busy || !imageLoaded || step === 'plan') return; event.preventDefault(); setKeyboardActive(false); event.currentTarget.focus(); if (tool === 'add' || tool === 'erase' || tool === 'defect') rememberEdit(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); canvasAction(event); }} onPointerMove={event => { if (dragging.current && (tool === 'add' || tool === 'erase')) canvasAction(event, true); }} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }} tabIndex={0} role="application" aria-label={`${name} material editor`} aria-describedby="canvas-keyboard-help" onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (!busy) undoEdit(); return; }
              if (busy || !imageLoaded || step === 'plan') return;
              const delta = event.shiftKey ? .05 : .01;
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault(); setKeyboardActive(true); setKeyboardPoint(current => ({ x: Math.max(0, Math.min(1, current.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0))), y: Math.max(0, Math.min(1, current.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0))) }));
              } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setKeyboardActive(true); if (tool === 'add' || tool === 'erase' || tool === 'defect') rememberEdit(); applyCanvasPoint(keyboardPoint.x, keyboardPoint.y); }
            }}>
            {displayImage ? <img ref={photoRef} key={`${image}-${user?.email || 'guest'}-${sourceRevision}`} src={displayImage} alt={`${name} source photograph`} draggable={false} onLoad={event => { setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setImageLoaded(true); }} onError={() => { setImageLoaded(false); setError('Source photograph could not load. Reopen the project or choose another photograph.'); }} /> : <div className="photo-placeholder">Opening your photograph…</div>}
            {keyboardActive && <span className="keyboard-target" style={{ left: `${keyboardPoint.x * 100}%`, top: `${keyboardPoint.y * 100}%` }} aria-hidden="true" />}
            <canvas ref={canvasRef} className="mask-layer" />
            {step === 'photo' && points.map((point, index) => <span key={index} className={`prompt-dot ${point.label ? 'positive' : 'negative'}`} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>{point.label ? '+' : '−'}</span>)}
            {step === 'review' && referencePoints.length > 0 && <svg className="reference-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Scale reference marks">
              {referencePoints.length === 2 && <line x1={referencePoints[0].x * 100} y1={referencePoints[0].y * 100} x2={referencePoints[1].x * 100} y2={referencePoints[1].y * 100} />}
              {referencePoints.map((point, index) => <g key={index}><circle cx={point.x * 100} cy={point.y * 100} r={1} /><text x={point.x * 100 + 1.6} y={point.y * 100 - 1.6}>{index + 1}</text></g>)}
            </svg>}
            {step !== 'photo' && exclusions.map((exclusion, index) => <span className="exclusion-ring" key={index} style={{ left: `${(exclusion.x - exclusion.r) * 100}%`, top: `${(exclusion.y - exclusion.r * imageSize.width / imageSize.height) * 100}%`, width: `${exclusion.r * 200}%`, height: `${exclusion.r * 200 * imageSize.width / imageSize.height}%` }} />)}
            {step === 'plan' && plan && <svg className="placement-layer" viewBox={`0 0 ${widthMm} ${heightMm}`} aria-label={`${plan.placements.length} nested pieces`}>
              {plan.placements.map((placement, index) => { const color = colors[Math.max(0, patterns.findIndex(pattern => pattern.id === placement.patternId)) % colors.length]; return <g key={`${placement.patternId}-${placement.instance}`}>{placement.shape === 'ellipse' ? <ellipse cx={placement.xMm + placement.widthMm / 2} cy={placement.yMm + placement.heightMm / 2} rx={placement.widthMm / 2} ry={placement.heightMm / 2} fill={color} /> : <rect x={placement.xMm} y={placement.yMm} width={placement.widthMm} height={placement.heightMm} rx={.5} fill={color} />}<text x={placement.xMm + placement.widthMm / 2} y={placement.yMm + placement.heightMm / 2} dominantBaseline="middle" textAnchor="middle">{index + 1}</text></g>; })}
            </svg>}
            {busy && <div className="canvas-busy"><div><LoaderCircle className="spin" size={27} /><strong>{busy}</strong><span>Keep this tab open until this step finishes.</span></div></div>}
          </div></div>
          <div className="canvas-footer"><span><span className={`legend-dot ${mask ? 'green' : ''}`} />{mask ? `${Math.round(materialFraction * 100)}% of frame selected` : 'Ready for image AI'}</span><span>{sample ? 'AI-generated sample · assumed scale' : image.startsWith('/api/photos/') ? 'Private saved photograph' : 'No photo upload until you save'}</span></div>
          <span className="sr-only" id="canvas-keyboard-help">Choose a tool, then focus this editor. Arrow keys move the target, Shift moves faster, Enter applies the tool. Control or Command Z undoes an edit.</span><div className="bench-note"><Leaf size={17} /><p>{step === 'plan' ? 'The smallest useful piece is still a useful piece.' : 'One remnant at a time. Flat surface, clear edges, and an overhead photograph.'}</p><span>SECOND / CUT</span></div>
        </section>
        <aside className="inspector" aria-label="Material controls">
          {step === 'photo' && <><div className="inspector-heading"><span className="eyebrow">01 / START WITH WHAT’S LEFT</span><h2>Meet your material.</h2><p>A remnant is a beginning, not an ending.</p></div><div className="control-section"><label className="field-label" htmlFor="project-name">Project name</label><input id="project-name" value={name} maxLength={100} disabled={!!busy} onChange={event => setName(event.target.value)} /><button className="upload-button" disabled={!!busy} onClick={() => fileRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}><ImagePlus size={24} strokeWidth={1.3} /><strong>Upload a material photograph</strong><span>or drop it here · JPEG, PNG, WebP · 20 MB</span></button><div className="mini-label">OR EXPLORE A SAMPLE</div><div className="sample-choices"><button className={image === '/demo/leather.png' ? 'selected' : ''} disabled={!!busy} onClick={() => newImage('/demo/leather.png', 'Caramel leather offcut')}><img src="/demo/leather.png" alt="Caramel leather sample" /><span>Leather<small>Caramel offcut</small></span></button><button className={image === '/demo/fabric.png' ? 'selected' : ''} disabled={!!busy} onClick={() => newImage('/demo/fabric.png', 'Navy canvas remnant')}><img src="/demo/fabric.png" alt="Navy fabric sample" /><span>Fabric<small>Navy canvas</small></span></button></div></div><div className="control-section"><div className="control-title"><h3>Show AI what to keep.</h3><span>{points.length}/32 points</span></div><p className="help">Green points select material. Red points identify the tabletop or anything to leave out.</p><div className="tool-buttons"><button className={tool === 'foreground' ? 'active' : ''} disabled={!!busy} onClick={() => setTool('foreground')}><CirclePlus size={16} />Material point</button><button className={tool === 'background' ? 'active' : ''} disabled={!!busy} onClick={() => setTool('background')}><CircleMinus size={16} />Background point</button></div><button className="text-button" disabled={!!busy || !points.length} onClick={() => { setPoints(current => current.slice(0, -1)); setMask(null); clearEdits(); setModelScore(null); invalidateMask(); setNotice('Prompt changed. Run image AI again to get an updated mask.'); }}><RotateCcw size={13} />Undo last point</button><button className="button primary full" disabled={!!busy || !imageLoaded || !points.some(point => point.label)} onClick={() => void segment()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}Run image AI <ArrowRight size={17} /></button><p className="privacy-caption"><ShieldCheck size={13} />SlimSAM runs in this browser. First load downloads model files.</p><button className="text-button manual-link" disabled={!!busy} onClick={manualMask}>Prefer to trace it? Start a manual mask <ArrowRight size={12} /></button></div></>}
          {step === 'review' && <><div className="inspector-heading"><span className="eyebrow">02 / A MAKER’S EYE MATTERS</span><h2>Make it cut-worthy.</h2><p>AI finds the shape. You know the material.</p></div>{!mask ? <div className="control-section"><p className="help">Start with image AI or paint a manual mask before reviewing the remnant.</p><button className="button primary full" onClick={() => goStep('photo')}>Go to photograph <ArrowRight size={16} /></button><button className="text-button" onClick={manualMask}>Start manual mask</button></div> : <><div className="control-section"><div className="control-title"><h3>Refine & protect.</h3><span className="subtle-tag">GREEN = USABLE</span></div><div className="tool-buttons three"><button className={tool === 'add' ? 'active' : ''} disabled={!!busy} onClick={() => setTool('add')}><Plus size={15} />Add</button><button className={tool === 'erase' ? 'active' : ''} disabled={!!busy} onClick={() => setTool('erase')}><Minus size={15} />Erase</button><button className={tool === 'defect' ? 'active' : ''} disabled={!!busy} onClick={() => setTool('defect')}><Circle size={15} />Defect</button></div><button className="text-button" disabled={!!busy || !undoCount} onClick={undoEdit}><RotateCcw size={13} />Undo last material edit</button><label className="range-label" htmlFor="brush-size">{tool === 'defect' ? 'Exclusion radius' : 'Brush radius'}<span>{brush} mask px</span></label><input id="brush-size" type="range" min={3} max={60} value={brush} disabled={!!busy} onChange={event => setBrush(Number(event.target.value))} /><p className="help">{tool === 'defect' ? 'Click scars, holes, stains or weak spots. Give each a generous safety margin.' : 'Drag over the photograph. Only the green area will be considered for cutting.'}</p>{sample && !exclusions.length && <button className="text-button" onClick={() => { rememberEdit(); setExclusions([{ x: image.includes('fabric') ? .790 : .694, y: image.includes('fabric') ? .682 : .668, r: .035 }]); invalidateMask(); }}>Mark the sample’s visible defect <Circle size={12} /></button>}{exclusions.length > 0 && <div className="defect-list">{exclusions.map((item, index) => <div key={index}><span><Circle size={12} />Defect {index + 1}<small>radius ≈ {(item.r * widthMm).toFixed(1)} mm</small></span><button aria-label={`Remove defect ${index + 1}`} disabled={!!busy} onClick={() => { rememberEdit(); setExclusions(current => current.filter((_, i) => i !== index)); invalidateMask(); }}><X size={14} /></button></div>)}</div>}<label className="confirmation"><input type="checkbox" checked={reviewed} disabled={!!busy || materialFraction === 0} onChange={event => { setReviewed(event.target.checked); setPlan(null); }} /><span>I’ve checked the material edges and excluded defects.<small>Include only material you would actually cut.</small></span></label></div><div className="control-section"><div className="control-title"><h3>Set the real-world scale.</h3><span className="subtle-tag">REQUIRED</span></div><p className="help">Enter the measured width of the <strong>entire photograph</strong>, from its left edge to its right edge. This is not the offcut width.</p><div className="input-unit"><label className="sr-only" htmlFor="photo-width">Full photograph width in millimeters</label><input id="photo-width" type="number" min={50} max={3000} value={widthMm} disabled={!!busy} onChange={event => { setWidthMm(Number(event.target.value)); setCalibrated(false); setPlan(null); }} /><span>mm</span></div>{sample && <p className="sample-disclosure">Synthetic sample: 300 mm is an assumed demonstration scale, not a physical measurement.</p>}{!sample && <details className="reference-calibration"><summary>Have a ruler in the photograph?</summary><p className="help">Click two ruler marks in the same flat plane as your material, then enter the measured distance between them.</p><button className="button outline full" disabled={!!busy} onClick={() => { setTool('calibrate'); setReferencePoints([]); setCalibrated(false); setPlan(null); }}>Mark two reference points <MousePointer2 size={14} /></button><label className="field-label" htmlFor="reference-distance">Distance between marks (mm)</label><input id="reference-distance" type="number" min={1} value={referenceMm} disabled={!!busy} onChange={event => { setReferenceMm(Number(event.target.value)); setCalibrated(false); setPlan(null); }} /><button className="text-button" disabled={!!busy || referencePoints.length !== 2} onClick={() => { try { setWidthMm(Math.round(calibratePhotoWidth(referencePoints[0], referencePoints[1], referenceMm, imageSize.width, imageSize.height) * 100) / 100); setCalibrated(false); setPlan(null); setTool('defect'); setNotice('Photo width calculated from your reference. Check the value, then confirm the measured scale.'); } catch (caught) { setError((caught as Error).message); } }}>Apply measured reference <ArrowRight size={13} /></button></details>}<label className="confirmation"><input type="checkbox" checked={calibrated} disabled={!!busy || !Number.isFinite(widthMm) || widthMm < 50 || widthMm > 3000} onChange={event => { setCalibrated(event.target.checked); setPlan(null); }} /><span>{sample ? 'I understand this sample uses an assumed scale.' : 'I measured the full photo width on a flat surface.'}<small>Perspective and wrong scale produce wrong cut dimensions.</small></span></label><button className="button primary full" disabled={!ready || !!busy} onClick={() => setStep('plan')}>Choose what to make <ArrowRight size={17} /></button></div><div className="model-note"><Sparkles size={14} /><span>{model}{modelScore !== null && <small>Initial model’s predicted IoU: {modelScore.toFixed(2)} · not measured accuracy</small>}</span></div></>}</>}
          {step === 'plan' && <><div className="inspector-heading"><span className="eyebrow">03 / MAKE ROOM FOR POSSIBILITY</span><h2>What will it become?</h2><p>Choose the pieces. We’ll find a way to fit.</p></div>{!ready && <div className="review-required"><ShieldCheck size={20} /><p>Review your material and confirm the full photograph scale before planning.</p><button className="button outline full" onClick={() => goStep('review')}>Review material <ArrowRight size={15} /></button></div>}<div className="control-section patterns-section"><div className="control-title"><h3>Your cutting patterns</h3><span>{requested}/100 pieces</span></div>{patterns.map((pattern, index) => <div className="pattern-card" key={pattern.id}><div className="pattern-heading"><span style={{ background: colors[index % colors.length] }} /> <input aria-label={`Pattern ${index + 1} name`} value={pattern.name} maxLength={80} disabled={!!busy} onChange={event => changePattern(pattern.id, { name: event.target.value })} /><button className="icon-button" aria-label={`Remove pattern ${index + 1}`} disabled={!!busy || patterns.length === 1} onClick={() => { setPatterns(current => current.filter(other => other.id !== pattern.id)); setPlan(null); }}><X size={15} /></button></div><div className="pattern-fields"><label>Width <span>mm</span><input type="number" aria-label={`Pattern ${index + 1} width`} min={5} max={3000} value={pattern.widthMm} disabled={!!busy} onChange={event => changePattern(pattern.id, { widthMm: Number(event.target.value) })} /></label><label>Height <span>mm</span><input type="number" aria-label={`Pattern ${index + 1} height`} min={5} max={3000} value={pattern.heightMm} disabled={!!busy} onChange={event => changePattern(pattern.id, { heightMm: Number(event.target.value) })} /></label><label>Quantity<input type="number" aria-label={`Pattern ${index + 1} quantity`} min={1} max={30} value={pattern.quantity} disabled={!!busy} onChange={event => changePattern(pattern.id, { quantity: Number(event.target.value) })} /></label></div><div className="pattern-options"><label className="select-label"><span>Shape</span><select aria-label={`Pattern ${index + 1} shape`} value={pattern.shape} disabled={!!busy} onChange={event => changePattern(pattern.id, { shape: event.target.value as Pattern['shape'] })}><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option></select></label><label className="select-label"><span>Value / piece</span><input type="number" aria-label={`Pattern ${index + 1} value`} min={0} max={1000000} value={pattern.value} disabled={!!busy} onChange={event => changePattern(pattern.id, { value: Number(event.target.value) })} /></label></div><label className="compact-check"><input type="checkbox" checked={pattern.rotate} disabled={!!busy} onChange={event => changePattern(pattern.id, { rotate: event.target.checked })} />Allow 90° rotation <span>uncheck for grain direction</span></label></div>)}<button className="add-pattern" disabled={!!busy || patterns.length >= 12} onClick={() => { setPatterns(current => [...current, { id: crypto.randomUUID(), name: 'New pattern', widthMm: 40, heightMm: 40, quantity: 4, value: 0, shape: 'rectangle', rotate: true }]); setPlan(null); }}><Plus size={15} />Add a pattern</button><div className="layout-settings"><label>Edge clearance <span>mm</span><input aria-label="Edge clearance in millimeters" type="number" min={0} max={30} value={clearanceMm} disabled={!!busy} onChange={event => { setClearanceMm(Number(event.target.value)); setPlan(null); }} /></label><label>Piece spacing <span>mm</span><input aria-label="Piece spacing in millimeters" type="number" min={0} max={30} value={gapMm} disabled={!!busy} onChange={event => { setGapMm(Number(event.target.value)); setPlan(null); }} /></label><label>Currency<select aria-label="Value currency" value={currency} disabled={!!busy} onChange={event => setCurrency(event.target.value as 'INR' | 'USD')}><option value="INR">INR ₹</option><option value="USD">USD $</option></select></label></div>{patternError && <p className="field-error" role="alert">{patternError}</p>}<button className="button primary full" disabled={!ready || !!busy || !!patternError} onClick={() => void generatePlan()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Scissors size={17} />}{plan ? 'Recalculate cutting plan' : 'Generate cutting plan'}<ArrowRight size={17} /></button><p className="privacy-caption">8 layout strategies · conservative raster clearance<br />A useful arrangement, not a guaranteed optimum.</p></div></>}
          {mask && <div className="save-section">{user ? <button className="button outline full" disabled={!!busy || !name.trim() || materialFraction === 0} onClick={() => void saveProject()}><Layers3 size={16} />Save project revision<ArrowUpRight size={15} /></button> : <AuthPanel user={user} className="button outline full" label="Sign in to save this project" />}<small>AI processing is local. Saving uploads the source photo.</small></div>}
        </aside>
      </div>}
      {step === 'plan' && plan && <section className="results-panel"><div className="results-header"><div><div className="eyebrow">THE POSSIBILITIES, LAID OUT</div><h2>From offcut to <em>{plan.placements.length} useful pieces.</em></h2></div><button className="button primary" disabled={!ready || !plan.placements.length || !!busy} onClick={exportSvg}><ArrowDownToLine size={17} />Download cutting SVG</button></div><div className="results-stats"><div><span>Pieces that fit</span><strong>{plan.placements.length}<small> / {requested} requested</small></strong></div><div><span>Usable area occupied</span><strong>{Math.round(plan.utilization * 100)}<small>%</small></strong></div><div><span>Potential piece value</span><strong>{money(plan.potentialValue)}</strong></div><div><span>Compared with first layout</span><strong>+{plan.placements.length - plan.baselineCount}<small> pieces</small></strong></div></div><div className="results-details"><div className="piece-legend">{patterns.map((pattern, index) => <span key={pattern.id}><i style={{ background: colors[index % colors.length] }} />{pattern.name}<strong>{plan.placements.filter(placement => placement.patternId === pattern.id).length}/{pattern.quantity}</strong></span>)}</div><p>{plan.unplaced.length ? `${plan.unplaced.reduce((sum, item) => sum + item.count, 0)} pieces remain unplaced. Try smaller patterns or another remnant.` : 'Every requested piece has a place.'} Planning grid: {plan.gridMm.toFixed(2)} mm. {plan.durationMs} ms.</p></div><div className="export-note"><ShieldCheck size={20} /><p><strong>Measure twice. Cut once.</strong> Print SVG at 100% and verify its 50 mm bar with a ruler. Check your real material, defects and grain before cutting. Potential value uses your per-piece estimates, before labor, material, fees and sales.</p></div></section>}
      <section className="principles"><div><span>01</span><h3>Start with the remnant.</h3><p>Not a perfect rectangle. Not a new sheet. The material you already have.</p></div><div><span>02</span><h3>Keep the maker in control.</h3><p>Review the contour, exclude weak spots, and set a measured scale.</p></div><div><span>03</span><h3>Make something of it.</h3><p>Turn overlooked material into a practical layout and a next step.</p></div></section>
    </main><footer className="site-footer"><a className="wordmark" href="/">second<span>cut</span></a><p>Made by Shivam Gupta. Built for the workshop.</p><span>Less left behind.</span></footer>
  </div>;
}
