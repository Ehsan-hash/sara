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
  <img src="https://img.shields.io/badge/tests-914%20passing-brightgreen" alt="914 tests passing">
  <a href="docs/RESULTS.md"><img src="https://img.shields.io/badge/HumanEval%20pass%401-96.3%25-informational" alt="HumanEval pass@1 96.3%"></a>
  <a href="https://github.com/farena-ai/sara/releases/latest"><img src="https://img.shields.io/github/v/release/farena-ai/sara?label=release" alt="Latest release"></a>
  <a href="https://github.com/farena-ai/sara/pkgs/container/sara"><img src="https://img.shields.io/badge/docker-amd64%20%7C%20arm64-2496ED" alt="Docker image for amd64 and arm64"></a>
  <img src="https://img.shields.io/badge/languages-6-8A2BE2" alt="Six languages">
  <a href="https://glama.ai/mcp/servers/farena-ai/sara"><img src="https://glama.ai/mcp/servers/farena-ai/sara/badges/score.svg" alt="Sara MCP server on Glama"></a>
</p>

<p align="center">
  <img src="docs/screenshots/demo.png" alt="Animated demo: Sara cheers the user up, builds a tip calculator, asks before starting a server, opens a live preview, tests it in her own browser and shows the screenshot she took" width="860">
  <br>
  <sub>Uma sessão real, sem edição, com um modelo local (qwen3.8 27B no Ollama, uma RTX 5090) em um servidor de testes descartável: ela conversa com a personalidade dela, escreve o app, pede permissão antes de iniciar um servidor, abre a prévia e testa no próprio navegador. O último quadro é o app com números já digitados.</sub>
</p>

> **Status:** 2.7, licença MIT, com dezoito versões com novos recursos desde a 1.0 (todas abaixo). O
> [app Android](https://play.google.com/store/apps/details?id=com.backstagecoding.sara) está no Google
> Play; o app de iPhone e a versão da Mac App Store chegam assim que a Apple aprovar. Leia
> [docs/DISCLOSURES.md](docs/DISCLOSURES.md) antes de usar ou compartilhar a Sara.

## Novidades

| Versão | O que você ganha |
|---|---|
| **2.7** · O novo visual, parte 3 | **Hoje em blocos** (tempo, seu dia, agenda, do que ela se lembrou, momentos, trabalho em segundo plano, casa), uma barra embaixo no celular, todas as telas no novo visual, e nos apps de Windows e Mac **notificações com Permitir / Negar e Feito / Mais tarde**, *Enviar para → Sara* para arquivos e voz na pergunta rápida. [O plano](docs/design/NEW_LOOK.md) |
| **2.6** · O novo visual, parte 2 | **A presença dela:** um painel lateral (no celular, uma folha que se puxa para cima) com o humor dela, o que está fazendo, aprovações, tarefas, o dia e do que ela se lembrou; Ctrl+K para ir a qualquer lugar; e nos apps de Windows e Mac uma **janela de pergunta rápida num atalho** sobre qualquer app, além do humor dela e das aprovações no menu da bandeja. [O plano](docs/design/NEW_LOOK.md) |
| **2.5** · O novo visual, parte 1 | **Escuro por padrão e o trabalho dela na tela:** uma linha embaixo de cada resposta mostra o que ela fez, os resultados chegam como cartões (tempo, tarefas, arquivos alterados, testes, buscas), uma conversa mais leve no celular e no computador, e os apps de Windows e Mac desenham a página até a barra de título. [O plano](docs/design/NEW_LOOK.md) |
| **2.4** · Tudo arrumado | **Tudo mais fácil de achar:** uma barra lateral curta com um menu *Mais* para fixar lugares, Configurações com títulos de verdade que se recolhem, ferramentas e aprovações explicadas em palavras simples, fotos que você pode apagar do álbum de recordações, telas e menus mais arrumados em todos os apps e um salvamento mais seguro por trás. [O que mudou](CHANGELOG.md) |
| **2.3** · Documentos grandes | **Livros e manuais de 500 a 1.000 páginas** (PDFs de até 1 GB) na biblioteca dela: envios que continuam de onde pararam, cada página digitalizada lida, sumário e resumos por capítulo, e respostas que citam a página ("p. 412") com link direto. 30 de 30 perguntas certas num livro de teste de 1.000 páginas. [Como funciona](docs/LIBRARY.md) |
| **2.2** · Seus outros servidores por SSH | **Ela pode trabalhar nas suas outras máquinas**, com senha ou chave. Depois de entrar com senha, **ela cria a própria chave, diz onde ela está e esquece a senha** (guardada só se você insistir, depois de um aviso). As chaves do servidor são verificadas, cada comando segue as regras de aprovação dela e você pode revogar a chave quando quiser. [Como funciona](docs/SSH.md) |
| **2.1** · A voz dela na sua casa | **"Alexa, abrir sara companion"**: fale com ela em qualquer Echo pela sua própria skill gratuita (verificada como a Amazon exige). Faça dela seu **assistente do Android** (toque longo no início), ouça-a em caixas **Google Home / Nest** pelo Home Assistant e deixe que ela **te receba quando você chega em casa**. A Siri no iPhone chega com a próxima atualização do app. [Como funciona](docs/VOICE_ASSISTANTS.md) |
| **2.0** · Modo casa | **Compartilhe seu servidor Sara com quem mora com você.** Convide um adulto com um link de uso único; ele ganha as próprias companheiras, conversas, memória, biblioteca e apps num espaço só dele. Você continua sendo o administrador: escolhe quais modelos ele usa, define limites diários e vê o uso e o custo, nunca o que ele diz. [Como funciona](docs/HOUSEHOLD.md) |
| **1.10** · Nossos momentos | **Um álbum de fotos compartilhado** com as suas fotos e as que ela manda, cada uma com uma legenda que ela escreve com a própria voz a partir da conversa de vocês. Álbuns que se enchem sozinhos (Nós, Lugares, Os looks dela), "Neste dia", e às vezes ela traz um: *lembra disso?* Conversas privadas ficam de fora, a não ser que você as adicione. [Como funciona](docs/MOMENTS.md) |
| **1.9** · Chamadas de vídeo | **Veja ela enquanto vocês conversam:** uma chamada de vídeo mostra o retrato animado dela em tela cheia, com os lábios no ritmo da voz e o rosto acompanhando o humor, com a roupa e o lugar atuais. Ligue sua câmera se quiser e ela olha a cada poucos segundos (ou quando você toca em *Olha isto*); nada é gravado. [Como funciona](docs/VIDEO_CALLS.md) |
| **1.8** · Vários servidores em um app | Tenha **todas as suas Saras em um só app** (casa e trabalho, ou várias em um servidor) e troque por um menu sem sair da conta: os apps de Windows e Mac, Android e iPhone, VS Code, `sara-chat` e a ponte MCP. Cada uma mantém seu próprio login; arquivos, microfone e câmera vão só para a que está em uso. [Como funciona](docs/SERVERS.md) |
| **1.7** · Modo local privado | Um botão, **Nada sai deste computador**, garantido no código em um único ponto: só este computador é acessível, os modelos na nuvem e as ferramentas online ficam pausados, e as conversas, a memória e a biblioteca dela continuam funcionando. Os apps de Windows e Mac encontram o Ollama (ou ajudam a instalar), sugerem um modelo que cabe na sua placa de vídeo e baixam com barra de progresso. [O que ele garante](docs/PRIVATE_LOCAL.md) |
| **1.6** · Chats em grupo | Junte **de duas a quatro das suas companheiras em uma conversa**: cada uma responde com a própria personalidade, voz e cor; escolha quem responde (quem fizer sentido, todas, por turnos ou só quem você mencionar com @) e quanto elas conversam entre si. A segurança, os avisos de IA e a configuração adulta mais rígida valem para a sala inteira. [Como funciona](docs/GROUP_CHATS.md) |
| **1.5** · Traga a Sara de outro app | Venha do **ChatGPT, Claude, Character.AI, SillyTavern, Replika, Nomi ou Kindroid**. Ela lê a exportação no seu próprio servidor, depois mostra o que aprendeu (fatos com as suas palavras, a história de vocês, o estilo dela) e salva só o que você aprovar. [Como exportar de cada app](docs/IMPORT.md) |
| **1.4** · Mais fluidez | Veja cada arquivo que ela escreve **crescer ao vivo no chat** enquanto o modelo transmite (OpenAI, Anthropic, xAI, OpenRouter e planos do ChatGPT; o Ollama manda tudo de uma vez); um retrato falante com sincronia labial em nove formatos de boca; logs em texto puro ou JSON |
| **1.3** · Checagens mais espertas | A checagem "ela fez mesmo o que diz?" agora funciona nos seis idiomas; um modelo local pequeno e opcional como juiz aumenta o que ela pega de 38% para **88%** com 95% de precisão ([medido](docs/RESULTS.md)) |
| **1.2** · Totalmente no seu idioma | O app inteiro, o guia de ajuda e as mensagens do servidor dela em English, Español, Français, Deutsch, Português (Brasil) e Italiano |
| **1.1** · Instale em qualquer lugar | Configure um servidor novo no navegador com um código curto; uma imagem Docker também para **ARM** (Raspberry Pi 4/5); Homebrew, Unraid, TrueNAS, Proxmox e Home Assistant (HACS) |

Todas as versões: [CHANGELOG.md](CHANGELOG.md) · [versões](https://github.com/farena-ai/sara/releases).

### O que vem por aí

Todas as fases planejadas já saíram. A seguir: o app de iPhone (aguardando a revisão da Apple), o que falta em cada recurso e as suas ideias nas [Discussions](https://github.com/farena-ai/sara/discussions).

O plano completo: [docs/ROADMAP.md](docs/ROADMAP.md).

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
Veio de outro app? Traga suas conversas do ChatGPT, Claude, Character.AI, SillyTavern, Replika, Nomi
ou Kindroid e aprove antes o que ela aprende com elas ([docs/IMPORT.md](docs/IMPORT.md)).
Ou junte de duas a quatro das suas companheiras em um chat em grupo ([docs/GROUP_CHATS.md](docs/GROUP_CHATS.md)).
Quer tudo em uma só máquina? Ligue **Nada sai deste computador** ([docs/PRIVATE_LOCAL.md](docs/PRIVATE_LOCAL.md)).

### Parceira de programação

<img src="docs/screenshots/coding.png" alt="The tip calculator she built, open in the live preview pane next to the chat, while she writes its stylesheet: the file grows live in the chat" width="760">

Um espaço de trabalho por projeto com arquivos, terminal e git (commit e push com o seu OK);
cada arquivo que ela escreve aparece ao vivo no chat enquanto o modelo transmite (em modelos na
nuvem; o Ollama manda inteiro); builds
e testes longos em segundo plano, com um aviso quando terminam; uma prévia ao vivo do app que ela
está criando, que ela testa em um navegador headless de verdade e da qual anexa capturas de tela;
um mapa do código para projetos grandes; projetos iniciais testados; uma equipe de ajudantes
(planejar → construir → testar → revisar) que vai de uma issue do GitHub até um pull request
revisado; passagem para o Claude Code ou o Grok Build; ferramentas MCP; desfazer mudanças em
arquivos; um medidor de tokens e custos com orçamentos;
e uma checagem, nos seis idiomas, de que o que ela *diz* que fez bate com o que realmente rodou
(opcionalmente julgada por um modelo local pequeno).

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
voz no Telegram e no Discord, leitura em voz alta, uma voz que acompanha o humor dela e um retrato animado que fala, com sincronia labial em nove formatos de boca. As vozes rodam no seu servidor Linux ou vêm da sua assinatura. (Captura de um
servidor de testes com Windows, onde a voz local ainda não está disponível.)

### Em todo lugar

<img src="docs/screenshots/everywhere.png" alt="Sara on a phone-sized screen answering from her library" width="260">

App web e PWA instalável, apps para Android e iPhone ([android/](android/README.md),
[ios/](ios/README.md)), apps de desktop para Windows e macOS ([docs/desktop.md](docs/desktop.md)),
pontes com Telegram e Discord, `sara-chat` em qualquer terminal e um painel no VS Code
([docs/clients.md](docs/clients.md)), Gmail e Google Agenda com o seu próprio app do Google, Home
Assistant, conversas reservadas que nunca são salvas e outros apps com a memória e a personalidade
dela: uma API compatível com a OpenAI (SillyTavern, Open WebUI, scripts), um servidor MCP (Claude
Code, Cursor, Claude Desktop; [listado no Glama](https://glama.ai/mcp/servers/farena-ai/sara)) e cartões de personagem para importar e exportar
([docs/OTHER_APPS.md](docs/OTHER_APPS.md)).

### Do seu jeito

<img src="docs/screenshots/make-it-yours.png" alt="Name and personality settings with the character gallery" width="760">

Qualquer nome, pronomes, idade e aparência (pintada pelo Grok Imagine, com expressões e animação
combinando), um assistente guiado "crie sua companheira", controles de personalidade, uma galeria
de personagens iniciais, arquivos de personagem para compartilhar, um modelo para cada tarefa e o
app inteiro, o guia de ajuda e as mensagens dela em seis idiomas. Cada configuração tem um **?**, há tours guiados curtos e você pode
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
| Projetos de tamanho real: 3 projetos originais de 22 a 36 arquivos (testes ocultos), pelo loop de agente dela | qwen3.8 27B, local | **2/3**, depois **3/3** | 2026-10-28 |
| Projetos de tamanho real, o mesmo modelo com todos os arquivos em uma só mensagem e sem ferramentas (referência) | qwen3.8 27B, local | **3/3** (nas duas execuções) | 2026-10-28 |
| Checagem do que ela diz ter feito, em 6 idiomas (240 respostas separadas para teste): só padrões → com um juiz local | qwen3.5 9B, local, como juiz | pegou **38% → 88%**, precisão 92% → 95% | 2026-10-28 |
| Memória entre sessões (lembrar, não inventar, esquecer) | qwen3.8 27B, local | **11/12** verificações | 2026-10-27 |
| Biblioteca: responde a partir de documentos e diz de onde | qwen3.8 27B, local | **8/8** nas duas execuções | 2026-10-27 |
| Mapa do código: perguntas sobre o próprio código | qwen3.8 27B, local | **8/8** | 2026-10-27 |

A leitura honesta: o loop de agente dela ainda não acrescenta pontos em nenhum dos dois testes de
programação. O modelo sozinho já resolve quase todos os problemas curtos do HumanEval, e as 14
tarefas de repositório são pequenas o bastante (de 5 a 7 arquivos) para caber inteiras em uma
mensagem (assim como os três projetos de tamanho real, com menos de 1.100 linhas); as falhas, nos dois modos, foram regras escritas só em um README ou SPEC que nenhum teste
verificava. O que ela acrescenta hoje é o jeito de trabalhar (roda os testes, pede permissão antes
de passos arriscados, mostra o que foi executado), não uma nota maior nesses conjuntos. Detalhes,
resultados por tarefa e como rodar de novo: [docs/RESULTS.md](docs/RESULTS.md).

E também `npm run check`: uma checagem de tipos e 922 testes automáticos com um modelo falso
roteirizado (sem rede, sem GPU): 914 passam no Windows e os outros 8 são testes de isolamento só
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
| Traz suas conversas de outros apps de companhia, revisadas antes de salvar | ✅ | ❌ geralmente | ❌ | varia |
| O app inteiro em seis idiomas | ✅ | varia | varia | varia |
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

**Lojas de apps e NAS:** a imagem `ghcr.io/farena-ai/sara` (amd64 e ARM),
`brew install --cask farena-ai/tap/sara`, o TrueNAS, o Proxmox e o HACS (como repositório
personalizado) já funcionam; o Unraid foi aprovado, e winget, CasaOS/ZimaOS, Umbrel e a lista da loja
do HACS aguardam revisão
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
| [Várias Saras em um app](docs/SERVERS.md) · [Modo local privado](docs/PRIVATE_LOCAL.md) · [Modo casa](docs/HOUSEHOLD.md) | Trocar de servidor; manter tudo em um computador; compartilhar um servidor com quem mora com você |
| [Conversas em grupo](docs/GROUP_CHATS.md) · [Chamadas de vídeo](docs/VIDEO_CALLS.md) · [Nossos momentos](docs/MOMENTS.md) · [Documentos grandes](docs/LIBRARY.md) | Várias companheiras numa conversa; chamadas com o retrato animado dela; o álbum compartilhado; livros de 1.000 páginas na biblioteca dela |
| [Assistentes de voz](docs/VOICE_ASSISTANTS.md) · [Alexa](docs/ALEXA.md) · [Servidores por SSH](docs/SSH.md) · [Pacotes](docs/PACKAGING.md) | Alexa, assistente do Android, Google Home, Siri; trabalhar nos seus outros servidores; Homebrew, winget, Unraid e os demais |
| [Estendendo a Sara](docs/EXTENDING.md) | Adicionar ferramentas, pontes, personagens, servidores MCP, idiomas, projetos iniciais |
| [Arquitetura](docs/ARCHITECTURE.md) | Como as peças se encaixam, módulo por módulo |
| [Resultados](docs/RESULTS.md) | Benchmarks e avaliações, e como rodá-los de novo |
| [Tradução](docs/TRANSLATING.md) | O app no seu idioma |
| [Conformidade](docs/COMPLIANCE.md) · [Modelo de ameaças](docs/THREAT_MODEL.md) · [Avisos](docs/DISCLOSURES.md) | Proteção, segurança, o que saber primeiro |
| [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md) · [Versões](https://github.com/farena-ai/sara/releases) | Para onde vai, o que mudou |

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
