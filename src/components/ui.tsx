import { ArrowLeft, Minus, X, ChevronRight } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`brand-record-mark ${className}`} aria-hidden="true"><i /></span>;
}

export function Wordmark() {
  return <span className="brand-wordmark" aria-label="Tomixel"><span>T</span><BrandMark className="brand-wordmark-o" /><span>MIXEL</span></span>;
}
export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return <button className="toggle" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span />{checked ? 'ON' : 'OFF'}</button>;
}
export function Header({ title, back }: { title?: string; back?: () => void }) {
  return <header className="titlebar"><div className="brand">{back ? <><button className="icon-button" aria-label="Volver" onClick={back}><ArrowLeft size={18} /></button><span>{title}</span></> : <Wordmark />}</div><div className="window-actions"><button className="icon-button" aria-label="Minimizar" onClick={() => void window.desktop.minimize()}><Minus size={17} /></button><button className="icon-button" aria-label="Cerrar" onClick={() => void window.desktop.close()}><X size={18} /></button></div></header>;
}
export function Meter({ level, showScale = false }: { level: number; showScale?: boolean }) {
  const db = level > 0 ? Math.max(-60, 20 * Math.log10(level)) : -60;
  const width = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
  const status = db >= -3 ? 'Saturando' : db >= -9 ? 'Muy alto' : db >= -18 ? 'Nivel correcto' : db > -50 ? 'Nivel bajo' : 'Sin señal';
  return <div className={`peak-meter ${db >= -3 ? 'clipping' : db >= -9 ? 'hot' : db >= -18 ? 'good' : 'low'}`}>
    <div className="meter" role="meter" aria-label="Pico real del micrófono" aria-valuenow={Math.round(db)} aria-valuemin={-60} aria-valuemax={0} aria-valuetext={`${db.toFixed(1)} dBFS · ${status}`}><div style={{ width: `${width}%` }} /><i style={{ left: `${width}%` }} /></div>
    {showScale && <><div className="meter-scale"><small>-60</small><small>-18</small><small>-9</small><small>-3</small><small>0</small></div><div className="meter-reading"><strong>{status}</strong><span>{db.toFixed(1)} dBFS</span></div></>}
  </div>;
}
export function CameraPreview({ stream, mirror = true, className = '' }: { stream: MediaStream | null; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const video = ref.current; if (!video) return; video.srcObject = stream; if (stream) void video.play().catch(() => {}); return () => { video.pause(); video.srcObject = null; }; }, [stream]);
  return <video ref={ref} muted playsInline className={className} style={{ transform: mirror ? 'scaleX(-1)' : undefined }} />;
}
export function SettingRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) { return <div className="setting-row"><div><span className="setting-label">{label}</span>{hint && <small>{hint}</small>}</div><div className="setting-control">{children}</div></div>; }
export function Select({ value, onChange, options, label, disabled }: { value: string | number; onChange: (value: string) => void; options: [string | number, string][]; label: string; disabled?: boolean }) {
  return <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>{options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>;
}
export function LinkRow({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail?: string; onClick: () => void }) { return <button className="link-row" onClick={onClick}>{icon}<span><strong>{title}</strong>{detail && <small>{detail}</small>}</span><ChevronRight size={16} /></button>; }
