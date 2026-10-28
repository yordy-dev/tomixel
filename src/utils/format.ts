export function duration(seconds: number) { const s = Math.max(0, Math.floor(seconds)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); }
export function bytes(size: number) { return size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`; }
export function mediaError(error: unknown) {
  const e = error as Error;
  if (/ENOSPC/.test(e?.message || '')) return 'No queda espacio en el disco. Los fragmentos recibidos se conservan para recuperarlos.';
  if (/EACCES|EPERM/.test(e?.message || '')) return 'Windows no permite escribir o modificar el archivo. Revisa los permisos de la carpeta o si otro programa lo está usando.';
  if (/ENOENT/.test(e?.message || '')) return 'No se encuentra el archivo o la carpeta. Comprueba que la unidad esté conectada.';
  const messages: Record<string, string> = {
    NotAllowedError: 'Permiso denegado o captura cancelada. Revisa los permisos de cámara y micrófono en Windows.',
    NotFoundError: 'No se encontró el dispositivo. Conéctalo y vuelve a intentarlo.',
    NotReadableError: 'No se puede acceder al dispositivo. Puede estar ocupado por otra aplicación.',
    OverconstrainedError: 'El dispositivo no admite esta configuración.',
    AbortError: 'Se canceló la captura.',
    NotSupportedError: 'Este formato de grabación no está disponible.'
  };
  return messages[e?.name] || e?.message || String(error);
}
