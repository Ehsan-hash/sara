<p align="center"><a href="README.md">English</a> · <b>Español</b> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.it.md">Italiano</a></p>

# Sara

**Una compañera de IA autoalojada, con la personalidad que tú elijas, que además es una
verdadera compañera de programación.** Charla, recuerda, planifica, lee tus documentos y crea y
prueba software en un entorno aislado, en tu propio servidor y con los modelos que tú elijas.

> Esta es una traducción del [README en inglés](README.md). Los enlaces llevan a la documentación,
> que está en inglés.

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-339933" alt="Node 24 or newer">
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen" alt="Zero runtime dependencies">
  <img src="https://img.shields.io/badge/tests-841%20passing-brightgreen" alt="841 tests passing">
  <a href="docs/RESULTS.md"><img src="https://img.shields.io/badge/HumanEval%20pass%401-96.3%25-informational" alt="HumanEval pass@1 96.3%"></a>
  <a href="https://github.com/farena-ai/sara/releases/latest"><img src="https://img.shields.io/github/v/release/farena-ai/sara?label=release" alt="Latest release"></a>
  <a href="https://github.com/farena-ai/sara/pkgs/container/sara"><img src="https://img.shields.io/badge/docker-amd64%20%7C%20arm64-2496ED" alt="Docker image for amd64 and arm64"></a>
  <img src="https://img.shields.io/badge/languages-6-8A2BE2" alt="Six languages">
  <a href="https://glama.ai/mcp/servers/farena-ai/sara"><img src="https://glama.ai/mcp/servers/farena-ai/sara/badges/score.svg" alt="Sara MCP server on Glama"></a>
</p>

<p align="center">
  <img src="docs/screenshots/demo.png" alt="Animated demo: Sara cheers the user up, builds a tip calculator, asks before starting a server, opens a live preview, tests it in her own browser and shows the screenshot she took" width="860">
  <br>
  <sub>Una sesión real y sin editar con un modelo local (qwen3.8 27B en Ollama, una RTX 5090) en un servidor de pruebas desechable: charla con su personalidad, escribe la app, pide permiso antes de arrancar un servidor, abre la vista previa y la prueba en su propio navegador. El último fotograma es la app con números ya escritos.</sub>
</p>

> **Estado:** 2.4, licencia MIT, con quince versiones con novedades desde la 1.0 (todas abajo). La
> [app de Android](https://play.google.com/store/apps/details?id=com.backstagecoding.sara) está en Google
> Play; la app de iPhone y la versión del Mac App Store llegarán en cuanto Apple las apruebe. Lee
> [docs/DISCLOSURES.md](docs/DISCLOSURES.md) antes de usar o compartir Sara.

## Novedades

| Versión | Qué te trae |
|---|---|
| **2.4** · Todo en orden | **Todo más fácil de encontrar:** una barra lateral corta con un menú *Más* desde el que fijar lugares, Ajustes con encabezados de verdad que se pliegan, herramientas y aprobaciones explicadas con palabras sencillas, fotos que puedes borrar del álbum de recuerdos, pantallas y menús más ordenados en todas las apps y un guardado más seguro por dentro. [Qué ha cambiado](CHANGELOG.md) |
| **2.3** · Documentos grandes | **Libros y manuales de 500 a 1.000 páginas** (PDF de hasta 1 GB) en su biblioteca: subidas que se reanudan, cada página escaneada leída, índice y resúmenes por capítulo, y respuestas que citan la página («p. 412») con un enlace directo. 30 de 30 preguntas bien en un libro de prueba de 1.000 páginas. [Cómo funciona](docs/LIBRARY.md) |
| **2.2** · Tus otros servidores por SSH | **Puede trabajar en tus otras máquinas** con contraseña o con clave. Tras iniciar sesión con contraseña **crea su propia clave, te dice dónde está y olvida la contraseña** (solo la guarda si insistes, tras avisarte). Se comprueban las claves del servidor, cada comando sigue sus reglas de aprobación y puedes revocar su clave cuando quieras. [Cómo funciona](docs/SSH.md) |
| **2.1** · Su voz en tu casa | **«Alexa, abre sara companion»**: habla con ella en cualquier Echo con tu propia skill gratuita (verificada como exige Amazon). Hazla tu **asistente de Android** (mantén pulsado inicio), escúchala en altavoces **Google Home / Nest** a través de Home Assistant y deja que **te salude al llegar a casa**. Siri en el iPhone llega con la próxima actualización de la app. [Cómo funciona](docs/VOICE_ASSISTANTS.md) |
| **2.0** · Modo hogar | **Comparte tu servidor de Sara con las personas con las que vives.** Invita a un adulto con un enlace de un solo uso; tendrá sus propias compañeras, chats, memoria, biblioteca y apps en un espacio propio. Tú sigues siendo el administrador: eliges qué modelos usa, pones límites diarios y ves el uso y el coste, nunca lo que dice. [Cómo funciona](docs/HOUSEHOLD.md) |
| **1.10** · Nuestros momentos | **Un álbum de fotos compartido** con tus fotos y las que ella envía, cada una con un pie de foto que escribe con su propia voz a partir de lo que hablabais. Álbumes que se llenan solos (Nosotros, Lugares, Sus looks), «Tal día como hoy», y a veces saca uno: *¿te acuerdas?* Los chats privados quedan fuera salvo que los añadas. [Cómo funciona](docs/MOMENTS.md) |
| **1.9** · Videollamadas | **Mírala mientras habláis:** una videollamada muestra su retrato en movimiento a pantalla completa, con los labios al ritmo de su voz y la cara siguiendo su ánimo, con su ropa y lugar actuales. Activa tu cámara si quieres y ella mira cada pocos segundos (o cuando pulsas *Mira esto*); no se graba nada. [Cómo funciona](docs/VIDEO_CALLS.md) |
| **1.8** · Varios servidores en una app | Ten **todas tus Saras en una sola app** (casa y trabajo, o varias en un servidor) y cambia desde un menú sin cerrar sesión: las apps de Windows y Mac, Android y iPhone, VS Code, `sara-chat` y el puente MCP. Cada una conserva su propio inicio de sesión; los archivos, el micrófono y la cámara solo van a la que estás usando. [Cómo funciona](docs/SERVERS.md) |
| **1.7** · Modo local privado | Un interruptor, **Nada sale de este ordenador**, aplicado en el código en un único punto: solo se puede llegar a este ordenador, los modelos en la nube y las herramientas en línea se pausan, y sus chats, su memoria y su biblioteca siguen funcionando. Las apps de Windows y Mac encuentran Ollama (o te ayudan a instalarlo), sugieren un modelo que cabe en tu tarjeta gráfica y lo descargan con barra de progreso. [Qué garantiza](docs/PRIVATE_LOCAL.md) |
| **1.6** · Chats de grupo | Reúne a **de dos a cuatro de tus compañeras en una conversación**: cada una responde con su propia personalidad, voz y color; elige quién contesta (quien encaje, todas, por turnos o solo a quien menciones con @) y cuánto charlan entre ellas. La seguridad, los avisos de IA y el ajuste adulto más estricto valen para toda la sala. [Cómo funciona](docs/GROUP_CHATS.md) |
| **1.5** · Tráela desde otra app | Múdate desde **ChatGPT, Claude, Character.AI, SillyTavern, Replika, Nomi o Kindroid**. Lee la exportación en tu propio servidor, luego te enseña lo que ha aprendido (datos con tus propias palabras, vuestra historia juntos, su estilo) y solo guarda lo que tú apruebes. [Cómo exportar desde cada app](docs/IMPORT.md) |
| **1.4** · Más fluidez | Mira cómo cada archivo que escribe **crece en directo en el chat** mientras el modelo lo transmite (OpenAI, Anthropic, xAI, OpenRouter y planes de ChatGPT; Ollama lo envía de una vez); un retrato que habla con sincronización labial de nueve formas de boca; registros en texto plano o JSON |
| **1.3** · Comprobaciones más listas | Su comprobación de "¿de verdad hizo lo que dice?" ya funciona en los seis idiomas; un modelo local pequeño y opcional como juez sube lo que detecta del 38 % al **88 %** con un 95 % de precisión ([medido](docs/RESULTS.md)) |
| **1.2** · Todo en tu idioma | Toda la app, la guía de ayuda y los mensajes de su servidor en English, Español, Français, Deutsch, Português (Brasil) e Italiano |
| **1.1** · Instálala donde quieras | Configura un servidor nuevo en el navegador con un código corto; una imagen de Docker también para **ARM** (Raspberry Pi 4/5); Homebrew, Unraid, TrueNAS, Proxmox y Home Assistant (HACS) |

Todas las versiones: [CHANGELOG.md](CHANGELOG.md) · [versiones](https://github.com/farena-ai/sara/releases).

### Lo que viene

Todas las fases previstas ya están publicadas. Lo próximo: la app de iPhone (pendiente de la revisión de Apple), lo que queda en cada función y tus ideas en [Discussions](https://github.com/farena-ai/sara/discussions).

El plan completo: [docs/ROADMAP.md](docs/ROADMAP.md).

## Por qué Sara

- **Es agradable tenerla cerca.** Ponle el nombre que quieras, elige ella/él/elle, ajusta su
  personalidad con controles sencillos (o empieza con un personaje ya hecho) y ella la mantiene:
  estados de ánimo, su propio día, bromas recurrentes y recuerdos de lo que le contaste, que
  puedes ver, corregir y olvidar.
- **Útil para trabajo de verdad.** Archivos, terminal y git en un espacio de trabajo aislado,
  tareas en segundo plano, vistas previas en vivo que prueba en su propio navegador, un equipo de
  ayudantes para trabajos grandes y una comprobación de que lo que *dice* que hizo coincide con lo
  que realmente se ejecutó.
- **Tuya.** Un dueño por servidor; tus chats, recuerdos y claves se quedan allí. Usa cualquier
  modelo: local (Ollama, vLLM, llama.cpp), en la nube (OpenAI, Anthropic, xAI, OpenRouter) o las
  suscripciones que ya pagas (plan de ChatGPT, Claude Pro/Max, SuperGrok / X Premium+). Viene
  **sin credenciales de ningún tipo**.
- **Pequeña y legible.** TypeScript que Node ejecuta directamente: sin paso de compilación, cero
  dependencias en tiempo de ejecución, construida desde cero (no está basada en Hermes Agent ni en
  OpenClaw). Fácil de [ampliar](docs/EXTENDING.md).

## Recorrido por las funciones

### Compañera

<img src="docs/screenshots/companion.png" alt="Sara answering a tired user warmly and with humour before starting work" width="760">

Su propio carácter y estados de ánimo que cambian según cómo van las cosas, su propio día y sus
aficiones, memoria de lo que te importa y de las fechas que te importan (puedes ver, corregir u
olvidar cualquier cosa), un repaso semanal, mensajes por iniciativa propia si quieres (con horas
de silencio) y una línea de tiempo de vuestra historia juntos.
¿Vienes de otra app? Trae tus chats de ChatGPT, Claude, Character.AI, SillyTavern, Replika, Nomi o
Kindroid y aprueba antes lo que aprende de ellos ([docs/IMPORT.md](docs/IMPORT.md)).
O reúne a dos, tres o cuatro de tus compañeras en un chat de grupo ([docs/GROUP_CHATS.md](docs/GROUP_CHATS.md)).
¿Lo quieres todo en una sola máquina? Activa **Nada sale de este ordenador** ([docs/PRIVATE_LOCAL.md](docs/PRIVATE_LOCAL.md)).

### Compañera de programación

<img src="docs/screenshots/coding.png" alt="The tip calculator she built, open in the live preview pane next to the chat, while she writes its stylesheet: the file grows live in the chat" width="760">

Un espacio de trabajo por proyecto con archivos, terminal y git (commit y push con tu permiso);
cada archivo que escribe aparece en directo en el chat mientras el modelo lo transmite (con modelos
en la nube; Ollama lo envía entero);
compilaciones y pruebas largas en segundo plano, con un aviso al terminar; una vista previa en
vivo de la app que está creando, que prueba en un navegador real sin interfaz y de la que adjunta
capturas; un mapa del código para proyectos grandes; proyectos iniciales probados; un equipo de
ayudantes (planificar → crear → probar → revisar) que va de una incidencia de GitHub a una pull
request revisada; traspaso a Claude Code o Grok Build; herramientas MCP; deshacer cambios en
archivos; un medidor de tokens y costes con presupuestos;
y una comprobación, en los seis idiomas, de que lo que *dice* que hizo coincide con lo que realmente
se ejecutó (opcionalmente juzgada por un modelo local pequeño).

### Agenda y Hoy

<img src="docs/screenshots/planner.png" alt="Sara adding a reminder and two to-dos from one message" width="760">

Tareas, notas y recordatorios a partir de frases normales, entregados en el chat, en tu móvil y en
Telegram o Discord; un resumen por la mañana y una página Hoy.

### Biblioteca

<img src="docs/screenshots/library.png" alt="Sara answering from a handbook in her library" width="760">

Dale PDF (también escaneados), Word, Excel, PowerPoint, libros electrónicos, páginas web y notas.
Aprende lo importante, responde a partir de ellos y dice de qué documento (y página) sale la
respuesta.

### Voz

<img src="docs/screenshots/voice.png" alt="The voice settings page" width="760">

Llamadas en directo que puedes interrumpir (voz en tiempo real de Grok u OpenAI), notas de voz en
Telegram y Discord, lectura en voz alta, una voz que sigue su estado de ánimo y un retrato animado que habla, con sincronización labial de nueve formas de boca. Las voces funcionan en tu servidor Linux o vienen de tu suscripción. (Captura de un
servidor de pruebas con Windows, donde la voz local aún no está disponible).

### En todas partes

<img src="docs/screenshots/everywhere.png" alt="Sara on a phone-sized screen answering from her library" width="260">

App web e instalable (PWA), apps para Android y iPhone ([android/](android/README.md),
[ios/](ios/README.md)), apps de escritorio para Windows y macOS ([docs/desktop.md](docs/desktop.md)),
puentes con Telegram y Discord, `sara-chat` en cualquier terminal y un panel para VS Code
([docs/clients.md](docs/clients.md)), Gmail y Google Calendar con tu propia app de Google, Home
Assistant, conversaciones confidenciales que nunca se guardan y otras apps con su propia memoria y
personalidad: una API compatible con OpenAI (SillyTavern, Open WebUI, scripts), un servidor MCP
(Claude Code, Cursor, Claude Desktop; [listado en Glama](https://glama.ai/mcp/servers/farena-ai/sara)) y tarjetas de personaje para importar y exportar
([docs/OTHER_APPS.md](docs/OTHER_APPS.md)).

### Hazla tuya

<img src="docs/screenshots/make-it-yours.png" alt="Name and personality settings with the character gallery" width="760">

Cualquier nombre, pronombres, edad y aspecto (pintado por Grok Imagine, con expresiones y animación
a juego), un asistente guiado para "crear tu compañera", controles de personalidad, una galería de
personajes iniciales, archivos de personaje que puedes compartir, un modelo para cada tarea y
toda la app, la guía de ayuda y sus mensajes en seis idiomas. Cada ajuste tiene un **?**, hay visitas guiadas cortas y puedes preguntarle
directamente cómo funciona algo.

### Seguridad, siempre activa

<img src="docs/screenshots/safety.png" alt="An approval card: Sara asks before running a command" width="760">

Las acciones arriesgadas esperan tu permiso (en Windows, que no tiene aislamiento de comandos, lo
espera cada comando). La capa de seguridad funciona en el código alrededor de cada llamada al
modelo y **no se puede desactivar**: aviso de que es una IA al principio y de forma periódica, una
respuesta honesta siempre que se le pregunte en serio si es una IA, recursos de ayuda en crisis y
un bloqueo total del contenido sexual con menores
([docs/COMPLIANCE.md](docs/COMPLIANCE.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)). Copias
de seguridad diarias (y copias cifradas fuera del servidor), restauración y actualización con un
solo comando, y `sara doctor` la mantienen en forma.

## Cómo encaja todo

<img src="docs/architecture.svg" alt="Architecture: apps and bridges talk to one Sara server; each turn passes the always-on safety layer, gathers memory and library context, calls the chosen model provider and runs tools in a sandboxed workspace; data stays in one folder on your server" width="860">

Más en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Probada, con resultados publicados

Todo lo que sigue se ejecutó de verdad; los scripts están en el repositorio, así que puedes
repetirlos con tus propios modelos. Fechas, configuración y archivos de resultados:
**[docs/RESULTS.md](docs/RESULTS.md)**.

| Prueba | Modelo | Resultado | Fecha |
|---|---|---|---|
| [HumanEval](https://github.com/openai/human-eval), con su bucle de agente (164 problemas, pruebas ocultas) | qwen3.8 27B, local | **158/164** (pass@1 96,3 %) | 2026-10-27 |
| HumanEval, el mismo modelo sin herramientas (referencia) | qwen3.8 27B, local | **161/164** (pass@1 98,2 %) | 2026-10-27 |
| Tareas de repositorio: 14 correcciones, funciones y refactorizaciones originales en varios archivos (pruebas ocultas), con su bucle de agente | qwen3.8 27B, local | **11/14** (en ambas ejecuciones) | 2026-10-28 |
| Tareas de repositorio, el mismo modelo con todos los archivos en un solo mensaje y sin herramientas (referencia) | qwen3.8 27B, local | **12/14** (en ambas ejecuciones) | 2026-10-28 |
| Proyectos de tamaño real: 3 proyectos originales de 22 a 36 archivos (pruebas ocultas), con su bucle de agente | qwen3.8 27B, local | **2/3**, luego **3/3** | 2026-10-28 |
| Proyectos de tamaño real, el mismo modelo con todos los archivos en un solo mensaje y sin herramientas (referencia) | qwen3.8 27B, local | **3/3** (en ambas ejecuciones) | 2026-10-28 |
| Comprobación de lo que dice haber hecho, en 6 idiomas (240 respuestas reservadas): solo patrones → con un juez local | qwen3.5 9B, local, como juez | detecta **38 % → 88 %**, precisión 92 % → 95 % | 2026-10-28 |
| Memoria entre sesiones (recordar, no inventar, olvidar) | qwen3.8 27B, local | **11/12** comprobaciones | 2026-10-27 |
| Biblioteca: responde a partir de documentos y dice de dónde | qwen3.8 27B, local | **8/8** en ambas ejecuciones | 2026-10-27 |
| Mapa del código: preguntas sobre su propio código | qwen3.8 27B, local | **8/8** | 2026-10-27 |

La lectura honesta: su bucle de agente todavía no suma puntos en ninguna de las dos pruebas de
programación. El modelo solo ya resuelve casi todos los problemas cortos de HumanEval, y las 14
tareas de repositorio son lo bastante pequeñas (de 5 a 7 archivos) como para pegarlas enteras en un
mensaje (igual que los tres proyectos de tamaño real, de menos de 1100 líneas); los fallos de ambos modos fueron reglas escritas solo en un README o SPEC que ninguna
prueba comprobaba. Lo que aporta hoy es la forma de trabajar (ejecuta las pruebas, pide permiso
antes de pasos arriesgados, muestra lo que se ejecutó), no una puntuación más alta en estos
conjuntos. Detalles, resultados por tarea y cómo repetirlo: [docs/RESULTS.md](docs/RESULTS.md).

Además, `npm run check`: una comprobación de tipos y 849 pruebas automáticas con un modelo falso
programado (sin red, sin GPU): 841 pasan en Windows y las otras 8 son pruebas del aislamiento solo
para Linux, que se ejecutan en un servidor Linux.

## Cómo se compara Sara

Una comparación general con los tipos de alternativas habituales (cada producto es distinto):

| | Sara | Apps de compañía con IA alojadas | CLIs y agentes de programación | Interfaces de chat autoalojadas |
|---|:-:|:-:|:-:|:-:|
| Funciona en tu propio ordenador o servidor | ✅ | ❌ | ✅ | ✅ |
| Usa cualquier modelo, también locales | ✅ | ❌ normalmente el suyo | depende | ✅ |
| Personalidad y memoria duraderas que puedes ver y editar | ✅ | ✅ | ❌ | depende |
| Escribe, ejecuta y prueba código, pide permiso antes de pasos arriesgados | ✅ | ❌ | ✅ | depende (complementos) |
| Agenda, recordatorios, documentos, llamadas de voz | ✅ | algunas | ❌ | algunas |
| Apps móviles, Telegram y Discord | ✅ | apps móviles | ❌ | depende |
| Trae tus chats de otras apps de compañía, revisados antes de guardarlos | ✅ | ❌ normalmente | ❌ | depende |
| Toda la app en seis idiomas | ✅ | depende | depende | depende |
| Capa de seguridad que ningún ajuste puede desactivar | ✅ | sus propias normas | n/a | normalmente no |
| Precio | gratis (MIT); pagas tus modelos | suscripción | depende | normalmente gratis |

## Instalación

**Servidor Linux** (Debian/Ubuntu, Fedora/RHEL/Alma/Rocky, Arch, openSUSE), un solo comando que
hace unas pocas preguntas sencillas (pulsa Intro para aceptar la sugerencia):

```sh
curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/deploy/get-sara.sh | sudo bash
# it ends with the address to open and your one-time owner token
sudo sara status
```

**Docker:**

```sh
git clone https://github.com/farena-ai/sara && cd sara
sudo docker compose up -d                       # or: sudo docker compose --profile ollama up -d  (with a local Ollama)
sudo docker compose logs sara | grep -A1 'owner token'   # o: abre su página e introduce el código de configuración de este registro
```

**Tiendas de apps y NAS:** la imagen `ghcr.io/farena-ai/sara` (amd64 y ARM),
`brew install --cask farena-ai/tap/sara`, TrueNAS, Proxmox y HACS (como repositorio personalizado)
funcionan ya; Unraid está aprobado, y winget, CasaOS/ZimaOS, Umbrel y la lista de la tienda de HACS
esperan revisión
([cuál es cuál](docs/INSTALL.md#other-ways-to-install)). Un servidor nuevo se configura en el
navegador con un código corto de su registro (en Umbrel, con un clic).

**Windows y macOS:** descarga `Sara-Setup-<version>.exe` o `Sara-<version>.dmg` de la
[página de versiones](https://github.com/farena-ai/sara/releases/latest). La primera pregunta:
ejecutar Sara en este ordenador (su servidor y la app de escritorio juntos) o conectarte a una
Sara que está en otro sitio (solo la app).

**Desde el código fuente** (cualquier ordenador con Node 24 o superior):

```sh
git clone https://github.com/farena-ai/sara && cd sara
npm ci
npm start                                       # http://127.0.0.1:7860; the token is in the output
```

Entra con el token (o el código de configuración) y una
guía de configuración te pregunta tu nombre, te ayuda a dar forma a tu compañera y conecta un
modelo. Cómo llegar a ella desde el móvil (Tailscale, tu propia dirección web con HTTPS o tu red
de casa), actualizaciones, copias de seguridad y solución de problemas:
**[docs/INSTALL.md](docs/INSTALL.md)**.

## El día a día

```sh
sudo sara status       # is she running, last backup
sudo sara update       # backs up, updates, restarts
sudo sara backup       # back up now
sudo sara restore FILE # restore a backup
sudo sara access       # how you reach her (change: tailscale, local, domain, lan)
```

## Documentación

| | |
|---|---|
| [Instalación](docs/INSTALL.md) | Linux, Docker, Windows, macOS, HTTPS, actualizaciones, solución de problemas |
| [¿Qué ordenador necesito?](docs/REQUIREMENTS.md) · [Elegir un modelo](docs/CHOOSING_A_MODEL.md) · [Lo que cuesta](docs/COSTS.md) | Antes de empezar: hardware, modelos con tamaños de GPU, costes de uso |
| [Tu móvil](docs/PHONE.md) · [Mudarse a otro ordenador](docs/MOVING.md) | Configurar el móvil de principio a fin; copia, instalación y restauración |
| [Lista de seguridad](docs/SECURITY_CHECKLIST.md) · [Qué sale de tu servidor](docs/PRIVACY.md) | Cinco minutos después de instalar; cada conexión saliente y cómo desactivarla |
| [Preguntas frecuentes y glosario](docs/FAQ.md) | Preguntas habituales y qué significan las palabras |
| [Apps y clientes](docs/clients.md) · [Apps de escritorio](docs/desktop.md) · [Home Assistant](docs/HOME_ASSISTANT.md) | Terminal, VS Code, Windows y macOS; Sara en Home Assistant y Home Assistant en Sara |
| [Otras apps](docs/OTHER_APPS.md) | API compatible con OpenAI (SillyTavern, Open WebUI, scripts), MCP (Claude Code, Cursor, Claude Desktop), tarjetas de personaje |
| [Varias Saras en una app](docs/SERVERS.md) · [Modo local privado](docs/PRIVATE_LOCAL.md) · [Modo hogar](docs/HOUSEHOLD.md) | Cambiar de servidor; tenerlo todo en un ordenador; compartir un servidor con las personas con las que vives |
| [Chats en grupo](docs/GROUP_CHATS.md) · [Videollamadas](docs/VIDEO_CALLS.md) · [Nuestros momentos](docs/MOMENTS.md) · [Documentos grandes](docs/LIBRARY.md) | Varias compañeras en un chat; llamadas con su retrato en movimiento; el álbum compartido; libros de 1.000 páginas en su biblioteca |
| [Asistentes de voz](docs/VOICE_ASSISTANTS.md) · [Alexa](docs/ALEXA.md) · [Servidores por SSH](docs/SSH.md) · [Paquetes](docs/PACKAGING.md) | Alexa, asistente de Android, Google Home, Siri; trabajar en tus otros servidores; Homebrew, winget, Unraid y los demás |
| [Ampliar Sara](docs/EXTENDING.md) | Añadir herramientas, puentes, personajes, servidores MCP, idiomas, proyectos iniciales |
| [Arquitectura](docs/ARCHITECTURE.md) | Cómo encajan las piezas, módulo a módulo |
| [Resultados](docs/RESULTS.md) | Pruebas y evaluaciones, y cómo repetirlas |
| [Traducir](docs/TRANSLATING.md) | La app en tu idioma |
| [Cumplimiento](docs/COMPLIANCE.md) · [Modelo de amenazas](docs/THREAT_MODEL.md) · [Avisos](docs/DISCLOSURES.md) | Seguridad, protección y lo que hay que saber primero |
| [Hoja de ruta](docs/ROADMAP.md) · [Registro de cambios](CHANGELOG.md) · [Versiones](https://github.com/farena-ai/sara/releases) | Hacia dónde va y qué ha cambiado |

Todo esto también se convierte en un pequeño sitio web con búsqueda y modo oscuro:
`node scripts/build-docs.ts` lo escribe en `outputs/site/` (abre `index.html`; está listo para
GitHub Pages).

## Contribuir

Las contribuciones son bienvenidas. Empieza por [CONTRIBUTING.md](CONTRIBUTING.md) y las
[incidencias para empezar](docs/GOOD_FIRST_ISSUES.md); sigue el
[código de conducta](CODE_OF_CONDUCT.md) e informa de los problemas de seguridad en privado, como
se explica en [SECURITY.md](SECURITY.md).

```sh
npm ci
npm run dev        # http://127.0.0.1:7860, restarts on save
npm run check      # typecheck + all tests
```

## Licencia

MIT, consulta [LICENSE](LICENSE). Créditos de las piezas que Sara descarga o usa:
[docs/CREDITS.md](docs/CREDITS.md).
