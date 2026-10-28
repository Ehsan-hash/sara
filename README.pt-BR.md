<p align="center"><a href="README.md">English</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <b>Português (Brasil)</b> · <a href="README.it.md">Italiano</a></p>

# Sara

**Uma companheira de IA auto-hospedada, com a personalidade que você escolher, que também é uma
parceira de programação de verdade.** Ela conversa, lembra, planeja, lê seus documentos e cria e
testa software em um ambiente isolado, no seu próprio servidor, com os modelos que você escolher.

> Esta é uma tradução do [README em inglês](README.md). Os links levam à documentação, que está em
> inglês.

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
  <sub>Uma sessão real, sem edição, com um modelo local (qwen3.8 27B no Ollama, uma RTX 5090) em um servidor de testes descartável: ela conversa com a personalidade dela, escreve o app, pede permissão antes de iniciar um servidor, abre a prévia e testa no próprio navegador. O último quadro é o app com números já digitados.</sub>
</p>

> **Status:** 1.0. Licença MIT. O [app Android](https://play.google.com/store/apps/details?id=com.backstagecoding.sara) está no Google Play; o app de iPhone e a
> versão da Mac App Store chegam assim que a Apple aprovar. Leia
> [docs/DISCLOSURES.md](docs/DISCLOSURES.md) antes de usar ou compartilhar a Sara.

## Por que a Sara

- **Uma companhia divertida.** Dê a ela o nome que quiser, escolha ela/ele/elu, ajuste a
  personalidade com controles simples (ou comece com uma personagem pronta) e ela se mantém fiel:
  humores, o próprio dia, piadas internas e lembranças do que você contou, que você pode ver,
  corrigir e apagar.
- **Útil para trabalho de verdade.** Arquivos, terminal e git em um espaço de trabalho isolado,
  tarefas em segundo plano, prévias ao vivo que ela testa no próprio navegador, uma equipe de
  ajudantes para trabalhos maiores e uma checagem de que o que ela *diz* que fez bate com o que
  realmente rodou.
- **Sua.** Um dono por servidor; suas conversas, memórias e chaves ficam lá. Use qualquer modelo:
  local (Ollama, vLLM, llama.cpp), na nuvem (OpenAI, Anthropic, xAI, OpenRouter) ou as assinaturas
  que você já paga (plano do ChatGPT, Claude Pro/Max, SuperGrok / X Premium+). Vem **sem nenhuma
  credencial**.
- **Pequena e legível.** TypeScript que o Node roda direto: sem etapa de build, zero dependências
  em tempo de execução, construída do zero (não é baseada no Hermes Agent nem no OpenClaw). Fácil
  de [estender](docs/EXTENDING.md).

## Tour pelos recursos

### Companheira

<img src="docs/screenshots/companion.png" alt="Sara answering a tired user warmly and with humour before starting work" width="760">

Personalidade própria e humores que mudam conforme as coisas vão, o próprio dia e hobbies, memória
do que importa para você e das datas importantes (veja, corrija ou apague qualquer coisa), uma
retrospectiva semanal, mensagens por iniciativa dela se você quiser (com horário de silêncio) e
uma linha do tempo da história de vocês.

### Parceira de programação

<img src="docs/screenshots/coding.png" alt="The tip calculator she built, open in the live preview pane next to the chat" width="760">

Um espaço de trabalho por projeto com arquivos, terminal e git (commit e push com o seu OK); builds
e testes longos em segundo plano, com um aviso quando terminam; uma prévia ao vivo do app que ela
está criando, que ela testa em um navegador headless de verdade e da qual anexa capturas de tela;
um mapa do código para projetos grandes; projetos iniciais testados; uma equipe de ajudantes
(planejar → construir → testar → revisar) que vai de uma issue do GitHub até um pull request
revisado; passagem para o Claude Code ou o Grok Build; ferramentas MCP; desfazer mudanças em
arquivos; um medidor de tokens e custos com orçamentos.

### Agenda e Hoje

<img src="docs/screenshots/planner.png" alt="Sara adding a reminder and two to-dos from one message" width="760">

Tarefas, notas e lembretes a partir de frases comuns, entregues no chat, no seu celular e no
Telegram ou Discord; um resumo pela manhã e uma página Hoje.

### Biblioteca

<img src="docs/screenshots/library.png" alt="Sara answering from a handbook in her library" width="760">

Entregue a ela PDFs (inclusive digitalizados), Word, Excel, PowerPoint, e-books, páginas da web e
notas. Ela aprende os pontos principais, responde com base neles e diz de qual documento (e
página) veio a resposta.

### Voz

<img src="docs/screenshots/voice.png" alt="The voice settings page" width="760">

Chamadas ao vivo que você pode interromper (voz em tempo real do Grok ou da OpenAI), mensagens de
voz no Telegram e no Discord, leitura em voz alta, uma voz que acompanha o humor dela e um retrato
animado que fala. As vozes rodam no seu servidor Linux ou vêm da sua assinatura. (Captura de um
servidor de testes com Windows, onde a voz local ainda não está disponível.)

### Em todo lugar

<img src="docs/screenshots/everywhere.png" alt="Sara on a phone-sized screen answering from her library" width="260">

App web e PWA instalável, apps para Android e iPhone ([android/](android/README.md),
[ios/](ios/README.md)), apps de desktop para Windows e macOS ([docs/desktop.md](docs/desktop.md)),
pontes com Telegram e Discord, `sara-chat` em qualquer terminal e um painel no VS Code
([docs/clients.md](docs/clients.md)), Gmail e Google Agenda com o seu próprio app do Google, Home
Assistant, conversas reservadas que nunca são salvas e outros apps com a memória e a personalidade
dela: uma API compatível com a OpenAI (SillyTavern, Open WebUI, scripts), um servidor MCP (Claude
Code, Cursor, Claude Desktop) e cartões de personagem para importar e exportar
([docs/OTHER_APPS.md](docs/OTHER_APPS.md)).

### Do seu jeito

<img src="docs/screenshots/make-it-yours.png" alt="Name and personality settings with the character gallery" width="760">

Qualquer nome, pronomes, idade e aparência (pintada pelo Grok Imagine, com expressões e animação
combinando), um assistente guiado "crie sua companheira", controles de personalidade, uma galeria
de personagens iniciais, arquivos de personagem para compartilhar, um modelo para cada tarefa e o
app em seis idiomas. Cada configuração tem um **?**, há tours guiados curtos e você pode
simplesmente perguntar a ela como algo funciona.

### Segurança, sempre ligada

<img src="docs/screenshots/safety.png" alt="An approval card: Sara asks before running a command" width="760">

Ações arriscadas esperam o seu OK (no Windows, que não tem isolamento de comandos, todo comando
espera). A camada de segurança roda no código em volta de cada chamada ao modelo e **não pode ser
desligada**: aviso de que é uma IA no início e regularmente depois, uma resposta honesta sempre
que perguntarem a sério se ela é uma IA, recursos de ajuda em crises e um bloqueio total de
conteúdo sexual envolvendo menores ([docs/COMPLIANCE.md](docs/COMPLIANCE.md),
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)). Backups diários (mais cópias criptografadas fora do
servidor), restauração e atualização com um comando e o `sara doctor` mantêm tudo saudável.

## Como tudo se encaixa

<img src="docs/architecture.svg" alt="Architecture: apps and bridges talk to one Sara server; each turn passes the always-on safety layer, gathers memory and library context, calls the chosen model provider and runs tools in a sandboxed workspace; data stays in one folder on your server" width="860">

Mais em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testada, com resultados publicados

Tudo abaixo foi executado de verdade; os scripts estão no repositório, então você pode rodá-los de
novo com os seus próprios modelos. Datas, configuração e arquivos de resultados:
**[docs/RESULTS.md](docs/RESULTS.md)**.

| Teste | Modelo | Resultado | Data |
|---|---|---|---|
| [HumanEval](https://github.com/openai/human-eval), pelo loop de agente dela (164 problemas, testes ocultos) | qwen3.8 27B, local | **158/164** (pass@1 96,3%) | 2026-10-27 |
| HumanEval, o mesmo modelo sem ferramentas (referência) | qwen3.8 27B, local | **161/164** (pass@1 98,2%) | 2026-10-27 |
| Tarefas de repositório: 14 correções, recursos e refatorações originais em vários arquivos (testes ocultos), pelo loop de agente dela | qwen3.8 27B, local | **11/14** (nas duas execuções) | 2026-10-28 |
| Tarefas de repositório, o mesmo modelo com todos os arquivos em uma só mensagem e sem ferramentas (referência) | qwen3.8 27B, local | **12/14** (nas duas execuções) | 2026-10-28 |
| Memória entre sessões (lembrar, não inventar, esquecer) | qwen3.8 27B, local | **11/12** verificações | 2026-10-27 |
| Biblioteca: responde a partir de documentos e diz de onde | qwen3.8 27B, local | **8/8** nas duas execuções | 2026-10-27 |
| Mapa do código: perguntas sobre o próprio código | qwen3.8 27B, local | **8/8** | 2026-10-27 |

A leitura honesta: o loop de agente dela ainda não acrescenta pontos em nenhum dos dois testes de
programação. O modelo sozinho já resolve quase todos os problemas curtos do HumanEval, e as 14
tarefas de repositório são pequenas o bastante (de 5 a 7 arquivos) para caber inteiras em uma
mensagem; as falhas, nos dois modos, foram regras escritas só em um README ou SPEC que nenhum teste
verificava. O que ela acrescenta hoje é o jeito de trabalhar (roda os testes, pede permissão antes
de passos arriscados, mostra o que foi executado), não uma nota maior nesses conjuntos. Detalhes,
resultados por tarefa e como rodar de novo: [docs/RESULTS.md](docs/RESULTS.md).

E também `npm run check`: uma checagem de tipos e 493 testes automáticos com um modelo falso
roteirizado (sem rede, sem GPU): 486 passam no Windows e os outros 7 são testes de isolamento só
para Linux, executados em um servidor Linux.

## Como a Sara se compara

Uma comparação geral com os tipos comuns de alternativas (cada produto é diferente):

| | Sara | Apps de companhia com IA hospedados | CLIs e agentes de programação | Interfaces de chat auto-hospedadas |
|---|:-:|:-:|:-:|:-:|
| Roda no seu próprio computador ou servidor | ✅ | ❌ | ✅ | ✅ |
| Usa qualquer modelo, inclusive locais | ✅ | ❌ geralmente o deles | varia | ✅ |
| Personalidade e memória duradouras que você pode ver e editar | ✅ | ✅ | ❌ | varia |
| Escreve, roda e testa código, pede permissão antes de passos arriscados | ✅ | ❌ | ✅ | varia (plug-ins) |
| Agenda, lembretes, documentos, chamadas de voz | ✅ | alguns | ❌ | alguns |
| Apps de celular, Telegram e Discord | ✅ | apps de celular | ❌ | varia |
| Camada de segurança que nenhuma configuração desliga | ✅ | políticas próprias | n/a | geralmente não |
| Preço | grátis (MIT); você paga seus modelos | assinatura | varia | geralmente grátis |

## Instalação

**Servidor Linux** (Debian/Ubuntu, Fedora/RHEL/Alma/Rocky, Arch, openSUSE), um comando que faz
algumas perguntas simples (aperte Enter para aceitar a sugestão):

```sh
curl -fsSL https://raw.githubusercontent.com/farena-ai/sara/main/deploy/get-sara.sh | sudo bash
# it ends with the address to open and your one-time owner token
sudo sara status
```

**Docker:**

```sh
git clone https://github.com/farena-ai/sara && cd sara
sudo docker compose up -d                       # or: sudo docker compose --profile ollama up -d  (with a local Ollama)
sudo docker compose logs sara | grep -A1 'owner token'   # ou: abra a página dela e digite o código de configuração deste log
```

**Lojas de apps e NAS:** a imagem `ghcr.io/farena-ai/sara`, o TrueNAS e o Proxmox já funcionam;
Unraid, CasaOS/ZimaOS, Umbrel, Homebrew, winget e HACS estão prontos e aguardam revisão
([qual é qual](docs/INSTALL.md#other-ways-to-install)). Um servidor novo é configurado no
navegador com um código curto do log dela (com um clique no Umbrel).

**Windows e macOS:** baixe `Sara-Setup-<version>.exe` ou `Sara-<version>.dmg` na
[página de versões](https://github.com/farena-ai/sara/releases/latest). A primeira pergunta: rodar
a Sara neste computador (o servidor dela e o app de desktop juntos) ou conectar a uma Sara que está
em outro lugar (só o app).

**A partir do código-fonte** (qualquer computador com Node 24 ou mais novo):

```sh
git clone https://github.com/farena-ai/sara && cd sara
npm ci
npm start                                       # http://127.0.0.1:7860; the token is in the output
```

Entre com o token (ou o código de configuração) e um guia de
configuração pergunta o seu nome, ajuda a moldar a sua companheira e conecta um modelo. Como
acessá-la pelo celular (Tailscale, seu próprio endereço web com HTTPS ou a sua rede de casa),
atualizações, backups e solução de problemas: **[docs/INSTALL.md](docs/INSTALL.md)**.

## No dia a dia

```sh
sudo sara status       # is she running, last backup
sudo sara update       # backs up, updates, restarts
sudo sara backup       # back up now
sudo sara restore FILE # restore a backup
sudo sara access       # how you reach her (change: tailscale, local, domain, lan)
```

## Documentação

| | |
|---|---|
| [Instalação](docs/INSTALL.md) | Linux, Docker, Windows, macOS, HTTPS, atualizações, solução de problemas |
| [De que computador eu preciso?](docs/REQUIREMENTS.md) · [Escolhendo um modelo](docs/CHOOSING_A_MODEL.md) · [Quanto custa](docs/COSTS.md) | Antes de começar: hardware, modelos com tamanhos de GPU, custos de uso |
| [Seu celular](docs/PHONE.md) · [Mudando de computador](docs/MOVING.md) | Configuração do celular do início ao fim; backup, instalação, restauração |
| [Checklist de segurança](docs/SECURITY_CHECKLIST.md) · [O que sai do seu servidor](docs/PRIVACY.md) | Cinco minutos depois de instalar; cada conexão de saída e como desligá-la |
| [Perguntas frequentes e glossário](docs/FAQ.md) | Dúvidas comuns e o que as palavras significam |
| [Apps e clientes](docs/clients.md) · [Apps de desktop](docs/desktop.md) · [Home Assistant](docs/HOME_ASSISTANT.md) | Terminal, VS Code, Windows e macOS; a Sara no Home Assistant e o Home Assistant na Sara |
| [Outros apps](docs/OTHER_APPS.md) | API compatível com a OpenAI (SillyTavern, Open WebUI, scripts), MCP (Claude Code, Cursor, Claude Desktop), cartões de personagem |
| [Estendendo a Sara](docs/EXTENDING.md) | Adicionar ferramentas, pontes, personagens, servidores MCP, idiomas, projetos iniciais |
| [Arquitetura](docs/ARCHITECTURE.md) | Como as peças se encaixam, módulo por módulo |
| [Resultados](docs/RESULTS.md) | Benchmarks e avaliações, e como rodá-los de novo |
| [Tradução](docs/TRANSLATING.md) | O app no seu idioma |
| [Conformidade](docs/COMPLIANCE.md) · [Modelo de ameaças](docs/THREAT_MODEL.md) · [Avisos](docs/DISCLOSURES.md) | Proteção, segurança, o que saber primeiro |
| [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md) · [Notas da versão 1.0 (rascunho)](docs/RELEASE_NOTES_1.0_DRAFT.md) | Para onde vai, o que mudou |

Tudo isso também vira um pequeno site com busca e modo escuro: `node scripts/build-docs.ts` gera o
site em `outputs/site/` (abra `index.html`; está pronto para o GitHub Pages).

## Como contribuir

Contribuições são bem-vindas. Comece pelo [CONTRIBUTING.md](CONTRIBUTING.md) e pelas
[issues para iniciantes](docs/GOOD_FIRST_ISSUES.md); siga o
[código de conduta](CODE_OF_CONDUCT.md) e relate problemas de segurança em particular, como
descrito no [SECURITY.md](SECURITY.md).

```sh
npm ci
npm run dev        # http://127.0.0.1:7860, restarts on save
npm run check      # typecheck + all tests
```

## Licença

MIT, veja [LICENSE](LICENSE). Créditos das partes que a Sara baixa ou usa:
[docs/CREDITS.md](docs/CREDITS.md).
