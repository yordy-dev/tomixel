# Historial de cambios

## 1.7.24 - 2026-11-01

### Mejorado

- El editor usa una vista MP4 indexada con los FPS reales y una forma de onda generada sin cargar el video completo en memoria.
- La línea de tiempo admite hasta 100 tramos, guarda cada cambio de inmediato y permite cancelar una exportación con progreso visible.
- La exportación respeta orientación horizontal o vertical, valida espacio disponible y conserva el original si se cancela o falla.
- Los atajos predeterminados evitan combinaciones comunes de navegadores; pueden quedar sin asignar o usar una o dos teclas modificadoras.
- Detener mediante el atajo de grabación exige una segunda pulsación para evitar terminar una toma por accidente.
- La caché del editor se limpia al iniciar y también puede limpiarse manualmente desde Ajustes.
- Ayuda muestra la versión instalada, los textos inferiores son más legibles y “reducir movimiento” de Windows se respeta en toda la interfaz.

### Corregido

- La aplicación deja de quedar bloqueada en “Preparando dispositivos” cuando Windows no responde al abrir una cámara o micrófono.
- Los índices de biblioteca o ajustes dañados conservan una copia de respaldo y se reconstruyen con valores seguros.
- Eliminar desde la biblioteca mueve el video a la Papelera de Windows y restaura el estado si la operación falla.
- La vista del editor recibe correctamente su URL, FPS y forma de onda mediante IPC.
- Los nombres reservados de Windows y los títulos terminados en punto o espacio ya no rompen la exportación.
- Los atajos antiguos sin personalizar se migran; los atajos personalizados del usuario se conservan.
- El mensaje de privacidad aclara que el tiempo depende del equipo y del disco, no de un límite impuesto por Tomixel.
- Una eliminación interrumpida se recupera al iniciar y reemplazar un MP4 existente conserva el archivo anterior hasta completar el nuevo.

### Verificado

- Hardware real, cámara, micrófono, audio del sistema, selección de ventana y de área, zoom, overlays, teleprompter y tutorial.
- Editor, capturas al portapapeles, recuperación, biblioteca, Papelera, exportación MP4, reinicio y persistencia.

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
