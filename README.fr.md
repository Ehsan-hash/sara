<p align="center"><a href="README.md">English</a> · <a href="README.es.md">Español</a> · <b>Français</b> · <a href="README.de.md">Deutsch</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.it.md">Italiano</a></p>

# Sara

**Une compagne IA auto-hébergée, avec la personnalité que vous choisissez, qui est aussi une
vraie partenaire de programmation.** Elle discute, se souvient, planifie, lit vos documents, et
écrit et teste des logiciels dans un environnement isolé, sur votre propre serveur, avec les
modèles que vous choisissez.

> Ceci est une traduction du [README en anglais](README.md). Les liens mènent à la documentation,
> qui est en anglais.

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2024-339933" alt="Node 24 or newer">
  <img src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen" alt="Zero runtime dependencies">
  <img src="https://img.shields.io/badge/tests-732%20passing-brightgreen" alt="732 tests passing">
  <a href="docs/RESULTS.md"><img src="https://img.shields.io/badge/HumanEval%20pass%401-96.3%25-informational" alt="HumanEval pass@1 96.3%"></a>
  <a href="https://github.com/farena-ai/sara/releases/latest"><img src="https://img.shields.io/github/v/release/farena-ai/sara?label=release" alt="Latest release"></a>
  <a href="https://github.com/farena-ai/sara/pkgs/container/sara"><img src="https://img.shields.io/badge/docker-amd64%20%7C%20arm64-2496ED" alt="Docker image for amd64 and arm64"></a>
  <img src="https://img.shields.io/badge/languages-6-8A2BE2" alt="Six languages">
  <a href="https://glama.ai/mcp/servers/farena-ai/sara"><img src="https://glama.ai/mcp/servers/farena-ai/sara/badges/score.svg" alt="Sara MCP server on Glama"></a>
</p>

<p align="center">
  <img src="docs/screenshots/demo.png" alt="Animated demo: Sara cheers the user up, builds a tip calculator, asks before starting a server, opens a live preview, tests it in her own browser and shows the screenshot she took" width="860">
  <br>
  <sub>Une vraie session, non montée, avec un modèle local (qwen3.8 27B sur Ollama, une RTX 5090) sur un serveur de test jetable : elle discute avec sa personnalité, écrit l'application, demande avant de lancer un serveur, ouvre l'aperçu et le teste dans son propre navigateur. La dernière image montre l'application avec des nombres saisis.</sub>
</p>

> **État :** 1.9, licence MIT, avec neuf versions riches en nouveautés depuis la 1.0 (toutes
> ci-dessous). L'[app Android](https://play.google.com/store/apps/details?id=com.backstagecoding.sara) est sur Google Play ;
> l'app iPhone et la version Mac App Store arrivent dès qu'Apple les aura approuvées. Lisez
> [docs/DISCLOSURES.md](docs/DISCLOSURES.md) avant d'utiliser ou de partager Sara.

## Quoi de neuf

| Version | Ce que vous y gagnez |
|---|---|
| **1.9** · Appels vidéo | **Voyez-la pendant que vous parlez :** un appel vidéo affiche son portrait animé en grand, les lèvres synchronisées sur sa voix, le visage qui suit son humeur, dans sa tenue et son lieu du moment. Allumez votre caméra si vous voulez : elle regarde toutes les quelques secondes (ou quand vous appuyez sur *Regarde ça*) ; rien n'est enregistré. [Comment ça marche](docs/VIDEO_CALLS.md) |
| **1.8** · Plusieurs serveurs dans une app | Gardez **toutes vos Sara dans une seule app** (maison et travail, ou plusieurs sur un serveur) et passez de l'une à l'autre depuis un menu sans vous déconnecter : apps Windows et Mac, Android et iPhone, VS Code, `sara-chat` et le pont MCP. Chacune garde sa propre connexion ; les fichiers, le micro et la caméra ne vont qu'à celle en cours. [Comment ça marche](docs/SERVERS.md) |
| **1.7** · Mode local privé | Un interrupteur, **Rien ne quitte cet ordinateur**, appliqué dans le code en un seul point : seul cet ordinateur est joignable, les modèles cloud et les outils en ligne sont en pause, et ses conversations, sa mémoire et sa bibliothèque continuent de fonctionner. Les applications Windows et Mac trouvent Ollama (ou vous aident à l'installer), proposent un modèle adapté à votre carte graphique et le téléchargent avec une barre de progression. [Ce qu'il garantit](docs/PRIVATE_LOCAL.md) |
| **1.6** · Discussions de groupe | Réunissez **deux à quatre de vos compagnes dans une même conversation** : chacune répond avec sa personnalité, sa voix et sa couleur ; choisissez qui répond (celle qui convient, toutes, à tour de rôle, ou seulement celle que vous mentionnez avec @) et combien elles bavardent entre elles. La sécurité, les avis d'IA et le réglage adulte le plus strict valent pour tout le salon. [Comment ça marche](docs/GROUP_CHATS.md) |
| **1.5** · Faites-la venir d'une autre app | Quittez **ChatGPT, Claude, Character.AI, SillyTavern, Replika, Nomi ou Kindroid** pour elle. Elle lit l'export sur votre propre serveur, puis vous montre ce qu'elle a appris (des faits avec vos propres mots, votre histoire commune, son style) et n'enregistre que ce que vous approuvez. [Comment exporter depuis chaque app](docs/IMPORT.md) |
| **1.4** · Plus de fluidité | Regardez chaque fichier qu'elle écrit **grandir en direct dans le chat** pendant que le modèle le diffuse (OpenAI, Anthropic, xAI, OpenRouter et offres ChatGPT ; Ollama l'envoie d'un seul bloc) ; un portrait qui parle, synchronisé sur les lèvres avec neuf formes de bouche ; des journaux en texte brut ou en JSON |
| **1.3** · Des vérifications plus fines | Sa vérification « a-t-elle vraiment fait ce qu'elle dit ? » fonctionne désormais dans les six langues ; un petit modèle local facultatif, utilisé comme juge, fait passer la détection de 38 % à **88 %** avec 95 % de précision ([mesuré](docs/RESULTS.md)) |
| **1.2** · Entièrement dans votre langue | Toute l'application, le guide d'aide et les messages de son serveur en English, Español, Français, Deutsch, Português (Brasil) et Italiano |
| **1.1** · S'installe partout | Configurez un nouveau serveur dans le navigateur avec un court code ; une image Docker aussi pour **ARM** (Raspberry Pi 4/5) ; Homebrew, Unraid, TrueNAS, Proxmox et Home Assistant (HACS) |

Toutes les versions : [CHANGELOG.md](CHANGELOG.md) · [versions](https://github.com/farena-ai/sara/releases).

### À venir

| Version | Fonctionnalité |
|---|---|
| 1.10 | **Nos moments :** un album photo partagé avec ses légendes |
| 2.0 | **Mode foyer :** plusieurs personnes sur un même serveur, chacune avec ses propres compagnes et ses données privées |
| 2.1 | **Sa voix chez vous :** Alexa (« Alexa, demande à Sara… »), l'assistant d'Android et Google Home, les raccourcis Siri, et des réactions selon qui est à la maison grâce à Home Assistant |
| 2.2 | **Vos autres serveurs en SSH :** avec un mot de passe ou une clé ; après une connexion par mot de passe, elle crée sa propre clé, vous dit où elle se trouve et ne garde le mot de passe que si vous le demandez (avec un avertissement) |
| 2.3 | **Gros documents :** des PDF et des livres de 500 à 1 000 pages dans sa bibliothèque, chaque page scannée lue, des réponses avec les numéros de page |

Le plan complet : [docs/ROADMAP.md](docs/ROADMAP.md).

## Pourquoi Sara

- **Agréable à côtoyer.** Donnez-lui le nom que vous voulez, choisissez elle/il/iel, réglez sa
  personnalité avec des curseurs simples (ou partez d'un personnage tout prêt), et elle la garde :
  humeurs, sa propre journée, blagues récurrentes et souvenirs de ce que vous lui avez dit, que
  vous pouvez voir, corriger et effacer.
- **Utile pour du vrai travail.** Fichiers, terminal et git dans un espace de travail isolé,
  tâches en arrière-plan, aperçus en direct qu'elle teste dans son propre navigateur, une équipe
  d'assistants pour les gros chantiers, et une vérification que ce qu'elle *dit* avoir fait
  correspond à ce qui a vraiment tourné.
- **À vous.** Un seul propriétaire par serveur ; vos conversations, souvenirs et clés restent là.
  Utilisez n'importe quel modèle : local (Ollama, vLLM, llama.cpp), dans le cloud (OpenAI,
  Anthropic, xAI, OpenRouter) ou les abonnements que vous payez déjà (offre ChatGPT, Claude
  Pro/Max, SuperGrok / X Premium+). Livrée **sans aucun identifiant**.
- **Petite et lisible.** Du TypeScript que Node exécute directement : pas d'étape de compilation,
  zéro dépendance à l'exécution, écrite de zéro (pas basée sur Hermes Agent ni sur OpenClaw).
  Facile à [étendre](docs/EXTENDING.md).

## Tour des fonctionnalités

### Compagne

<img src="docs/screenshots/companion.png" alt="Sara answering a tired user warmly and with humour before starting work" width="760">

Son propre caractère et des humeurs qui changent selon la façon dont les choses se passent, sa
propre journée et ses loisirs, la mémoire de ce qui compte pour vous et des dates qui vous tiennent
à cœur (vous pouvez tout voir, corriger ou effacer), un bilan hebdomadaire, des messages de sa
part si vous le souhaitez (avec des heures calmes) et une frise de votre histoire commune.
Vous venez d'une autre app ? Importez vos conversations depuis ChatGPT, Claude, Character.AI,
SillyTavern, Replika, Nomi ou Kindroid, et validez d'abord ce qu'elle en retient
([docs/IMPORT.md](docs/IMPORT.md)). Ou réunissez deux à quatre de vos compagnes dans une discussion de groupe ([docs/GROUP_CHATS.md](docs/GROUP_CHATS.md)).
Vous voulez tout sur une seule machine ? Activez **Rien ne quitte cet ordinateur** ([docs/PRIVATE_LOCAL.md](docs/PRIVATE_LOCAL.md)).

### Partenaire de programmation

<img src="docs/screenshots/coding.png" alt="The tip calculator she built, open in the live preview pane next to the chat, while she writes its stylesheet: the file grows live in the chat" width="760">

Un espace de travail par projet avec fichiers, terminal et git (commit et push avec votre accord) ;
chaque fichier qu'elle écrit apparaît en direct dans le chat pendant que le modèle le diffuse (avec
les modèles cloud ; Ollama l'envoie d'un bloc) ;
les longues compilations et les tests en arrière-plan, avec une notification à la fin ; un aperçu
en direct de l'application qu'elle construit, qu'elle teste dans un vrai navigateur sans interface
et dont elle joint des captures ; une carte du code pour les gros projets ; des projets de départ
testés ; une équipe d'assistants (planifier → construire → tester → relire) qui va d'une issue
GitHub à une pull request relue ; le passage de relais à Claude Code ou Grok Build ; des outils
MCP ; l'annulation des modifications de fichiers ; un compteur de tokens et de coûts avec budgets ;
et une vérification, dans les six langues, que ce qu'elle *dit* avoir fait correspond à ce qui a
vraiment tourné (éventuellement jugée par un petit modèle local).

### Agenda et Aujourd'hui

<img src="docs/screenshots/planner.png" alt="Sara adding a reminder and two to-dos from one message" width="760">

Tâches, notes et rappels à partir de phrases ordinaires, livrés dans le chat, sur votre téléphone
et sur Telegram ou Discord ; un point du matin et une page Aujourd'hui.

### Bibliothèque

<img src="docs/screenshots/library.png" alt="Sara answering from a handbook in her library" width="760">

Donnez-lui des PDF (scans compris), Word, Excel, PowerPoint, livres numériques, pages web et
notes. Elle en retient l'essentiel, répond à partir d'eux et indique de quel document (et de
quelle page) vient la réponse.

### Voix

<img src="docs/screenshots/voice.png" alt="The voice settings page" width="760">

Des appels en direct que vous pouvez interrompre (voix temps réel de Grok ou d'OpenAI), des
messages vocaux sur Telegram et Discord, la lecture à voix haute, une voix qui suit son humeur et
un portrait animé qui parle, synchronisé sur les lèvres avec neuf formes de bouche. Les voix tournent sur votre serveur Linux ou viennent de votre
abonnement. (Capture d'un serveur de test sous Windows, où la voix locale n'est pas encore
disponible.)

### Partout

<img src="docs/screenshots/everywhere.png" alt="Sara on a phone-sized screen answering from her library" width="260">

Application web installable (PWA), applications Android et iPhone ([android/](android/README.md),
[ios/](ios/README.md)), applications de bureau pour Windows et macOS
([docs/desktop.md](docs/desktop.md)), passerelles Telegram et Discord, `sara-chat` dans n'importe
quel terminal et un panneau VS Code ([docs/clients.md](docs/clients.md)), Gmail et Google Agenda
avec votre propre application Google, Home Assistant, des conversations confidentielles jamais
enregistrées, et d'autres applications avec sa propre mémoire et sa personnalité : une API
compatible OpenAI (SillyTavern, Open WebUI, scripts), un serveur MCP (Claude Code, Cursor, Claude
Desktop ; [référencé sur Glama](https://glama.ai/mcp/servers/farena-ai/sara)) et des fiches de personnage en import et en export
([docs/OTHER_APPS.md](docs/OTHER_APPS.md)).

### À votre image

<img src="docs/screenshots/make-it-yours.png" alt="Name and personality settings with the character gallery" width="760">

N'importe quel nom, pronoms, âge et apparence (peinte par Grok Imagine, avec expressions et
animation assorties), un assistant guidé « créer votre compagne », des curseurs de personnalité,
une galerie de personnages de départ, des fichiers de personnage à partager, un modèle pour chaque
tâche, et toute l'application, le guide d'aide et ses messages en six langues. Chaque réglage a son **?**, il y a de courtes visites
guidées, et vous pouvez simplement lui demander comment fonctionne quelque chose.

### Sécurité, toujours active

<img src="docs/screenshots/safety.png" alt="An approval card: Sara asks before running a command" width="760">

Les actions risquées attendent votre accord (sous Windows, qui n'a pas d'isolation des commandes,
c'est le cas de chaque commande). La couche de sécurité tourne dans le code autour de chaque appel
au modèle et **ne peut pas être désactivée** : mention « IA » au début puis régulièrement, une
réponse honnête chaque fois qu'on lui demande sincèrement si elle est une IA, des ressources
d'aide en cas de crise, et un blocage strict de tout contenu sexuel impliquant des mineurs
([docs/COMPLIANCE.md](docs/COMPLIANCE.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)).
Sauvegardes quotidiennes (plus des copies chiffrées hors du serveur), restauration et mise à jour
en une commande, et `sara doctor` la gardent en bonne santé.

## Comment tout s'assemble

<img src="docs/architecture.svg" alt="Architecture: apps and bridges talk to one Sara server; each turn passes the always-on safety layer, gathers memory and library context, calls the chosen model provider and runs tools in a sandboxed workspace; data stays in one folder on your server" width="860">

Plus de détails dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testée, avec des résultats publiés

Tout ce qui suit a vraiment été exécuté ; les scripts sont dans le dépôt, vous pouvez donc les
relancer avec vos propres modèles. Dates, configuration et fichiers de résultats :
**[docs/RESULTS.md](docs/RESULTS.md)**.

| Test | Modèle | Score | Date |
|---|---|---|---|
| [HumanEval](https://github.com/openai/human-eval), via sa boucle d'agent (164 problèmes, tests cachés) | qwen3.8 27B, local | **158/164** (pass@1 96,3 %) | 2026-10-27 |
| HumanEval, même modèle sans outils (référence) | qwen3.8 27B, local | **161/164** (pass@1 98,2 %) | 2026-10-27 |
| Tâches de dépôt : 14 corrections, fonctionnalités et refactorisations originales sur plusieurs fichiers (tests cachés), via sa boucle d'agent | qwen3.8 27B, local | **11/14** (dans les deux exécutions) | 2026-10-28 |
| Tâches de dépôt, même modèle avec tous les fichiers dans un seul message et sans outils (référence) | qwen3.8 27B, local | **12/14** (dans les deux exécutions) | 2026-10-28 |
| Projets de taille réelle : 3 projets originaux de 22 à 36 fichiers (tests cachés), via sa boucle d'agent | qwen3.8 27B, local | **2/3**, puis **3/3** | 2026-10-28 |
| Projets de taille réelle, même modèle avec tous les fichiers dans un seul message et sans outils (référence) | qwen3.8 27B, local | **3/3** (dans les deux exécutions) | 2026-10-28 |
| Vérification de ses affirmations en 6 langues (240 réponses mises de côté) : motifs seuls → avec un juge local | qwen3.5 9B, local, comme juge | détection **38 % → 88 %**, précision 92 % → 95 % | 2026-10-28 |
| Mémoire entre les sessions (se souvenir, ne rien inventer, oublier) | qwen3.8 27B, local | **11/12** vérifications | 2026-10-27 |
| Bibliothèque : répond à partir des documents et cite la source | qwen3.8 27B, local | **8/8** dans les deux exécutions | 2026-10-27 |
| Carte du code : questions sur son propre code | qwen3.8 27B, local | **8/8** | 2026-10-27 |

La lecture honnête : sa boucle d'agent n'ajoute pas encore de points sur ces deux tests de
programmation. Le modèle seul réussit déjà presque tous les petits problèmes de HumanEval, et les 14
tâches de dépôt sont assez petites (5 à 7 fichiers) pour tenir en entier dans un seul message (c'est aussi le cas des trois projets de
taille réelle, à moins de 1 100 lignes) ; les
échecs, dans les deux modes, portaient sur des règles écrites seulement dans un README ou un SPEC
qu'aucun test ne vérifiait. Ce qu'elle apporte aujourd'hui, c'est la manière de travailler (elle
lance les tests, demande avant les étapes risquées, montre ce qui a tourné), pas un meilleur score
sur ces jeux. Détails, résultats par tâche et comment relancer : [docs/RESULTS.md](docs/RESULTS.md).

En plus, `npm run check` : une vérification des types et 740 tests automatiques avec un faux modèle
scripté (sans réseau, sans GPU) : 732 passent sous Windows, et les 8 autres sont des tests
d'isolation propres à Linux, exécutés sur un serveur Linux.

## Comparaison

Une comparaison générale avec les types d'alternatives habituels (chaque produit est différent) :

| | Sara | Applis de compagnie IA hébergées | CLI et agents de code | Interfaces de chat auto-hébergées |
|---|:-:|:-:|:-:|:-:|
| Tourne sur votre propre ordinateur ou serveur | ✅ | ❌ | ✅ | ✅ |
| N'importe quel modèle, y compris en local | ✅ | ❌ en général le leur | variable | ✅ |
| Personnalité et mémoire durables, visibles et modifiables | ✅ | ✅ | ❌ | variable |
| Écrit, exécute et teste du code, demande avant les étapes risquées | ✅ | ❌ | ✅ | variable (extensions) |
| Agenda, rappels, documents, appels vocaux | ✅ | certaines | ❌ | certaines |
| Applis mobiles, Telegram et Discord | ✅ | applis mobiles | ❌ | variable |
| Importe vos conversations d'autres applis de compagnie, relues avant l'enregistrement | ✅ | ❌ en général | ❌ | variable |
| Toute l'application en six langues | ✅ | variable | variable | variable |
| Couche de sécurité qu'aucun réglage ne désactive | ✅ | leurs propres règles | n/a | en général non |
| Prix | gratuit (MIT) ; vous payez vos modèles | abonnement | variable | en général gratuit |

## Installation

**Serveur Linux** (Debian/Ubuntu, Fedora/RHEL/Alma/Rocky, Arch, openSUSE), une seule commande qui
pose quelques questions simples (appuyez sur Entrée pour accepter la suggestion) :

```sh
curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/deploy/get-sara.sh | sudo bash
# it ends with the address to open and your one-time owner token
sudo sara status
```

**Docker :**

```sh
git clone https://github.com/farena-ai/sara && cd sara
sudo docker compose up -d                       # or: sudo docker compose --profile ollama up -d  (with a local Ollama)
sudo docker compose logs sara | grep -A1 'owner token'   # ou : ouvrez sa page et saisissez le code de configuration de ce journal
```

**Magasins d'apps et NAS :** l'image `ghcr.io/farena-ai/sara` (amd64 et ARM),
`brew install --cask farena-ai/tap/sara`, TrueNAS, Proxmox et HACS (en dépôt personnalisé)
fonctionnent déjà ; Unraid est approuvé, et winget, CasaOS/ZimaOS, Umbrel et la liste officielle de
HACS attendent leur validation ([lequel est lequel](docs/INSTALL.md#other-ways-to-install)). Un nouveau serveur se
configure dans le navigateur avec un court code tiré de son journal (en un clic sur Umbrel).

**Windows et macOS :** téléchargez `Sara-Setup-<version>.exe` ou `Sara-<version>.dmg` depuis la
[page des versions](https://github.com/farena-ai/sara/releases/latest). Première question : faire
tourner Sara sur cet ordinateur (son serveur et l'application de bureau ensemble) ou se connecter à
une Sara installée ailleurs (l'application seule).

**Depuis les sources** (tout ordinateur avec Node 24 ou plus récent) :

```sh
git clone https://github.com/farena-ai/sara && cd sara
npm ci
npm start                                       # http://127.0.0.1:7860; the token is in the output
```

Connectez-vous avec le jeton (ou le code de configuration) : un
guide de configuration vous demande votre nom, vous aide à façonner votre compagne et connecte un
modèle. L'accès depuis votre téléphone (Tailscale, votre propre adresse web en HTTPS ou votre
réseau local), les mises à jour, les sauvegardes et le dépannage :
**[docs/INSTALL.md](docs/INSTALL.md)**.

## Au quotidien

```sh
sudo sara status       # is she running, last backup
sudo sara update       # backs up, updates, restarts
sudo sara backup       # back up now
sudo sara restore FILE # restore a backup
sudo sara access       # how you reach her (change: tailscale, local, domain, lan)
```

## Documentation

| | |
|---|---|
| [Installation](docs/INSTALL.md) | Linux, Docker, Windows, macOS, HTTPS, mises à jour, dépannage |
| [De quel ordinateur ai-je besoin ?](docs/REQUIREMENTS.md) · [Choisir un modèle](docs/CHOOSING_A_MODEL.md) · [Ce que ça coûte](docs/COSTS.md) | Avant de commencer : matériel, modèles avec tailles de GPU, coûts d'utilisation |
| [Votre téléphone](docs/PHONE.md) · [Changer d'ordinateur](docs/MOVING.md) | Configurer le téléphone de A à Z ; sauvegarde, installation, restauration |
| [Liste de sécurité](docs/SECURITY_CHECKLIST.md) · [Ce qui quitte votre serveur](docs/PRIVACY.md) | Cinq minutes après l'installation ; chaque connexion sortante et comment la couper |
| [FAQ et glossaire](docs/FAQ.md) | Questions fréquentes, et ce que veulent dire les mots |
| [Applications et clients](docs/clients.md) · [Applications de bureau](docs/desktop.md) · [Home Assistant](docs/HOME_ASSISTANT.md) | Terminal, VS Code, Windows et macOS ; Sara dans Home Assistant et Home Assistant dans Sara |
| [Autres applications](docs/OTHER_APPS.md) | API compatible OpenAI (SillyTavern, Open WebUI, scripts), MCP (Claude Code, Cursor, Claude Desktop), cartes de personnage |
| [Étendre Sara](docs/EXTENDING.md) | Ajouter des outils, passerelles, personnages, serveurs MCP, langues, projets de départ |
| [Architecture](docs/ARCHITECTURE.md) | Comment les pièces s'assemblent, module par module |
| [Résultats](docs/RESULTS.md) | Tests et évaluations, et comment les relancer |
| [Traduire](docs/TRANSLATING.md) | L'application dans votre langue |
| [Conformité](docs/COMPLIANCE.md) · [Modèle de menaces](docs/THREAT_MODEL.md) · [Avertissements](docs/DISCLOSURES.md) | Sûreté, sécurité, ce qu'il faut savoir d'abord |
| [Feuille de route](docs/ROADMAP.md) · [Journal des modifications](CHANGELOG.md) · [Versions](https://github.com/farena-ai/sara/releases) | Où ça va, ce qui a changé |

Tout cela se transforme aussi en un petit site web avec recherche et mode sombre :
`node scripts/build-docs.ts` l'écrit dans `outputs/site/` (ouvrez `index.html` ; il est prêt pour
GitHub Pages).

## Contribuer

Les contributions sont les bienvenues. Commencez par [CONTRIBUTING.md](CONTRIBUTING.md) et les
[premières issues](docs/GOOD_FIRST_ISSUES.md) ; merci de respecter le
[code de conduite](CODE_OF_CONDUCT.md) et de signaler les problèmes de sécurité en privé, comme
indiqué dans [SECURITY.md](SECURITY.md).

```sh
npm ci
npm run dev        # http://127.0.0.1:7860, restarts on save
npm run check      # typecheck + all tests
```

## Licence

MIT, voir [LICENSE](LICENSE). Crédits pour les éléments que Sara télécharge ou utilise :
[docs/CREDITS.md](docs/CREDITS.md).
