import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Monitor, AppWindow, RefreshCw, ScanLine, Check } from 'lucide-react';
import type { CaptureArea, Source } from '../../shared/types';
import { Header } from '../components/ui';

type SourceTab = 'screen' | 'window' | 'area';

export function SourcePicker({ select, back, error }: { select: (s: Source) => void; back: () => void; error: (e: unknown) => void }) {
  const [sources, setSources] = useState<Source[]>([]), [tab, setTab] = useState<SourceTab>('screen'), [loading, setLoading] = useState(true);
  const [areaSource, setAreaSource] = useState<Source | null>(null), [crop, setCrop] = useState<CaptureArea | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  async function refresh() {
    setLoading(true);
    try {
      const next = await window.desktop.sources(); setSources(next);
      setAreaSource(current => next.find(s => s.id === current?.id) || next.find(s => s.id.startsWith('screen')) || null);
    } catch (e) { error(e); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  function point(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  }
  function updateCrop(current: { x: number; y: number }) {
    if (!dragStart.current) return;
    const start = dragStart.current;
    setCrop({ x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y) });
  }
  const screens = sources.filter(s => s.id.startsWith('screen'));
  const validCrop = !!crop && crop.width >= .05 && crop.height >= .05;
  return <><Header title="Elegir qué grabar" back={back} /><main className="page-content"><div className="page-heading"><div><h1>Elige tu escenario</h1><p>Comparte una pantalla, una ventana o solamente el área que marques.</p></div><button className="icon-button" aria-label="Actualizar fuentes" onClick={() => void refresh()}><RefreshCw size={19} /></button></div>
    <div className="segment source-tabs"><button className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}><Monitor size={17} />Pantallas</button><button className={tab === 'window' ? 'active' : ''} onClick={() => setTab('window')}><AppWindow size={17} />Ventanas</button><button className={tab === 'area' ? 'active' : ''} onClick={() => setTab('area')}><ScanLine size={17} />Seleccionar área</button></div>
    {tab !== 'area' ? <div className="sources-grid">{loading ? <p className="muted">Buscando fuentes disponibles…</p> : sources.filter(s => s.id.startsWith(tab)).map(s => <button className="source-tile" key={s.id} onClick={() => select(s)}><img src={s.thumbnail} alt={`Vista previa de ${s.name}`} /><span>{s.icon && <img className="app-icon" src={s.icon} alt="" />}<strong>{s.name}</strong></span></button>)}</div> : <section className="area-picker">
      {screens.length > 1 && <div className="area-screens" aria-label="Pantalla para seleccionar área">{screens.map(screen => <button key={screen.id} className={areaSource?.id === screen.id ? 'active' : ''} onClick={() => { setAreaSource(screen); setCrop(null); }}><Monitor size={14} />{screen.name}</button>)}</div>}
      {loading ? <p className="muted">Preparando la vista previa…</p> : areaSource ? <>
        <div className="area-instructions"><ScanLine size={17} /><span>Arrastra sobre la vista previa para marcar el área que quieres grabar.</span></div>
        <div className="area-actions"><span>{validCrop ? 'El área marcada será el tamaño del video.' : 'Marca un área de al menos 5% de ancho y alto.'}</span><button className="primary" disabled={!validCrop} onClick={() => validCrop && select({ ...areaSource, name: `Área seleccionada · ${areaSource.name}`, crop: crop! })}><Check size={16} />Usar esta área</button></div>
        <div className="area-stage" role="img" aria-label="Vista previa para seleccionar el área de grabación"
          onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); const start = point(event); dragStart.current = start; setCrop({ ...start, width: 0, height: 0 }); }}
          onPointerMove={event => updateCrop(point(event))}
          onPointerUp={event => { updateCrop(point(event)); dragStart.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onLostPointerCapture={() => { dragStart.current = null; }}>
          <img src={areaSource.thumbnail} alt="" draggable={false} />
          {crop && <div className="area-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}><span>{areaSource.width && areaSource.height ? `${Math.round(areaSource.width * crop.width)} × ${Math.round(areaSource.height * crop.height)} px` : `${Math.round(crop.width * 100)}% × ${Math.round(crop.height * 100)}%`}</span></div>}
        </div>
      </> : <p className="muted">No se encontró una pantalla disponible.</p>}
    </section>}
    <p className="footnote">Las ventanas minimizadas o protegidas pueden no estar disponibles. Vuelve atrás para cancelar.</p></main></>;
}
