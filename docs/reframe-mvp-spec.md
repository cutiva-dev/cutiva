# Cutiva Reframe — Spec del MVP

Nov 3, 2026 · Wilfredo

## Resumen y alcance

El MVP de Cutiva Reframe convierte un video de cualquier proporción en un clip vertical que sigue a quien habla, analizando todo en el dispositivo, sin servidor y sin IA pagada. Lo entrega el core open source de Cutiva para React web, React Native y Flutter, con un formato abierto (Reframe Track) como contrato entre todas las piezas.

**Integración, no producto nuevo.** Cutiva ya tiene un editor funcionando: el playground en cutiva.ngstudios.co/play, con selector de formato, preview, inspector de clip, timeline, undo/redo, Open/Save project y Export MP4. El reframe se integra a ese editor y a su repo; no se crea otra app, otro editor ni otro design system. Todo lo que esta spec describe como pantalla o componente se monta dentro de lo existente.

**Caso de uso de referencia:** podcast o entrevista de 2 a 4 personas, 16:9 o 4:3, cámara fija o multicámara con cortes, clip de 15 s a 3 min.

**Entra en el MVP**

- Análisis en el dispositivo: cortes de toma, caras, actividad de labios, voz.
- Motor de decisión en Rust (WASM + nativo): hablante activo, histéresis, suavizado, layouts single / split / wide.
- Proporción genérica: cualquier source (16:9, 4:3, 1:1, 21:9, vertical) a 9:16, 4:5 o 1:1.
- Detección de barras negras, metadata de rotación y píxeles no cuadrados.
- Integración en el editor existente: carril de hablantes, corrección por segmento y panel People.
- Segmentos bloqueados por el usuario que sobreviven a un re-análisis.
- Export en web extendiendo el Export MP4 existente; preview en vivo sin re-codificar en las tres plataformas.
- Bindings mínimos para React Native y Flutter: analizar, leer o escribir el track y hacer preview.

**Fuera del MVP (fase 2 o capa cloud)**

- Active Speaker Detection con modelos (Light-ASD, TalkNet) y diarización (pyannote).
- Reconocimiento de identidad entre tomas con embeddings faciales.
- Cuadrícula de videollamada (mosaicos tipo Zoom).
- Estimación del desfase entre audio y labios.
- Análisis reanudable de videos largos en el teléfono.
- Export nativo en React Native y Flutter (AVFoundation, MediaCodec).
- Subtítulos automáticos (solo se reserva su zona segura).

**Referencias visuales:** carpeta `docs/reframe-mockups/` (ver su README).

## Arquitectura

El reframe vive en cuatro capas: las apps dibujan, los adaptadores de plataforma detectan, un solo core en Rust decide y el Reframe Track guarda el resultado. Solo los adaptadores se escriben dos veces (web y móvil); la lógica que define la calidad del resultado existe una sola vez.

```
 React web (@cutiva/reframe)   React Native (@cutiva/reframe-native)   Flutter (cutiva_reframe)
            │                                │                                  │
            ▼                                └───────────────┬──────────────────┘
 Adaptador web                                Adaptador móvil (iOS / Android)
 WebCodecs, mp4box.js,                        AVFoundation, MediaCodec,
 ONNX Runtime Web (WebGPU)                    ONNX Runtime Mobile
            │   observaciones (caras, labios, voz, tomas)   │
            └──────────────────────┬────────────────────────┘
                                   ▼
          reframe-core (Rust, determinista)              Cloud (fase 2)
          segmentación, histéresis, cámara, geometría    mismo core en Rust
          WASM en web · uniffi en RN · FFI en Flutter    + ASD y diarización
          nunca carga modelos ni hace I/O                videos largos
                                   │                              │
                                   ▼                              ▼
          Reframe Track (JSON con schemaVersion): personas, segmentos, layout y cámara
          coordenadas 0–1 · tiempos en ms
```

Las apps leen el track para la preview y el export; la capa cloud (fase 2) corre el mismo core, así que un track hecho en la nube se edita igual en el dispositivo.

La estructura de abajo es la meta para las piezas nuevas. Si el repo de Cutiva ya tiene paquetes o carpetas equivalentes, se usan esos y solo se agrega lo que falte (por ejemplo `crates/`, `spec/` y `fixtures/`); no se mueve ni se renombra nada existente, y no se crea una app de demo aparte porque el playground ya cumple ese papel.

**Piezas nuevas (ubicar según la estructura actual del repo)**

```
├── CLAUDE.md
├── spec/
│   └── reframe-track.schema.json
├── crates/
│   ├── reframe-core/        # Rust puro: schema, geometría, segmentación, cámara
│   ├── reframe-wasm/        # wasm-bindgen
│   └── reframe-ffi/         # uniffi + flutter_rust_bridge
├── packages/                # o donde el repo ya tenga sus paquetes
│   ├── reframe-core/        # npm: WASM + tipos TS
│   ├── reframe-web/         # detectores web, decodificación
│   ├── reframe/             # React: hooks y componentes
│   └── reframe-native/      # React Native
├── dart/cutiva_reframe/     # Flutter
├── fixtures/
│   ├── fetch.sh
│   └── golden/              # observaciones + tracks esperados
└── docs/
    ├── reframe-mvp-spec.md
    ├── reframe-integration-map.md   # lo escribe Claude Code en la Fase 0
    └── reframe-mockups/
```

## Formato Reframe Track (v0.1)

El Reframe Track es un JSON versionado que describe a quién enfocar y cómo en cada momento; es el contrato entre detectores, motor, editor y render. La verdad está en `segments` y `observations`; `camera` es un caché derivado que el core recalcula de forma determinista para cada proporción de salida.

**Reglas del formato**

- Coordenadas normalizadas de 0 a 1 sobre el frame de display (ya aplicadas la rotación y el SAR), redondeadas a 4 decimales.
- Tiempos en milisegundos enteros, derivados del PTS, siempre en tiempo del video original.
- `schemaVersion` obligatorio; el core migra versiones viejas al leer.
- Nunca se guardan embeddings faciales ni recortes de caras: solo IDs, cajas y puntajes.
- `observations` puede ir en un archivo aparte (`<id>.obs.json`) porque crece con la duración.

```json
{
  "schemaVersion": "0.1",
  "source": {
    "id": "sha256:<hash de los primeros 4 MB + duración>",
    "durationMs": 58000,
    "width": 1920, "height": 1080,
    "sar": [1, 1], "rotation": 0,
    "fps": 29.97, "vfr": false,
    "activeArea": { "x": 0.125, "y": 0, "w": 0.75, "h": 1 },
    "hasAudio": true
  },
  "analysis": {
    "engine": "device",
    "coreVersion": "0.1.0",
    "models": { "face": "yunet-2023mar", "landmarks": "mediapipe-face-landmarker", "vad": "silero-vad-v5" },
    "sampleFps": 5,
    "createdAt": "2026-11-03T15:00:00Z"
  },
  "shots": [ { "startMs": 0, "endMs": 22000 } ],
  "people": [
    { "id": "p1", "label": "Speaker A", "kind": "face", "priority": true, "neverFocus": false },
    { "id": "p3", "label": "Off-camera voice", "kind": "voice", "priority": false, "neverFocus": true }
  ],
  "observations": {
    "faces": [ { "tMs": 200, "trackId": "t1", "personId": "p1", "box": [0.225, 0.21, 0.09, 0.16], "conf": 0.93, "lip": 0.31 } ],
    "voice": [ { "startMs": 0, "endMs": 6900, "conf": 0.88 } ]
  },
  "segments": [
    {
      "id": "s1", "startMs": 0, "endMs": 6900,
      "speakers": ["p1"],
      "layout": "auto",
      "focus": ["p1"],
      "resolved": "single",
      "locked": false,
      "reason": "lips+voice"
    }
  ],
  "output": { "aspect": [9, 16], "safeZone": "none", "cameraStyle": 0.5, "maxUpscale": 1.5 },
  "camera": {
    "aspect": [9, 16],
    "keyframes": [ { "tMs": 0, "regions": [ { "x": 0.112, "y": 0, "w": 0.316, "h": 1 } ] } ]
  }
}
```

**Campos clave**

| Campo | Valores | Significado |
| --- | --- | --- |
| `segments[].layout` | `auto`, `single`, `split`, `wide` | Lo que pidió el usuario; `auto` deja decidir al motor |
| `segments[].resolved` | `single`, `split`, `wide` | Lo que el motor decidió; siempre presente |
| `segments[].locked` | `true`, `false` | `true` si el usuario lo editó; el re-análisis no lo toca |
| `segments[].reason` | `lips+voice`, `overlap`, `no-face`, `voice-only`, `never-focus`, `low-quality`, `user` | Por qué se resolvió así; la UI lo muestra |
| `people[].kind` | `face`, `voice` | `voice` = alguien que habla sin cara en pantalla |
| `camera.keyframes[].regions` | 1 región (single, wide) o 2 (split) | Recorte del source por región de salida |

## Motor de decisión

El motor recibe señales crudas de los detectores y produce `segments` y `camera`; es Rust puro, sin I/O ni modelos, y debe dar el mismo resultado byte a byte en las tres plataformas. Un cambio de persona es siempre un corte seco, como lo haría un editor humano; dentro de un segmento la cámara solo hace seguimiento suave.

**Pipeline**

1. **Probe.** Lee duración, fps, VFR, rotación, SAR y si hay audio. Si el source ya tiene la proporción de salida (±2%), marca el track como passthrough y termina.
2. **Área activa.** Muestrea 20 frames repartidos en el video; una columna o fila es barra si su luminancia media es menor a 16 en al menos el 80% de las muestras. El resto del pipeline trabaja solo dentro de `activeArea`.
3. **Tomas.** Diferencia de histograma HSV a 10 fps sobre frames de 64×36; un pico sobre el umbral es un corte.
4. **Caras.** Detección a `sampleFps` (5) sobre el área activa reducida a 320 px de lado mayor. Se descartan caras de menos del 4% de la altura del frame o con confianza menor a 0.6.
5. **Tracking.** Dentro de cada toma, emparejamiento por IoU (≥ 0.3); huecos de hasta 1 s se rellenan interpolando. Cada toma reinicia los tracks.
6. **Personas.** Sin embeddings en el MVP: los tracks de tomas parecidas (mismo encuadre de cámara, por histograma) en la misma zona del frame se unen en una persona; el resto queda como persona nueva y el usuario las une en el panel People.
7. **Voz.** Silero VAD sobre audio mono a 16 kHz; probabilidad ≥ 0.5, voz mínima de 250 ms, huecos menores a 300 ms se fusionan. Si el audio es estéreo, se guarda el paneo L/R por ventana.
8. **Labios.** Solo durante tramos con voz, landmarks a 10 fps; el puntaje es la desviación estándar de la apertura de boca en una ventana de 500 ms, normalizada por la altura de la cara. Si la boca no es visible (confianza baja de landmarks, típico de un micrófono delante), el puntaje queda nulo, no en cero.
9. **Puntaje de hablante**, por persona y ventana de 200 ms con voz: `0.6 × labios + 0.25 × paneo + 0.15 × continuidad`. Si falta una señal, su peso se reparte entre las demás.
10. **Segmentación.** Se cambia de hablante solo si el nuevo supera al actual por 0.15 durante el tiempo de espera (`holdMs`). Dos personas sobre 0.5 durante 1.5 s o más dan `split`; voz sin ninguna cara candidata durante más de 1 s da `wide` (`voice-only`); sin caras da `wide` (`no-face`). Segmentos de menos de 1 s se funden con el vecino.
11. **Ajuste a cortes.** Un borde de segmento a menos de 400 ms de un corte de toma se mueve al corte, para esconder el cambio.
12. **Preferencias del usuario.** Se aplican `neverFocus`, `priority` (desempata single cuando hablan dos) y los segmentos `locked`, que pasan tal cual.
13. **Cámara.** Para cada región se calcula el centro objetivo con la caja de la cara (headroom: el borde superior de la cara al 12% del alto del recorte). Se aplica una zona muerta, un filtro One Euro y una velocidad máxima, y el recorte se limita al área activa.
14. **Calidad.** Si el recorte obliga a escalar más de `maxUpscale`, el segmento no bloqueado pasa a `wide` con `reason: low-quality` y la UI avisa.
15. **Zona segura.** Con un preset de plataforma, el centro vertical se desplaza para que la cara quede fuera de las zonas tapadas por la interfaz de la app.

**Tamaño del recorte.** Con un área activa de W × H píxeles y una salida de proporción r = ancho / alto:

- si W / H > r: alto del recorte = H, ancho = H × r
- si no: ancho del recorte = W, alto = W / r

En el MVP no hay zoom extra en `single`: el recorte usa todo el alto (16:9 a 9:16 da el 31.6% del ancho; 4:3 a 9:16, el 42%). En `split`, cada mitad de salida es 9:8 y su recorte se dimensiona para que la cara ocupe cerca del 35% del alto de la región.

**Parámetros por defecto**

| Parámetro | Calm (0) | Balanced (0.5) | Dynamic (1) |
| --- | --- | --- | --- |
| `holdMs` (espera para cambiar) | 1600 | 1000 | 400 |
| Segmento mínimo (ms) | 1500 | 1000 | 600 |
| Zona muerta (% del ancho del recorte) | 6 | 4 | 2 |
| One Euro `minCutoff` (Hz) | 0.3 | 0.8 | 1.5 |
| Velocidad máxima (anchos de recorte por s) | 0.15 | 0.25 | 0.4 |

Los valores intermedios se interpolan linealmente con `cameraStyle`. Todos son números de partida: se calibran con el set de videos de prueba.

## Detectores, modelos y licencias

Los detectores son plugins por plataforma detrás de tres interfaces pequeñas; usan los mismos modelos en ONNX en todas partes para que las señales sean comparables. El core en Rust nunca carga un modelo: solo recibe observaciones.

```ts
interface FrameSource {
  probe(): Promise<ProbeInfo>;
  frames(o: { fps: number; maxSide: number; region?: Rect }): AsyncIterable<Frame>;
  audio(o: { sampleRate: 16000; mono: boolean }): AsyncIterable<AudioChunk>;
}
interface FaceDetector { detect(f: Frame): Promise<FaceBox[]> }
interface MouthTracker { openness(f: Frame, face: FaceBox): Promise<{ value: number | null; conf: number }> }
interface VoiceActivity { push(c: AudioChunk): VadFrame[]; flush(): VadFrame[] }
```

**Runtime por plataforma (MVP)**

| Pieza | React web | React Native | Flutter |
| --- | --- | --- | --- |
| Core de decisión | Rust → WASM | Rust → JSI (uniffi) | Rust → FFI (flutter_rust_bridge) |
| Decodificar frames | WebCodecs + mp4box.js | AVFoundation / MediaCodec | AVFoundation / MediaCodec |
| Inferencia | ONNX Runtime Web (WebGPU, respaldo WASM SIMD) | ONNX Runtime Mobile | ONNX Runtime Mobile |
| Preview | CSS transform sobre el video del preview existente | Transform nativo sobre la vista de video | `Transform` + `ClipRect` sobre el video |
| Export | Export MP4 existente + recorte | Fase 2 | Fase 2 |

**Modelos**

| Uso | Modelo | Licencia | Estado |
| --- | --- | --- | --- |
| Detección de caras | YuNet (OpenCV Zoo) | MIT según el zoo | Confirmar antes del release |
| Landmarks de boca | MediaPipe Face Landmarker | Apache 2.0 | Confirmar la licencia del archivo del modelo |
| Voz | Silero VAD v5 | MIT | OK |
| Runtime de inferencia | ONNX Runtime | MIT | OK |
| Identidad entre tomas | InsightFace / ArcFace | Modelos solo para uso no comercial | Excluido del core |
| Hablante activo | Light-ASD, TalkNet | Revisar código y datos de entrenamiento | Fase 2, capa cloud |
| Diarización | pyannote | Modelos con términos de acceso | Fase 2, capa cloud |

Los modelos no van dentro del paquete npm ni pub: se descargan la primera vez desde un CDN propio con hash SHA-256 fijado en el código, y se cachean (Cache Storage en web, directorio de la app en móvil). El paquete expone `modelBaseUrl` para que cada developer pueda servirlos desde su propio dominio.

## API pública

Las tres plataformas exponen la misma forma: `analyze` produce un track, `resolve` lo recalcula tras una edición, y un componente de preview lo dibuja sobre el video.

En el playground no se usa `ReframeEditor` como pantalla aparte: sus piezas (`ReframePreview`, la sección Auto-reframe del inspector, People y los carriles del timeline) se montan dentro del editor existente. `ReframeEditor` queda como composición opcional para developers que no tengan editor propio.

| Paquete | Registro | Contenido |
| --- | --- | --- |
| `@cutiva/reframe-core` | npm | WASM del core + tipos TS del Reframe Track |
| `@cutiva/reframe-web` | npm | Detectores web, decodificación |
| `@cutiva/reframe` | npm | Hooks y componentes React (`useReframe`, `ReframePreview`, piezas del inspector y timeline) |
| `@cutiva/reframe-native` | npm | Turbo Module + `ReframePreview` para React Native |
| `cutiva_reframe` | pub.dev | Plugin Flutter con FFI + widget `ReframePreview` |

**Core sin UI** (mismo contrato en todas las plataformas)

```ts
const track = await analyze(source, options, { signal, onProgress });
const next  = resolve(editTrack(track, { segmentId: 's4', layout: 'single', focus: ['p2'] }));
const crop  = cropAt(next, 25400); // regiones de recorte en el ms 25400
```

**React (forma orientativa; adaptar a cómo el editor existente maneja clips y estado)**

```tsx
const { track, setTrack, status, progress } = useReframe(clip.source, {
  aspect: projectFormat.aspect, // viene del selector Format existente
  cameraStyle: 0.5,
});
```

**React Native**

```tsx
import { analyze, ReframePreview } from '@cutiva/reframe-native';

const track = await analyze({ uri: video.uri }, { aspect: [9, 16] });
<ReframePreview source={{ uri: video.uri }} track={track} style={{ aspectRatio: 9 / 16 }} />
```

**Flutter**

```dart
final track = await CutivaReframe.analyze(File(path), aspect: const Aspect(9, 16));
ReframePreview(controller: videoController, track: track);
```

Reglas de la API: todo `analyze` acepta un `AbortSignal` (o token de cancelación en Dart) y reporta progreso de 0 a 1; los errores son tipados (`UnsupportedCodec`, `NoVideoTrack`, `ModelLoadFailed`, `Aborted`); el track devuelto siempre valida contra el JSON Schema de la versión.

## UI/UX en el editor existente

El reframe se integra al editor que ya existe en el playground; no hay pantalla nueva. El principio es automático primero y corrección con un clic después: el usuario nunca pone keyframes a mano. Los mockups de `docs/reframe-mockups/` muestran las piezas y sus estados; su layout de pantalla completa es solo referencia visual, no un layout a copiar. `playground-actual.png` muestra el editor de hoy.

**Dónde vive cada pieza en el editor existente**

- **Format (barra superior):** el selector existente define la proporción de salida. Al pasar de un formato horizontal a uno vertical o cuadrado, los clips de video ofrecen Auto-reframe.
- **Inspector del clip (panel derecho):** al seleccionar un clip aparece una sección Auto-reframe debajo de volumen, velocidad y fades, con Analyze, el layout del segmento, Camera style, Reset to automatic y Apply to every clip.
- **People:** una sección o pestaña del mismo inspector con las personas del clip (color, nombre, Priority, Never focus).
- **Preview (centro):** el preview existente muestra la salida en el formato elegido. Un toggle Show source alterna al video original con el recuadro de recorte y las caras clicables.
- **Timeline (abajo):** debajo de la pista del clip se agregan los carriles Speakers y Camera, solo en clips con reframe. Playhead, zoom y selección son los del timeline existente.
- **Undo/redo, Save project y Export MP4:** los existentes. Cada edición de reframe entra al historial de undo y se guarda en el proyecto; Export MP4 aplica el recorte.

**Interacciones**

| Acción | Resultado en el track |
| --- | --- |
| Clic en un segmento del carril | Selecciona el segmento; el playhead salta a su mitad |
| Clic en una cara del source | `focus` = esa persona, `layout` = `single`, `locked` = true |
| Elegir un layout | `layout` = el elegido, `locked` = true |
| Reset to automatic | `layout` = `auto`, `focus` vacío, `locked` = false |
| Never focus en una persona | Se recalculan todos los segmentos no bloqueados |
| Mover Camera style | Cambia `output.cameraStyle`; se recalculan segmentación y cámara |
| Unir dos personas en People | Reasigna `personId` en las observaciones y recalcula |

Toda edición llama a `resolve` en el core y la preview se actualiza en menos de 100 ms para un clip de 3 min; si tarda más, la edición se aplica de forma optimista y la cámara se recalcula en un worker.

**Estados especiales** (mockup `estados-edge-cases.html`)

| Estado | Cuándo | Qué ofrece la UI |
| --- | --- | --- |
| Already vertical | Passthrough en el probe | Export as is, Adjust framing |
| Low quality crop | Escalado mayor a `maxUpscale` | Use Wide + blur, Keep crop |
| Bars removed | `activeArea` menor al frame | Ver y editar el área activa |
| No faces | Segmento con `reason: no-face` | Wide automático, Crop to center |
| Safe zones | Preset de plataforma activo | Superposición de las zonas tapadas |
| Analizando | Durante `analyze` | Progreso real por etapa y Cancel |
| Códec no soportado | Error `UnsupportedCodec` | Mensaje claro y formatos aceptados |

En móvil (React Native / Flutter) la misma lógica se condensa: preview grande, chips de Focus on, control segmentado de Layout, mini carril de hablantes y toque sobre la cara para cambiar el foco (mockup `editor-movil.html`).

## Edge cases y reglas

Cada caso tiene una regla determinista en el core y un test con un video de muestra; los marcados como Fase 2 solo deben degradar sin romper (caer a `wide` y avisar).

| Caso | Cómo se detecta | Comportamiento | Fase |
| --- | --- | --- | --- |
| Source 4:3, 1:1, 21:9 | Probe | Fórmula general de recorte; nada fijo a 16:9 | MVP |
| Source ya vertical | Proporción igual a la salida ±2% | Passthrough, sin análisis | MVP |
| Source más angosto que la salida (9:16 a 1:1) | W/H menor que r | Recorte en Y, la cámara sigue en vertical | MVP |
| Barras negras quemadas | Paso de área activa | Todo se calcula dentro de `activeArea` | MVP |
| Vertical resubido con laterales difuminados | Varianza baja y bordes borrosos en columnas laterales | Igual que barras; si falla, el usuario edita el área activa | MVP |
| Rotación en metadata | Probe | Se aplica al decodificar; coordenadas ya rotadas | MVP |
| Píxeles no cuadrados | SAR ≠ 1:1 | Se calcula con la proporción de display | MVP |
| Baja resolución | Escalado mayor a `maxUpscale` | `wide` + aviso, salvo segmento bloqueado | MVP |
| VFR | Probe | Todo por PTS en ms, nunca por índice de frame | MVP |
| Sin pista de audio | `hasAudio: false` | Solo labios; sin señal útil, `wide` | MVP |
| Sin caras (slides, b-roll) | Toma sin detecciones | `wide`, `reason: no-face` | MVP |
| Muchas caras o público | Más de 4 candidatas | Se ignoran caras pequeñas; tope de 4 candidatas por toma | MVP |
| Micrófono tapando la boca | Confianza baja de landmarks | Labios nulos; deciden voz, paneo y continuidad | MVP |
| Persona en el borde | Recorte fuera del área | Se limita al área; la cara queda descentrada | MVP |
| Dos personas muy juntas | Ambas caben en un recorte | `single` encuadrando a las dos, sin split | MVP |
| Close-up más ancho que el recorte | Caja de cara mayor al recorte | Se centra la cara, sin zoom | MVP |
| Multicámara con cortes | Tomas | Tracks reinician por toma; los cambios se ajustan a los cortes | MVP |
| Interrupciones cortas ("ajá") | Duración menor al mínimo | Se funden con el segmento vecino | MVP |
| Labios sin voz (risa, asentir) | Labios altos sin VAD | No cuenta como habla | MVP |
| Voz sin cara (fuera de cuadro, voz en off) | VAD sin candidata | Persona `voice` y `wide` | MVP |
| Persona sale y vuelve | Track nuevo en otra toma | Persona nueva; el usuario las une en People | MVP |
| Clip que empieza a mitad de segmento | Rango del clip | Se analiza con 2 s de contexto a cada lado | MVP |
| Detecciones perdidas | Huecos en el track | Interpolación hasta 1 s; luego se mantiene la última posición | MVP |
| Texto quemado en el source | Fase 2: detector de texto | MVP: no se detecta; el usuario ajusta | Fase 2 |
| Cuadrícula de videollamada | Fase 2: detección de mosaicos | MVP: se trata como una sola toma | Fase 2 |
| Audio desfasado | Fase 2: correlación audio-labios | MVP: sin corrección | Fase 2 |
| HDR | Probe | MVP: export en SDR sin tone-mapping fino; aviso | Fase 2 |
| Video largo en móvil | Duración | MVP: límite recomendado de 20 min en móvil; arriba, aviso y opción cloud | Fase 2 |
| Códec no soportado | Fallo de decodificador | Error `UnsupportedCodec` con mensaje claro | MVP |

**Privacidad:** ninguna imagen, cara ni audio sale del dispositivo en el modo `device`; el track no guarda embeddings. Esto se documenta en el README porque las caras son datos biométricos en varias jurisdicciones.

## Plan de tareas para Claude Code

El MVP se construye en 7 fases (0 a 6), cada una cerrada por una condición verificable antes de pasar a la siguiente.

**Fase 0 — Reconocer el repo existente y fijar el contrato**

> Adaptada según `docs/reframe-integration-map.md` (decisiones del 2026-11-03): core en TS + Dart, sin Rust; el track vive en el efecto `core/reframe` del proyecto (ADR 0006).

- [x] Leer el repo actual de Cutiva y el playground: estructura, estado del editor, modelo de proyecto, timeline, inspector, selector de formato, undo/redo y export. Escribir `docs/reframe-integration-map.md` con dónde se conecta cada pieza nueva.
- [x] Agregar solo lo que falte (Cargo workspace en `crates/`, `spec/`, `fixtures/`), sin mover ni renombrar lo existente. *Hecho: `spec/` y `fixtures/`; sin `crates/` (no hay Rust).*
- [x] Escribir el JSON Schema del Reframe Track v0.1 en `spec/reframe-track.schema.json` y generar tipos TS y structs Rust desde él. *Hecho: el schema describe los params de `core/reframe` (`keys` + `track` v1); los tipos siguen escritos a mano en `types.ts` y `types.dart`, como el resto de CPF.*
- [x] Extender el CI existente con `cargo test`, golden files y validación del schema. *Hecho: `packages/core/test/reframe-schema.test.ts` corre en `npm test` (job `check`) y valida los ejemplos de `spec/examples/` y cada efecto `core/reframe` de `conformance/fixtures`. Sin `cargo test`; los golden files de vídeo real pasan a ser un benchmark por umbrales (mapa, conflicto 10).*
- [x] Script `fixtures/fetch.sh` que descarga los videos de prueba (con licencia libre) y sus tracks esperados. *Hecho, con hash SHA-256 fijado; el manifiesto está vacío hasta que el maintainer aporte los vídeos.*
- [ ] **Condición:** el mapa de integración está revisado antes de escribir código de UI, y el CI pasa con un track de ejemplo que valida contra el schema.

**Fase 1 — Core en Rust (sin video)**

- [ ] `reframe-core`: tipos, migración de versiones y validación.
- [ ] Geometría: fórmula de recorte, área activa, clamp, split 9:8, zona segura.
- [ ] Segmentación: puntaje de hablante, histéresis, overlap, `no-face`, `voice-only`, segmento mínimo, ajuste a cortes, `locked`.
- [ ] Cámara: zona muerta, One Euro, velocidad máxima, cortes secos entre personas.
- [ ] API: `resolve(track)`, `cropAt(track, tMs)`, `editTrack(track, edit)`.
- [ ] **Condición:** tests con observaciones sintéticas (JSON) para cada regla de la tabla de edge cases marcada MVP; salidas iguales a los golden files.

**Fase 2 — Bindings**

- [ ] WASM con `wasm-bindgen` → `@cutiva/reframe-core`.
- [ ] uniffi → Kotlin y Swift para `@cutiva/reframe-native`.
- [ ] `flutter_rust_bridge` para `cutiva_reframe`.
- [ ] **Condición:** el mismo test de golden files pasa en WASM (Node), iOS, Android y Flutter con salida idéntica byte a byte.

**Fase 3 — Detectores web y análisis**

- [ ] Probe, área activa y tomas con WebCodecs + mp4box.js en un Web Worker.
- [ ] YuNet y Face Landmarker en ONNX Runtime Web (WebGPU con respaldo WASM).
- [ ] Silero VAD sobre el audio decodificado con WebAudio.
- [ ] Descarga de modelos con hash fijado y caché; `analyze()` con progreso y cancelación.
- [ ] **Condición:** un clip de 3 min se analiza en menos de 60 s en un portátil de gama media y coincide con el track esperado del fixture dentro de las tolerancias.

**Fase 4 — Integración en el editor existente**

- [ ] `ReframePreview` como capa sobre el preview existente, respetando el selector Format.
- [ ] Sección Auto-reframe y People en el inspector del clip, con los componentes y estilos que ya usa el playground.
- [ ] Carriles Speakers y Camera dentro del timeline existente.
- [ ] Ediciones de reframe dentro del historial de undo/redo y del archivo de proyecto (Open/Save project).
- [ ] **Condición:** en el playground se importa un video, se cambia Format a 9:16, se analiza un clip y funcionan las interacciones de la tabla; cada edición se ve en el preview en menos de 100 ms y se puede deshacer.

**Fase 5 — Export web**

- [ ] Extender el Export MP4 existente para aplicar `cropAt` por frame y los layouts split y wide + blur.
- [ ] **Condición:** el MP4 exportado coincide con la preview frame a frame (tolerancia de 1 px en el recorte).

**Fase 6 — Móvil (análisis + preview)**

- [ ] Detectores con ONNX Runtime Mobile y decodificación nativa en iOS y Android.
- [ ] `analyze` y `ReframePreview` en React Native y Flutter, con apps de ejemplo mínimas.
- [ ] **Condición:** el fixture de 3 min se analiza en un teléfono de gama media en menos de 3 min y da el mismo track que en web dentro de las tolerancias.

## Tests y criterios de aceptación

El MVP está listo cuando los 8 videos del set de fixtures pasan sus tracks esperados en web y el core da la misma salida en las cuatro plataformas. Los tracks esperados se etiquetan a mano una vez (quién habla en cada tramo) y quedan como golden files.

**Set de fixtures** (videos cortos, de 1 a 3 min, con licencia que permita redistribuirlos)

| Fixture | Qué prueba |
| --- | --- |
| `podcast-2p-16x9` | Caso base: dos personas, cámara fija, micrófonos delante de la boca |
| `podcast-3p-multicam` | Cortes de toma, plano de reacción, tres personas |
| `interview-4x3-letterbox` | 4:3 dentro de 16:9 con barras negras |
| `vertical-9x16` | Passthrough |
| `phone-rotated` | Metadata de rotación |
| `lowres-480p` | Aviso de baja calidad y caída a wide |
| `slides-and-voice` | Segmentos sin caras y voz en off |
| `crosstalk` | Dos personas hablando a la vez, interrupciones cortas |

**Métricas y umbrales**

| Métrica | Umbral del MVP |
| --- | --- |
| Acierto de hablante (tiempo con la persona correcta en foco / tiempo con voz) | ≥ 85% en los fixtures de podcast |
| Cambios de cámara por minuto en Balanced | ≤ 8 en `podcast-2p-16x9` |
| Jitter del recorte dentro de un segmento | Desplazamiento menor a 0.5% del ancho del recorte entre frames, en el 95% de los frames |
| Determinismo entre plataformas | Track idéntico byte a byte con las mismas observaciones |
| Tiempo de `resolve` tras una edición | < 100 ms para 3 min de video |
| Análisis en web | < 60 s para 3 min en un portátil de gama media |

**Tipos de test**

- **Unitarios del core:** una observación sintética por regla de la tabla de edge cases.
- **Golden files:** observaciones reales grabadas de cada fixture → track esperado; corren en CI sin decodificar video.
- **Propiedades:** con observaciones aleatorias, el recorte nunca sale del área activa, ningún segmento dura menos del mínimo y los segmentos `locked` no cambian.
- **End-to-end web:** Playwright abre el playground, importa un fixture, espera el análisis, hace una edición y exporta; compara el MP4 con la preview.

## Reglas para Claude Code

Están en `CLAUDE.md`, en la raíz del repo.
