# Tomixel

Tomixel es una grabadora de pantalla local para Windows. Permite capturar la pantalla completa, una ventana o un área, combinar cámara y audio, usar un teleprompter protegido y editar la grabación antes de exportarla.

## Descargar

La versión estable para Windows está disponible en [GitHub Releases](https://github.com/yordy-dev/tomixel/releases/latest).

1. Descarga `Tomixel.Setup.1.7.23.exe`.
2. Ejecuta el instalador y elige la carpeta de instalación.
3. Abre Tomixel y sigue el tutorial inicial.

La suma SHA-256 publicada junto al instalador permite comprobar que el archivo no cambió durante la descarga.

## Funciones principales

- Grabación de pantalla completa, ventanas y áreas seleccionadas.
- Cámara circular redimensionable y reposicionable.
- Micrófono, audio del sistema y reducción de ruido.
- Teleprompter flotante que no aparece en el video final.
- Zoom durante la grabación y atajos configurables.
- Editor con cortes, capturas al portapapeles y exportación MP4.
- Recuperación de grabaciones pendientes.
- Funcionamiento local, sin cuenta ni subida obligatoria a la nube.

## Requisitos

- Windows 10 u 11 de 64 bits.
- Cámara y micrófono opcionales.
- Espacio libre suficiente para los videos temporales y exportados.

## Desarrollo

Se requiere Node.js y npm.

```bash
npm install
npm run dev
```

Comprobaciones principales:

```bash
npm run typecheck
npm test
npm run test:transitions
```

Generar el instalador de Windows:

```bash
npm run package:win
```

## Privacidad

Tomixel procesa y guarda las grabaciones en el equipo. El repositorio no incluye grabaciones, configuraciones personales, resultados de pruebas ni archivos de compilación locales.

## Licencia

Este proyecto se distribuye bajo la [licencia MIT](LICENSE).
