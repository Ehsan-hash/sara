<p align="center"><a href="README.md">English</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <b>Deutsch</b> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.it.md">Italiano</a></p>

# Sara

**Eine selbst gehostete KI-Begleiterin mit der Persönlichkeit, die du wählst, und zugleich eine
echte Programmierpartnerin.** Sie unterhält sich, erinnert sich, plant, liest deine Dokumente und
baut und testet Software in einer abgeschotteten Umgebung, auf deinem eigenen Server, mit den
Modellen deiner Wahl.

> Dies ist eine Übersetzung der [englischen README](README.md). Die Links führen zur Dokumentation,
> die auf Englisch ist.

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-339933" alt="Node 24 or newer">
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen" alt="Zero runtime dependencies">
  <img src="https://img.shields.io/badge/tests-486%20passing-brightgreen" alt="486 tests passing">
  <a href="docs/RESULTS.md"><img src="https://img.shields.io/badge/HumanEval%20pass%401-96.3%25-informational" alt="HumanEval pass@1 96.3%"></a>
</p>

<p align="center">
  <img src="docs/screenshots/demo.png" alt="Animated demo: Sara cheers the user up, builds a tip calculator, asks before starting a server, opens a live preview, tests it in her own browser and shows the screenshot she took" width="860">
  <br>
  <sub>Eine echte, ungeschnittene Sitzung mit einem lokalen Modell (qwen3.8 27B auf Ollama, eine RTX 5090) auf einem Wegwerf-Testserver: Sie plaudert mit ihrer Persönlichkeit, schreibt die App, fragt, bevor sie einen Server startet, öffnet die Vorschau und testet sie in ihrem eigenen Browser. Das letzte Bild zeigt die App mit eingetippten Zahlen.</sub>
</p>

> **Status:** 1.0. MIT-Lizenz. Die [Android-App](https://play.google.com/store/apps/details?id=com.backstagecoding.sara) ist bei Google Play; die iPhone-App und
> die Version für den Mac App Store folgen, sobald Apple sie freigibt. Lies
> [docs/DISCLOSURES.md](docs/DISCLOSURES.md), bevor du Sara nutzt oder weitergibst.

## Warum Sara

- **Angenehme Gesellschaft.** Gib ihr einen beliebigen Namen, wähle sie/er/they, stell ihre
  Persönlichkeit mit einfachen Reglern ein (oder fang mit einer fertigen Figur an), und sie bleibt
  dabei: Stimmungen, ihr eigener Tag, Running Gags und Erinnerungen an das, was du ihr erzählt
  hast, die du ansehen, korrigieren und löschen kannst.
- **Nützlich für echte Arbeit.** Dateien, Shell und Git in einem abgeschotteten Arbeitsbereich,
  Hintergrundjobs, Live-Vorschauen, die sie in ihrem eigenen Browser testet, ein Team von Helfern
  für größere Aufgaben und eine Prüfung, ob das, was sie zu tun *behauptet*, auch wirklich
  gelaufen ist.
- **Deine.** Ein Besitzer pro Server; deine Chats, Erinnerungen und Schlüssel bleiben dort. Nutze
  jedes Modell: lokal (Ollama, vLLM, llama.cpp), in der Cloud (OpenAI, Anthropic, xAI, OpenRouter)
  oder die Abos, die du schon bezahlst (ChatGPT-Abo, Claude Pro/Max, SuperGrok / X Premium+).
  Kommt **ganz ohne Zugangsdaten**.
- **Klein und lesbar.** TypeScript, das Node direkt ausführt: kein Build-Schritt, null
  Laufzeitabhängigkeiten, von Grund auf neu gebaut (nicht auf Hermes Agent oder OpenClaw
  aufgebaut). Leicht zu [erweitern](docs/EXTENDING.md).

## Die Funktionen im Überblick

### Begleiterin

<img src="docs/screenshots/companion.png" alt="Sara answering a tired user warmly and with humour before starting work" width="760">

Ein eigener Charakter und Stimmungen, die sich danach richten, wie es läuft, ein eigener Tag und
Hobbys, Erinnerungen an das, was dir wichtig ist, und an deine wichtigen Daten (alles einsehbar,
korrigierbar und löschbar), ein Wochenrückblick, auf Wunsch Nachrichten von ihr aus (mit
Ruhezeiten) und eine Zeitleiste eurer gemeinsamen Geschichte.

### Programmierpartnerin

<img src="docs/screenshots/coding.png" alt="The tip calculator she built, open in the live preview pane next to the chat" width="760">

Ein Arbeitsbereich pro Projekt mit Dateien, Shell und Git (Commit und Push mit deinem OK); lange
Builds und Tests im Hintergrund mit einer Nachricht, wenn sie fertig sind; eine Live-Vorschau der
App, die sie gerade baut, die sie in einem echten Headless-Browser testet und von der sie
Screenshots anhängt; eine Code-Karte für große Codebasen; getestete Startprojekte; ein Team von
Helfern (planen → bauen → testen → prüfen) vom GitHub-Issue bis zum geprüften Pull-Request;
Übergabe an Claude Code oder Grok Build; MCP-Werkzeuge; Rückgängig für Dateiänderungen; ein
Token- und Kostenzähler mit Budgets.

### Planer und Heute

<img src="docs/screenshots/planner.png" alt="Sara adding a reminder and two to-dos from one message" width="760">

Aufgaben, Notizen und Erinnerungen aus ganz normalen Sätzen, zugestellt im Chat, auf dem Handy und
über Telegram oder Discord; ein Morgen-Briefing und eine Heute-Seite.

### Bibliothek

<img src="docs/screenshots/library.png" alt="Sara answering from a handbook in her library" width="760">

Gib ihr PDFs (auch Scans), Word, Excel, PowerPoint, E-Books, Webseiten und Notizen. Sie merkt sich
das Wichtigste, antwortet daraus und sagt, aus welchem Dokument (und von welcher Seite) es stammt.

### Stimme

<img src="docs/screenshots/voice.png" alt="The voice settings page" width="760">

Live-Anrufe, bei denen du sie unterbrechen kannst (Echtzeit-Stimme von Grok oder OpenAI),
Sprachnachrichten über Telegram und Discord, Vorlesen, eine Stimme, die ihrer Stimmung folgt, und
ein animiertes Porträt, das spricht. Die Stimmen laufen auf deinem Linux-Server oder kommen aus
deinem Abo. (Screenshot von einem Windows-Testserver, auf dem lokale Stimmen noch nicht verfügbar
sind.)

### Überall

<img src="docs/screenshots/everywhere.png" alt="Sara on a phone-sized screen answering from her library" width="260">

Web-App und installierbare PWA, Apps für Android und iPhone ([android/](android/README.md),
[ios/](ios/README.md)), Desktop-Apps für Windows und macOS ([docs/desktop.md](docs/desktop.md)),
Brücken zu Telegram und Discord, `sara-chat` in jedem Terminal und ein VS-Code-Panel
([docs/clients.md](docs/clients.md)), Gmail und Google Kalender über deine eigene Google-App, Home
Assistant, vertrauliche Unterhaltungen, die nie gespeichert werden, und andere Apps mit ihrem
eigenen Gedächtnis und ihrer Persönlichkeit: eine OpenAI-kompatible API (SillyTavern, Open WebUI,
Skripte), ein MCP-Server (Claude Code, Cursor, Claude Desktop) und Charakterkarten zum Importieren
und Exportieren ([docs/OTHER_APPS.md](docs/OTHER_APPS.md)).

### Mach sie zu deiner

<img src="docs/screenshots/make-it-yours.png" alt="Name and personality settings with the character gallery" width="760">

Beliebiger Name, Pronomen, Alter und Aussehen (gemalt von Grok Imagine, mit passenden
Gesichtsausdrücken und Animation), ein geführter Assistent „Erstelle deine Begleiterin",
Persönlichkeitsregler, eine Galerie mit Startfiguren, teilbare Charakterdateien, ein Modell für
jede Aufgabe und die App in sechs Sprachen. Jede Einstellung hat ein **?**, es gibt kurze
geführte Touren, und du kannst sie einfach fragen, wie etwas funktioniert.

### Sicherheit, immer an

<img src="docs/screenshots/safety.png" alt="An approval card: Sara asks before running a command" width="760">

Riskante Aktionen warten auf dein OK (unter Windows, wo es keine Befehls-Sandbox gibt, gilt das für
jeden Befehl). Die Sicherheitsschicht läuft im Code um jeden Modellaufruf herum und **lässt sich
nicht abschalten**: ein KI-Hinweis zu Beginn und danach regelmäßig, eine ehrliche Antwort, wann
immer sie ernsthaft gefragt wird, ob sie eine KI ist, Hilfsangebote in Krisen und eine harte Sperre
für sexuelle Inhalte mit Minderjährigen ([docs/COMPLIANCE.md](docs/COMPLIANCE.md),
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)). Tägliche Backups (plus verschlüsselte Kopien
außerhalb des Servers), Wiederherstellen und Aktualisieren mit einem Befehl und `sara doctor`
halten sie gesund.

## Wie alles zusammenpasst

<img src="docs/architecture.svg" alt="Architecture: apps and bridges talk to one Sara server; each turn passes the always-on safety layer, gathers memory and library context, calls the chosen model provider and runs tools in a sandboxed workspace; data stays in one folder on your server" width="860">

Mehr dazu in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getestet, mit veröffentlichten Ergebnissen

Alles hier wurde wirklich ausgeführt; die Skripte liegen im Repository, du kannst sie also mit
deinen eigenen Modellen wiederholen. Daten, Aufbau und Ergebnisdateien:
**[docs/RESULTS.md](docs/RESULTS.md)**.

| Test | Modell | Ergebnis | Datum |
|---|---|---|---|
| [HumanEval](https://github.com/openai/human-eval), über ihre Agenten-Schleife (164 Aufgaben, versteckte Tests) | qwen3.8 27B, lokal | **158/164** (pass@1 96,3 %) | 2026-10-27 |
| HumanEval, dasselbe Modell ohne Werkzeuge (Vergleichswert) | qwen3.8 27B, lokal | **161/164** (pass@1 98,2 %) | 2026-10-27 |
| Repository-Aufgaben: 14 eigene Fehlerbehebungen, Funktionen und Refactorings über mehrere Dateien (versteckte Tests), über ihre Agenten-Schleife | qwen3.8 27B, lokal | **11/14** (in beiden Läufen) | 2026-10-28 |
| Repository-Aufgaben, dasselbe Modell mit allen Dateien in einer Nachricht und ohne Werkzeuge (Vergleichswert) | qwen3.8 27B, lokal | **12/14** (in beiden Läufen) | 2026-10-28 |
| Gedächtnis über Sitzungen hinweg (erinnern, nichts erfinden, vergessen) | qwen3.8 27B, lokal | **11/12** Prüfungen | 2026-10-27 |
| Bibliothek: antwortet aus Dokumenten und nennt die Quelle | qwen3.8 27B, lokal | **8/8** in beiden Läufen | 2026-10-27 |
| Code-Karte: Fragen zu ihrem eigenen Code | qwen3.8 27B, lokal | **8/8** | 2026-10-27 |

Ehrlich gelesen: Ihre Agenten-Schleife bringt bei beiden Programmier-Tests noch keine Punkte.
Das Modell allein löst die kurzen HumanEval-Aufgaben schon fast alle, und die 14 Repository-Aufgaben
sind klein genug (5 bis 7 Dateien), um sie komplett in eine Nachricht zu kopieren; die Fehler in
beiden Modi waren Regeln, die nur in einer README oder SPEC standen und von keinem Test geprüft
wurden. Was sie heute beiträgt, ist die Arbeitsweise (sie lässt die Tests laufen, fragt vor
riskanten Schritten, zeigt, was gelaufen ist), nicht ein höheres Ergebnis bei diesen Sätzen.
Details, Ergebnisse pro Aufgabe und wie man es wiederholt: [docs/RESULTS.md](docs/RESULTS.md).

Dazu `npm run check`: eine Typprüfung und 493 automatische Tests mit einem geskripteten
Schein-Modell (ohne Netz, ohne GPU): 486 laufen unter Windows durch, die anderen 7 sind
Linux-spezifische Sandbox-Tests, die auf einem Linux-Server laufen.

## Sara im Vergleich

Ein allgemeiner Vergleich mit den üblichen Arten von Alternativen (einzelne Produkte unterscheiden
sich):

| | Sara | Gehostete KI-Begleiter-Apps | Coding-CLIs und -Agenten | Selbst gehostete Chat-Oberflächen |
|---|:-:|:-:|:-:|:-:|
| Läuft auf deinem eigenen Computer oder Server | ✅ | ❌ | ✅ | ✅ |
| Jedes Modell, auch lokale | ✅ | ❌ meist das eigene | unterschiedlich | ✅ |
| Dauerhafte Persönlichkeit und Gedächtnis, einsehbar und änderbar | ✅ | ✅ | ❌ | unterschiedlich |
| Schreibt, startet und testet Code, fragt vor riskanten Schritten | ✅ | ❌ | ✅ | unterschiedlich (Plug-ins) |
| Planer, Erinnerungen, Dokumente, Sprachanrufe | ✅ | teilweise | ❌ | teilweise |
| Handy-Apps, Telegram und Discord | ✅ | Handy-Apps | ❌ | unterschiedlich |
| Sicherheitsschicht, die keine Einstellung abschalten kann | ✅ | eigene Richtlinien | n/a | meist nicht |
| Preis | kostenlos (MIT); du zahlst deine Modelle | Abo | unterschiedlich | meist kostenlos |

## Installation

**Linux-Server** (Debian/Ubuntu, Fedora/RHEL/Alma/Rocky, Arch, openSUSE), ein Befehl, der ein paar
einfache Fragen stellt (Enter übernimmt den Vorschlag):

```sh
curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/deploy/get-sara.sh | sudo bash
# it ends with the address to open and your one-time owner token
sudo sara status
```

**Docker:**

```sh
git clone https://github.com/farena-ai/sara && cd sara
sudo docker compose up -d                       # or: sudo docker compose --profile ollama up -d  (with a local Ollama)
sudo docker compose logs sara | grep -A1 'owner token'   # oder: ihre Seite öffnen und den Einrichtungscode aus diesem Log eingeben
```

**App-Stores und NAS:** das Image `ghcr.io/farena-ai/sara` (auch für ARM), Homebrew, TrueNAS,
Proxmox und HACS (als benutzerdefiniertes Repository) funktionieren jetzt; winget, CasaOS/ZimaOS,
Umbrel und Unraid warten auf die Prüfung ([Übersicht](docs/INSTALL.md#other-ways-to-install)). Ein neuer Server wird im Browser
mit einem kurzen Code aus ihrem Log eingerichtet (bei Umbrel mit einem Klick).

**Windows und macOS:** Lade `Sara-Setup-<version>.exe` oder `Sara-<version>.dmg` von der
[Release-Seite](https://github.com/farena-ai/sara/releases/latest) herunter. Die erste Frage: Sara
auf diesem Computer laufen lassen (ihr Server und die Desktop-App zusammen) oder mit einer Sara
woanders verbinden (nur die App).

**Aus dem Quellcode** (jeder Computer mit Node 24 oder neuer):

```sh
git clone https://github.com/farena-ai/sara && cd sara
npm ci
npm start                                       # http://127.0.0.1:7860; the token is in the output
```

Melde dich mit dem Token (oder dem Einrichtungscode) an; ein Einrichtungsassistent fragt nach deinem Namen, hilft dir, deine Begleiterin zu
gestalten, und verbindet ein Modell. Zugriff vom Handy (Tailscale, deine eigene Webadresse mit
HTTPS oder dein Heimnetz), Updates, Backups und Fehlerbehebung:
**[docs/INSTALL.md](docs/INSTALL.md)**.

## Im Alltag

```sh
sudo sara status       # is she running, last backup
sudo sara update       # backs up, updates, restarts
sudo sara backup       # back up now
sudo sara restore FILE # restore a backup
sudo sara access       # how you reach her (change: tailscale, local, domain, lan)
```

## Dokumentation

| | |
|---|---|
| [Installation](docs/INSTALL.md) | Linux, Docker, Windows, macOS, HTTPS, Updates, Fehlerbehebung |
| [Welchen Computer brauche ich?](docs/REQUIREMENTS.md) · [Ein Modell wählen](docs/CHOOSING_A_MODEL.md) · [Was es kostet](docs/COSTS.md) | Vor dem Start: Hardware, Modelle mit GPU-Größen, laufende Kosten |
| [Dein Handy](docs/PHONE.md) · [Umzug auf einen neuen Computer](docs/MOVING.md) | Handy-Einrichtung von Anfang bis Ende; Backup, Installation, Wiederherstellung |
| [Sicherheits-Checkliste](docs/SECURITY_CHECKLIST.md) · [Was deinen Server verlässt](docs/PRIVACY.md) | Fünf Minuten nach der Installation; jede ausgehende Verbindung und wie man sie abschaltet |
| [FAQ und Glossar](docs/FAQ.md) | Häufige Fragen und was die Begriffe bedeuten |
| [Apps und Clients](docs/clients.md) · [Desktop-Apps](docs/desktop.md) · [Home Assistant](docs/HOME_ASSISTANT.md) | Terminal, VS Code, Windows und macOS; Sara in Home Assistant und Home Assistant in Sara |
| [Andere Apps](docs/OTHER_APPS.md) | OpenAI-kompatible API (SillyTavern, Open WebUI, Skripte), MCP (Claude Code, Cursor, Claude Desktop), Charakterkarten |
| [Sara erweitern](docs/EXTENDING.md) | Werkzeuge, Brücken, Figuren, MCP-Server, Sprachen, Startprojekte hinzufügen |
| [Architektur](docs/ARCHITECTURE.md) | Wie die Teile zusammenpassen, Modul für Modul |
| [Ergebnisse](docs/RESULTS.md) | Benchmarks und Auswertungen, und wie man sie wiederholt |
| [Übersetzen](docs/TRANSLATING.md) | Die App in deiner Sprache |
| [Compliance](docs/COMPLIANCE.md) · [Bedrohungsmodell](docs/THREAT_MODEL.md) · [Hinweise](docs/DISCLOSURES.md) | Schutz, Sicherheit, was man zuerst wissen sollte |
| [Roadmap](docs/ROADMAP.md) · [Änderungsprotokoll](CHANGELOG.md) · [Versionshinweise 1.0 (Entwurf)](docs/RELEASE_NOTES_1.0_DRAFT.md) | Wohin es geht, was sich geändert hat |

All das lässt sich auch zu einer kleinen durchsuchbaren Website mit Dunkelmodus bauen:
`node scripts/build-docs.ts` schreibt sie nach `outputs/site/` (öffne `index.html`; sie ist bereit
für GitHub Pages).

## Mitmachen

Beiträge sind willkommen. Fang mit [CONTRIBUTING.md](CONTRIBUTING.md) und den
[Einsteiger-Aufgaben](docs/GOOD_FIRST_ISSUES.md) an; halte dich bitte an den
[Verhaltenskodex](CODE_OF_CONDUCT.md) und melde Sicherheitsprobleme vertraulich, wie in
[SECURITY.md](SECURITY.md) beschrieben.

```sh
npm ci
npm run dev        # http://127.0.0.1:7860, restarts on save
npm run check      # typecheck + all tests
```

## Lizenz

MIT, siehe [LICENSE](LICENSE). Danksagungen für die Teile, die Sara herunterlädt oder aufruft:
[docs/CREDITS.md](docs/CREDITS.md).
