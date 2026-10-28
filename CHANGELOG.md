# Historial de cambios

## 1.7.23 - 2026-10-28

### Corregido

- Se serializó la transición entre Electron y React para evitar que la cuenta regresiva o el controlador aparezcan primero con dimensiones incorrectas.
- La cuenta regresiva ocupa el monitor desde su primer fotograma, sin bordes vacíos ni saltos visibles.
- El controlador cambia entre su vista normal y la vista de zoom sin mezclar dimensiones.
- Al regresar a 100 %, el controlador recupera exactamente su tamaño y posición anteriores.
- Reiniciar una grabación mantiene ocultos los estados transitorios.
- Los movimientos tardíos generados por `setBounds` ya no se guardan como movimientos del usuario.

### Verificado

- Tutorial inicial con un perfil nuevo.
- Grabación, reproducción y exportación MP4 sin conexión.
- Cámara, overlays, selección de área, editor, teleprompter y recuperación.
- Cierre a la bandeja, atajos, audio y transiciones de ventana.

### Distribución

- Instalador publicado: `Tomixel.Setup.1.7.23.exe`.
- SHA-256: `1CBD5DDAFDED701D4DEBF0FDB16DEBD087317DB74BECDCD4602F4422E1CDF7FA`.
