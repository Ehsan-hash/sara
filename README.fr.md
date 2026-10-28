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
  <img src="https://img.shields.io/badge/tests-486%20passing-brightgreen" alt="486 tests passing">
  <a href="docs/RESULTS.md"><img src="https://img.shields.io/badge/HumanEval%20pass%401-96.3%25-informational" alt="HumanEval pass@1 96.3%"></a>
</p>

<p align="center">
  <img src="docs/screenshots/demo.png" alt="Animated demo: Sara cheers the user up, builds a tip calculator, asks before starting a server, opens a live preview, tests it in her own browser and shows the screenshot she took" width="860">
  <br>
  <sub>Une vraie session, non montée, avec un modèle local (qwen3.8 27B sur Ollama, une RTX 5090) sur un serveur de test jetable : elle discute avec sa personnalité, écrit l'application, demande avant de lancer un serveur, ouvre l'aperçu et le teste dans son propre navigateur. La dernière image montre l'application avec des nombres saisis.</sub>
</p>

> **État :** 1.0. Licence MIT. L'[app Android](https://play.google.com/store/apps/details?id=com.backstagecoding.sara) est sur Google Play ; l'app iPhone et la
> version Mac App Store arrivent dès qu'Apple les aura approuvées. Lisez
> [docs/DISCLOSURES.md](docs/DISCLOSURES.md) avant d'utiliser ou de partager Sara.

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

### Partenaire de programmation

<img src="docs/screenshots/coding.png" alt="The tip calculator she built, open in the live preview pane next to the chat" width="760">

Un espace de travail par projet avec fichiers, terminal et git (commit et push avec votre accord) ;
les longues compilations et les tests en arrière-plan, avec une notification à la fin ; un aperçu
en direct de l'application qu'elle construit, qu'elle teste dans un vrai navigateur sans interface
et dont elle joint des captures ; une carte du code pour les gros projets ; des projets de départ
testés ; une équipe d'assistants (planifier → construire → tester → relire) qui va d'une issue
GitHub à une pull request relue ; le passage de relais à Claude Code ou Grok Build ; des outils
MCP ; l'annulation des modifications de fichiers ; un compteur de tokens et de coûts avec budgets.

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
un portrait animé qui parle. Les voix tournent sur votre serveur Linux ou viennent de votre
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
Desktop) et des fiches de personnage en import et en export
([docs/OTHER_APPS.md](docs/OTHER_APPS.md)).

### À votre image

<img src="docs/screenshots/make-it-yours.png" alt="Name and personality settings with the character gallery" width="760">

N'importe quel nom, pronoms, âge et apparence (peinte par Grok Imagine, avec expressions et
animation assorties), un assistant guidé « créer votre compagne », des curseurs de personnalité,
une galerie de personnages de départ, des fichiers de personnage à partager, un modèle pour chaque
tâche et l'application en six langues. Chaque réglage a son **?**, il y a de courtes visites
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
| Mémoire entre les sessions (se souvenir, ne rien inventer, oublier) | qwen3.8 27B, local | **11/12** vérifications | 2026-10-27 |
| Bibliothèque : répond à partir des documents et cite la source | qwen3.8 27B, local | **8/8** dans les deux exécutions | 2026-10-27 |
| Carte du code : questions sur son propre code | qwen3.8 27B, local | **8/8** | 2026-10-27 |

La lecture honnête : sa boucle d'agent n'ajoute pas encore de points sur ces deux tests de
programmation. Le modèle seul réussit déjà presque tous les petits problèmes de HumanEval, et les 14
tâches de dépôt sont assez petites (5 à 7 fichiers) pour tenir en entier dans un seul message ; les
échecs, dans les deux modes, portaient sur des règles écrites seulement dans un README ou un SPEC
qu'aucun test ne vérifiait. Ce qu'elle apporte aujourd'hui, c'est la manière de travailler (elle
lance les tests, demande avant les étapes risquées, montre ce qui a tourné), pas un meilleur score
sur ces jeux. Détails, résultats par tâche et comment relancer : [docs/RESULTS.md](docs/RESULTS.md).

En plus, `npm run check` : une vérification des types et 493 tests automatiques avec un faux modèle
scripté (sans réseau, sans GPU) : 486 passent sous Windows, et les 7 autres sont des tests
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

**Magasins d'apps et NAS :** l'image `ghcr.io/farena-ai/sara` (aussi pour ARM), Homebrew, TrueNAS,
Proxmox et HACS (en dépôt personnalisé) fonctionnent déjà ; winget, CasaOS/ZimaOS, Umbrel et
Unraid attendent leur validation ([lequel est lequel](docs/INSTALL.md#other-ways-to-install)). Un nouveau serveur se
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
| [Feuille de route](docs/ROADMAP.md) · [Journal des modifications](CHANGELOG.md) · [Notes de version 1.0 (brouillon)](docs/RELEASE_NOTES_1.0_DRAFT.md) | Où ça va, ce qui a changé |

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
