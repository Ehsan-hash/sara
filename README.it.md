<p align="center"><a href="README.md">English</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <b>Italiano</b></p>

# Sara

**Una compagna IA self-hosted, con la personalità che scegli tu, che è anche una vera compagna di
programmazione.** Chiacchiera, ricorda, organizza, legge i tuoi documenti e crea e collauda
software in un ambiente isolato, sul tuo server, con i modelli che scegli tu.

> Questa è una traduzione del [README in inglese](README.md). I link portano alla documentazione,
> che è in inglese.

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-339933" alt="Node 24 or newer">
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen" alt="Zero runtime dependencies">
  <img src="https://img.shields.io/badge/tests-858%20passing-brightgreen" alt="858 tests passing">
  <a href="docs/RESULTS.md"><img src="https://img.shields.io/badge/HumanEval%20pass%401-96.3%25-informational" alt="HumanEval pass@1 96.3%"></a>
  <a href="https://github.com/farena-ai/sara/releases/latest"><img src="https://img.shields.io/github/v/release/farena-ai/sara?label=release" alt="Latest release"></a>
  <a href="https://github.com/farena-ai/sara/pkgs/container/sara"><img src="https://img.shields.io/badge/docker-amd64%20%7C%20arm64-2496ED" alt="Docker image for amd64 and arm64"></a>
  <img src="https://img.shields.io/badge/languages-6-8A2BE2" alt="Six languages">
  <a href="https://glama.ai/mcp/servers/farena-ai/sara"><img src="https://glama.ai/mcp/servers/farena-ai/sara/badges/score.svg" alt="Sara MCP server on Glama"></a>
</p>

<p align="center">
  <img src="docs/screenshots/demo.png" alt="Animated demo: Sara cheers the user up, builds a tip calculator, asks before starting a server, opens a live preview, tests it in her own browser and shows the screenshot she took" width="860">
  <br>
  <sub>Una sessione reale e non montata con un modello locale (qwen3.8 27B su Ollama, una RTX 5090) su un server di prova usa e getta: chiacchiera con la sua personalità, scrive l'app, chiede prima di avviare un server, apre l'anteprima e la prova nel suo browser. L'ultimo fotogramma è l'app con dei numeri già inseriti.</sub>
</p>

> **Stato:** 2.5, licenza MIT, con sedici versioni ricche di novità dalla 1.0 (tutte qui sotto).
> L'[app Android](https://play.google.com/store/apps/details?id=com.backstagecoding.sara) è su Google Play;
> l'app per iPhone e la versione del Mac App Store arriveranno appena Apple le approverà. Leggi
> [docs/DISCLOSURES.md](docs/DISCLOSURES.md) prima di usare o condividere Sara.

## Novità

| Versione | Cosa ottieni |
|---|---|
| **2.5** · Il nuovo aspetto, parte 1 | **Scuro come predefinito e il suo lavoro sullo schermo:** una riga sotto ogni risposta mostra cosa ha fatto, i risultati arrivano come schede (meteo, cose da fare, file modificati, test, ricerche), una chat più leggera su telefono e computer, e le app per Windows e Mac disegnano la pagina fin nella barra del titolo. [Il piano](docs/design/NEW_LOOK.md) |
| **2.4** · Tutto in ordine | **Tutto più facile da trovare:** una barra laterale corta con un menu *Altro* da cui fissare i posti, Impostazioni con veri titoli che si chiudono, strumenti e autorizzazioni spiegati in parole semplici, foto che puoi eliminare dall'album dei ricordi, schermate e menu più ordinati in ogni app e salvataggi più sicuri dietro le quinte. [Cosa è cambiato](CHANGELOG.md) |
| **2.3** · Documenti grandi | **Libri e manuali da 500 a 1.000 pagine** (PDF fino a 1 GB) nella sua biblioteca: caricamenti che riprendono, ogni pagina scansionata letta, indice e riassunti per capitolo, e risposte che citano la pagina («p. 412») con un link diretto. 30 domande su 30 corrette su un libro di prova di 1.000 pagine. [Come funziona](docs/LIBRARY.md) |
| **2.2** · Gli altri tuoi server via SSH | **Può lavorare sulle tue altre macchine**, con password o chiave. Dopo un accesso con password **crea la sua chiave, ti dice dove si trova e dimentica la password** (la conserva solo se insisti, dopo un avviso). Le chiavi host vengono verificate, ogni comando segue le sue regole di approvazione e puoi revocare la sua chiave in qualsiasi momento. [Come funziona](docs/SSH.md) |
| **2.1** · La sua voce in casa | **«Alexa, apri sara companion»**: parlale su qualsiasi Echo con la tua skill gratuita (verificata come richiede Amazon). Rendila il tuo **assistente Android** (pressione lunga su Home), ascoltala sugli altoparlanti **Google Home / Nest** tramite Home Assistant e lascia che **ti saluti quando torni a casa**. Siri su iPhone arriva con il prossimo aggiornamento dell'app. [Come funziona](docs/VOICE_ASSISTANTS.md) |
| **2.0** · Modalità famiglia | **Condividi il tuo server Sara con le persone con cui vivi.** Invita un adulto con un link monouso: avrà le sue compagne, chat, memoria, biblioteca e app in uno spazio tutto suo. Tu resti l'amministratore: scegli quali modelli usa, imposti limiti giornalieri e vedi uso e costi, mai cosa scrive. [Come funziona](docs/HOUSEHOLD.md) |
| **1.10** · I nostri momenti | **Un album fotografico condiviso** con le tue foto e quelle che manda lei, ognuna con una didascalia che scrive con la sua voce a partire da ciò di cui parlavate. Album che si riempiono da soli (Noi, Luoghi, I suoi look), «In questo giorno», e a volte ne tira fuori uno: *ti ricordi?* Le chat private restano fuori a meno che tu non le aggiunga. [Come funziona](docs/MOMENTS.md) |
| **1.9** · Videochiamate | **Guardala mentre parlate:** una videochiamata mostra il suo ritratto animato a tutto schermo, con il labiale a tempo con la sua voce e il viso che segue il suo umore, con il suo outfit e luogo attuali. Accendi la fotocamera se vuoi: lei guarda ogni pochi secondi (o quando premi *Guarda qui*); non viene registrato nulla. [Come funziona](docs/VIDEO_CALLS.md) |
| **1.8** · Più server in un'unica app | Tieni **tutte le tue Sara in un'unica app** (casa e lavoro, o più d'una su un server) e passa dall'una all'altra da un menu senza uscire: app per Windows e Mac, Android e iPhone, VS Code, `sara-chat` e il ponte MCP. Ognuna mantiene il proprio accesso; file, microfono e fotocamera vanno solo a quella in uso. [Come funziona](docs/SERVERS.md) |
| **1.7** · Modalità locale privata | Un interruttore, **Niente lascia questo computer**, applicato nel codice in un unico punto: è raggiungibile solo questo computer, i modelli cloud e gli strumenti online vanno in pausa, e le sue chat, la sua memoria e la sua biblioteca continuano a funzionare. Le app per Windows e Mac trovano Ollama (o ti aiutano a installarlo), suggeriscono un modello adatto alla tua scheda grafica e lo scaricano con una barra di avanzamento. [Cosa garantisce](docs/PRIVATE_LOCAL.md) |
| **1.6** · Chat di gruppo | Riunisci **da due a quattro delle tue compagne in una conversazione**: ognuna risponde con la sua personalità, voce e colore; scegli chi risponde (chi è più adatta, tutte, a turno o solo chi menzioni con @) e quanto chiacchierano tra loro. Sicurezza, avvisi di IA e l'impostazione per adulti più rigida valgono per tutta la stanza. [Come funziona](docs/GROUP_CHATS.md) |
| **1.5** · Portala da un'altra app | Trasferisciti da **ChatGPT, Claude, Character.AI, SillyTavern, Replika, Nomi o Kindroid**. Legge l'esportazione sul tuo server, poi ti mostra cosa ha imparato (fatti con parole tue, la vostra storia insieme, il suo stile) e salva solo ciò che approvi. [Come esportare da ogni app](docs/IMPORT.md) |
| **1.4** · Più fluida | Guarda ogni file che scrive **crescere dal vivo in chat** mentre il modello lo trasmette (OpenAI, Anthropic, xAI, OpenRouter e piani ChatGPT; Ollama lo invia in un unico blocco); un ritratto parlante con labiale sincronizzato su nove forme della bocca; log in testo semplice o JSON |
| **1.3** · Controlli più furbi | Il suo controllo "ha fatto davvero quello che dice?" ora funziona in tutte e sei le lingue; un piccolo modello locale opzionale come giudice porta ciò che individua dal 38% all'**88%** con una precisione del 95% ([misurato](docs/RESULTS.md)) |
| **1.2** · Tutta nella tua lingua | L'intera app, la guida e i messaggi del suo server in English, Español, Français, Deutsch, Português (Brasil) e Italiano |
| **1.1** · Si installa ovunque | Configura un nuovo server nel browser con un breve codice; un'immagine Docker anche per **ARM** (Raspberry Pi 4/5); Homebrew, Unraid, TrueNAS, Proxmox e Home Assistant (HACS) |

Tutte le versioni: [CHANGELOG.md](CHANGELOG.md) · [versioni](https://github.com/farena-ai/sara/releases).

### In arrivo

Tutte le fasi previste sono uscite. Prossimi passi: l'app per iPhone (in attesa della revisione di Apple), ciò che resta in ogni funzione e le tue idee nelle [Discussions](https://github.com/farena-ai/sara/discussions).

Il piano completo: [docs/ROADMAP.md](docs/ROADMAP.md).

## Perché Sara

- **Piacevole da avere accanto.** Dalle il nome che vuoi, scegli lei/lui/loro, regola la sua
  personalità con cursori semplici (o parti da un personaggio già pronto) e lei la mantiene:
  stati d'animo, la sua giornata, battute ricorrenti e ricordi di quello che le hai raccontato,
  che puoi vedere, correggere e cancellare.
- **Utile per il lavoro vero.** File, terminale e git in uno spazio di lavoro isolato, attività in
  background, anteprime dal vivo che prova nel suo browser, una squadra di aiutanti per i lavori
  più grandi e un controllo che quello che *dice* di aver fatto corrisponda a quello che è stato
  davvero eseguito.
- **Tua.** Un solo proprietario per server; le tue chat, i ricordi e le chiavi restano lì. Usa
  qualsiasi modello: locale (Ollama, vLLM, llama.cpp), nel cloud (OpenAI, Anthropic, xAI,
  OpenRouter) o gli abbonamenti che paghi già (piano ChatGPT, Claude Pro/Max, SuperGrok / X
  Premium+). Arriva **senza credenziali di alcun tipo**.
- **Piccola e leggibile.** TypeScript che Node esegue direttamente: nessuna fase di build, zero
  dipendenze a runtime, costruita da zero (non basata su Hermes Agent né su OpenClaw). Facile da
  [estendere](docs/EXTENDING.md).

## Le funzioni in breve

### Compagna

<img src="docs/screenshots/companion.png" alt="Sara answering a tired user warmly and with humour before starting work" width="760">

Un carattere suo e stati d'animo che cambiano a seconda di come vanno le cose, la sua giornata e i
suoi hobby, la memoria di ciò che conta per te e delle date importanti (puoi vedere, correggere o
dimenticare qualsiasi cosa), un riepilogo settimanale, messaggi di sua iniziativa se vuoi (con
orari di silenzio) e una linea del tempo della vostra storia insieme.
Arrivi da un'altra app? Porta le tue chat da ChatGPT, Claude, Character.AI, SillyTavern, Replika,
Nomi o Kindroid e approva prima quello che ne impara ([docs/IMPORT.md](docs/IMPORT.md)).
Oppure riunisci da due a quattro delle tue compagne in una chat di gruppo ([docs/GROUP_CHATS.md](docs/GROUP_CHATS.md)).
Vuoi tutto su una sola macchina? Attiva **Niente lascia questo computer** ([docs/PRIVATE_LOCAL.md](docs/PRIVATE_LOCAL.md)).

### Compagna di programmazione

<img src="docs/screenshots/coding.png" alt="The tip calculator she built, open in the live preview pane next to the chat, while she writes its stylesheet: the file grows live in the chat" width="760">

Uno spazio di lavoro per progetto con file, terminale e git (commit e push con il tuo OK);
ogni file che scrive compare dal vivo in chat mentre il modello lo trasmette (con i modelli cloud;
Ollama lo invia intero); build e
test lunghi in background, con un avviso quando finiscono; un'anteprima dal vivo dell'app che sta
costruendo, che prova in un vero browser headless e di cui allega gli screenshot; una mappa del
codice per i progetti grandi; progetti di partenza collaudati; una squadra di aiutanti
(pianificare → costruire → provare → revisionare) da una issue di GitHub a una pull request
revisionata; passaggio a Claude Code o Grok Build; strumenti MCP; annullamento delle modifiche ai
file; un contatore di token e costi con budget;
e un controllo, in tutte e sei le lingue, che quello che *dice* di aver fatto corrisponda a quello
che è stato davvero eseguito (facoltativamente giudicato da un piccolo modello locale).

### Agenda e Oggi

<img src="docs/screenshots/planner.png" alt="Sara adding a reminder and two to-dos from one message" width="760">

Cose da fare, note e promemoria da frasi normali, consegnati in chat, sul telefono e su Telegram o
Discord; un riepilogo del mattino e una pagina Oggi.

### Biblioteca

<img src="docs/screenshots/library.png" alt="Sara answering from a handbook in her library" width="760">

Dalle PDF (anche scansioni), Word, Excel, PowerPoint, e-book, pagine web e note. Impara i punti
chiave, risponde basandosi su di essi e dice da quale documento (e pagina) viene la risposta.

### Voce

<img src="docs/screenshots/voice.png" alt="The voice settings page" width="760">

Chiamate dal vivo che puoi interrompere (voce in tempo reale di Grok o OpenAI), messaggi vocali su
Telegram e Discord, lettura ad alta voce, una voce che segue il suo umore e un ritratto animato che parla, con labiale sincronizzato su nove forme della bocca. Le voci girano sul tuo server Linux o arrivano dal tuo abbonamento. (Screenshot da un server
di prova Windows, dove la voce locale non è ancora disponibile.)

### Ovunque

<img src="docs/screenshots/everywhere.png" alt="Sara on a phone-sized screen answering from her library" width="260">

App web e PWA installabile, app per Android e iPhone ([android/](android/README.md),
[ios/](ios/README.md)), app desktop per Windows e macOS ([docs/desktop.md](docs/desktop.md)), ponti
con Telegram e Discord, `sara-chat` in qualsiasi terminale e un pannello per VS Code
([docs/clients.md](docs/clients.md)), Gmail e Google Calendar con la tua app Google, Home
Assistant, conversazioni riservate che non vengono mai salvate e altre app con la sua memoria e la
sua personalità: un'API compatibile con OpenAI (SillyTavern, Open WebUI, script), un server MCP
(Claude Code, Cursor, Claude Desktop; [presente su Glama](https://glama.ai/mcp/servers/farena-ai/sara)) e schede personaggio da importare ed esportare
([docs/OTHER_APPS.md](docs/OTHER_APPS.md)).

### Fallo a modo tuo

<img src="docs/screenshots/make-it-yours.png" alt="Name and personality settings with the character gallery" width="760">

Qualsiasi nome, pronomi, età e aspetto (dipinto da Grok Imagine, con espressioni e animazioni
abbinate), una procedura guidata "crea la tua compagna", cursori della personalità, una galleria
di personaggi di partenza, file personaggio da condividere, un modello per ogni compito e
l'intera app, la guida e i suoi messaggi in sei lingue. Ogni impostazione ha il suo **?**, ci sono brevi tour guidati e puoi semplicemente
chiederle come funziona qualcosa.

### Sicurezza, sempre attiva

<img src="docs/screenshots/safety.png" alt="An approval card: Sara asks before running a command" width="760">

Le azioni rischiose aspettano il tuo OK (su Windows, che non ha l'isolamento dei comandi, lo
aspetta ogni comando). Il livello di sicurezza gira nel codice attorno a ogni chiamata al modello e
**non si può disattivare**: avviso che è un'IA all'inizio e poi regolarmente, una risposta onesta
ogni volta che le si chiede sul serio se è un'IA, risorse di aiuto nelle crisi e un blocco totale
dei contenuti sessuali che coinvolgono minori ([docs/COMPLIANCE.md](docs/COMPLIANCE.md),
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)). Backup giornalieri (più copie cifrate fuori dal
server), ripristino e aggiornamento con un solo comando e `sara doctor` la tengono in forma.

## Come si incastra tutto

<img src="docs/architecture.svg" alt="Architecture: apps and bridges talk to one Sara server; each turn passes the always-on safety layer, gathers memory and library context, calls the chosen model provider and runs tools in a sandboxed workspace; data stays in one folder on your server" width="860">

Altri dettagli in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Collaudata, con risultati pubblicati

Tutto quello che segue è stato eseguito davvero; gli script sono nel repository, quindi puoi
rieseguirli con i tuoi modelli. Date, configurazione e file dei risultati:
**[docs/RESULTS.md](docs/RESULTS.md)**.

| Test | Modello | Punteggio | Data |
|---|---|---|---|
| [HumanEval](https://github.com/openai/human-eval), con il suo ciclo da agente (164 problemi, test nascosti) | qwen3.8 27B, locale | **158/164** (pass@1 96,3%) | 2026-10-27 |
| HumanEval, stesso modello senza strumenti (riferimento) | qwen3.8 27B, locale | **161/164** (pass@1 98,2%) | 2026-10-27 |
| Compiti su repository: 14 correzioni, funzioni e refactoring originali su più file (test nascosti), con il suo ciclo da agente | qwen3.8 27B, locale | **11/14** (in entrambe le esecuzioni) | 2026-10-28 |
| Compiti su repository, stesso modello con tutti i file in un solo messaggio e senza strumenti (riferimento) | qwen3.8 27B, locale | **12/14** (in entrambe le esecuzioni) | 2026-10-28 |
| Progetti di dimensioni reali: 3 progetti originali da 22 a 36 file (test nascosti), con il suo ciclo da agente | qwen3.8 27B, locale | **2/3**, poi **3/3** | 2026-10-28 |
| Progetti di dimensioni reali, stesso modello con tutti i file in un solo messaggio e senza strumenti (riferimento) | qwen3.8 27B, locale | **3/3** (in entrambe le esecuzioni) | 2026-10-28 |
| Controllo di ciò che dice di aver fatto, in 6 lingue (240 risposte tenute da parte): solo schemi → con un giudice locale | qwen3.5 9B, locale, come giudice | individuate **38% → 88%**, precisione 92% → 95% | 2026-10-28 |
| Memoria tra le sessioni (ricordare, non inventare, dimenticare) | qwen3.8 27B, locale | **11/12** controlli | 2026-10-27 |
| Biblioteca: risponde dai documenti e dice da dove | qwen3.8 27B, locale | **8/8** in entrambe le esecuzioni | 2026-10-27 |
| Mappa del codice: domande sul suo stesso codice | qwen3.8 27B, locale | **8/8** | 2026-10-27 |

La lettura onesta: il suo ciclo da agente non aggiunge ancora punti in nessuno dei due test di
programmazione. Il modello da solo risolve già quasi tutti i brevi problemi di HumanEval, e i 14
compiti su repository sono abbastanza piccoli (da 5 a 7 file) da stare interi in un solo
messaggio (come i tre progetti di dimensioni reali, sotto le 1.100 righe); gli errori, in entrambe le modalità, riguardavano regole scritte solo in un README o in
uno SPEC che nessun test controllava. Quello che aggiunge oggi è il modo di lavorare (esegue i test,
chiede prima dei passi rischiosi, mostra cosa è stato eseguito), non un punteggio più alto su questi
insiemi. Dettagli, risultati per compito e come rieseguirlo: [docs/RESULTS.md](docs/RESULTS.md).

In più, `npm run check`: un controllo dei tipi e 866 test automatici con un finto modello guidato
da script (senza rete, senza GPU): 858 passano su Windows e gli altri 8 sono test dell'isolamento
solo per Linux, eseguiti su un server Linux.

## Il confronto

Un confronto generale con i tipi di alternative più comuni (ogni prodotto è diverso):

| | Sara | App di compagnia IA ospitate | CLI e agenti di programmazione | Interfacce chat self-hosted |
|---|:-:|:-:|:-:|:-:|
| Gira sul tuo computer o server | ✅ | ❌ | ✅ | ✅ |
| Qualsiasi modello, anche locale | ✅ | ❌ di solito il loro | dipende | ✅ |
| Personalità e memoria durature che puoi vedere e modificare | ✅ | ✅ | ❌ | dipende |
| Scrive, esegue e prova codice, chiede prima dei passi rischiosi | ✅ | ❌ | ✅ | dipende (plug-in) |
| Agenda, promemoria, documenti, chiamate vocali | ✅ | alcune | ❌ | alcune |
| App per telefono, Telegram e Discord | ✅ | app per telefono | ❌ | dipende |
| Porta le tue chat da altre app di compagnia, riviste prima di salvarle | ✅ | ❌ di solito | ❌ | dipende |
| L'intera app in sei lingue | ✅ | dipende | dipende | dipende |
| Livello di sicurezza che nessuna impostazione disattiva | ✅ | regole proprie | n/a | di solito no |
| Prezzo | gratis (MIT); paghi i tuoi modelli | abbonamento | dipende | di solito gratis |

## Installazione

**Server Linux** (Debian/Ubuntu, Fedora/RHEL/Alma/Rocky, Arch, openSUSE), un solo comando che fa
qualche domanda semplice (premi Invio per accettare il suggerimento):

```sh
curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/deploy/get-sara.sh | sudo bash
# it ends with the address to open and your one-time owner token
sudo sara status
```

**Docker:**

```sh
git clone https://github.com/farena-ai/sara && cd sara
sudo docker compose up -d                       # or: sudo docker compose --profile ollama up -d  (with a local Ollama)
sudo docker compose logs sara | grep -A1 'owner token'   # oppure: apri la sua pagina e inserisci il codice di configurazione da questo log
```

**App store e NAS:** l'immagine `ghcr.io/farena-ai/sara` (amd64 e ARM),
`brew install --cask farena-ai/tap/sara`, TrueNAS, Proxmox e HACS (come repository personalizzato)
funzionano già; Unraid è approvato, e winget, CasaOS/ZimaOS, Umbrel e l'elenco ufficiale di HACS
sono in attesa di revisione
([quale è quale](docs/INSTALL.md#other-ways-to-install)). Un nuovo server si configura nel
browser con un breve codice dal suo log (con un clic su Umbrel).

**Windows e macOS:** scarica `Sara-Setup-<version>.exe` o `Sara-<version>.dmg` dalla
[pagina delle versioni](https://github.com/farena-ai/sara/releases/latest). La prima domanda: far
girare Sara su questo computer (il suo server e l'app desktop insieme) o collegarti a una Sara che
si trova altrove (solo l'app).

**Dal codice sorgente** (qualsiasi computer con Node 24 o più recente):

```sh
git clone https://github.com/farena-ai/sara && cd sara
npm ci
npm start                                       # http://127.0.0.1:7860; the token is in the output
```

Accedi con il token (o il codice di configurazione): una guida
di configurazione ti chiede il nome, ti aiuta a dare forma alla tua compagna e collega un modello.
Come raggiungerla dal telefono (Tailscale, un tuo indirizzo web con HTTPS o la rete di casa),
aggiornamenti, backup e risoluzione dei problemi: **[docs/INSTALL.md](docs/INSTALL.md)**.

## Tutti i giorni

```sh
sudo sara status       # is she running, last backup
sudo sara update       # backs up, updates, restarts
sudo sara backup       # back up now
sudo sara restore FILE # restore a backup
sudo sara access       # how you reach her (change: tailscale, local, domain, lan)
```

## Documentazione

| | |
|---|---|
| [Installazione](docs/INSTALL.md) | Linux, Docker, Windows, macOS, HTTPS, aggiornamenti, risoluzione dei problemi |
| [Che computer mi serve?](docs/REQUIREMENTS.md) · [Scegliere un modello](docs/CHOOSING_A_MODEL.md) · [Quanto costa](docs/COSTS.md) | Prima di iniziare: hardware, modelli con dimensioni della GPU, costi d'uso |
| [Il tuo telefono](docs/PHONE.md) · [Passare a un nuovo computer](docs/MOVING.md) | Configurazione del telefono dall'inizio alla fine; backup, installazione, ripristino |
| [Lista di sicurezza](docs/SECURITY_CHECKLIST.md) · [Cosa esce dal tuo server](docs/PRIVACY.md) | Cinque minuti dopo l'installazione; ogni connessione in uscita e come disattivarla |
| [Domande frequenti e glossario](docs/FAQ.md) | Domande comuni e cosa significano le parole |
| [App e client](docs/clients.md) · [App desktop](docs/desktop.md) · [Home Assistant](docs/HOME_ASSISTANT.md) | Terminale, VS Code, Windows e macOS; Sara in Home Assistant e Home Assistant in Sara |
| [Altre app](docs/OTHER_APPS.md) | API compatibile con OpenAI (SillyTavern, Open WebUI, script), MCP (Claude Code, Cursor, Claude Desktop), schede personaggio |
| [Più Sara in un'app](docs/SERVERS.md) · [Modalità locale privata](docs/PRIVATE_LOCAL.md) · [Modalità famiglia](docs/HOUSEHOLD.md) | Passare da un server all'altro; tenere tutto su un computer; condividere un server con le persone con cui vivi |
| [Chat di gruppo](docs/GROUP_CHATS.md) · [Videochiamate](docs/VIDEO_CALLS.md) · [I nostri momenti](docs/MOMENTS.md) · [Documenti grandi](docs/LIBRARY.md) | Più compagne in una chat; chiamate con il suo ritratto animato; l'album condiviso; libri da 1.000 pagine nella sua biblioteca |
| [Assistenti vocali](docs/VOICE_ASSISTANTS.md) · [Alexa](docs/ALEXA.md) · [Server via SSH](docs/SSH.md) · [Pacchetti](docs/PACKAGING.md) | Alexa, assistente Android, Google Home, Siri; lavorare sui tuoi altri server; Homebrew, winget, Unraid e gli altri |
| [Estendere Sara](docs/EXTENDING.md) | Aggiungere strumenti, ponti, personaggi, server MCP, lingue, progetti di partenza |
| [Architettura](docs/ARCHITECTURE.md) | Come si incastrano i pezzi, modulo per modulo |
| [Risultati](docs/RESULTS.md) | Benchmark e valutazioni, e come rieseguirli |
| [Tradurre](docs/TRANSLATING.md) | L'app nella tua lingua |
| [Conformità](docs/COMPLIANCE.md) · [Modello delle minacce](docs/THREAT_MODEL.md) · [Avvertenze](docs/DISCLOSURES.md) | Tutela, sicurezza, cosa sapere prima |
| [Roadmap](docs/ROADMAP.md) · [Registro delle modifiche](CHANGELOG.md) · [Versioni](https://github.com/farena-ai/sara/releases) | Dove va, cosa è cambiato |

Tutto questo diventa anche un piccolo sito con ricerca e tema scuro: `node scripts/build-docs.ts`
lo scrive in `outputs/site/` (apri `index.html`; è pronto per GitHub Pages).

## Contribuire

I contributi sono benvenuti. Inizia da [CONTRIBUTING.md](CONTRIBUTING.md) e dalle
[issue per iniziare](docs/GOOD_FIRST_ISSUES.md); rispetta il
[codice di condotta](CODE_OF_CONDUCT.md) e segnala i problemi di sicurezza in privato, come
descritto in [SECURITY.md](SECURITY.md).

```sh
npm ci
npm run dev        # http://127.0.0.1:7860, restarts on save
npm run check      # typecheck + all tests
```

## Licenza

MIT, vedi [LICENSE](LICENSE). Riconoscimenti per le parti che Sara scarica o usa:
[docs/CREDITS.md](docs/CREDITS.md).
