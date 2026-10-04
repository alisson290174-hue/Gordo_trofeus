# Relatório completo do Dashboard — Balói Launcher

> Inventário de TODA a interface do app (telas, abas, botões, ícones, opções e onde cada coisa
> fica), para servir de base a um prompt de redesign "do zero". Gerado em 2026-09-29 a partir do
> código-fonte (`src/renderer`). Cada item aponta o arquivo de origem.

---

## 0. Arquitetura visual (macro)

O app é um Electron com **uma janela principal** dividida em 3 zonas fixas + **janelas separadas**.

```
┌───────────────────────────────────────────────────────────────┐
│  BARRA DE TÍTULO (drag) ............... [ – ] [ □ ] [ × ]       │  ← window controls
├───────────────┬───────────────────────────────────────────────┤
│               │  HEADER (voltar • título • +add • scan • busca) │
│   SIDEBAR     ├───────────────────────────────────────────────┤
│  (perfil +    │                                                 │
│  navegação +  │            ÁREA DE CONTEÚDO (rota atual)        │
│  lista de     │        Início / Catálogo / Biblioteca /         │
│  jogos)       │        Downloads / Config / Jogo / Perfil...    │
│               │                                                 │
├───────────────┴───────────────────────────────────────────────┤
│  BOTTOM PANEL (rodapé: status de download / versão / conexão)   │
└───────────────────────────────────────────────────────────────┘
```

- **Janela principal**: `src/renderer/src/app.tsx` monta `Sidebar` + `Header` + conteúdo + `BottomPanel` + `Toast`.
- **Janelas separadas** (abrem fora da principal): Amigos, Big Picture, Login (Auth), Game Launcher. Ver seção 15.
- Sidebar é **redimensionável** (arrastar borda; 200–450px; largura salva em localStorage).

---

## 1. Barra de título / Window controls
Arquivo: `app.tsx` (ícones do `@primer/octicons-react`).
- Botões: **Minimizar** (`DashIcon`), **Maximizar/Restaurar** (`ScreenFullIcon`/`ScreenNormalIcon`), **Fechar** (`XIcon`).
- Área arrastável (drag region). No macOS o layout muda (botões nativos à esquerda).

---

## 2. SIDEBAR (barra lateral esquerda)
Arquivo: `components/sidebar/sidebar.tsx`

### 2.1 Perfil (topo da sidebar) — `sidebar-profile.tsx`
- **Avatar** + **nome de exibição** (ou "Entrar" se deslogado).
- Se um jogo está rodando: mostra **título do jogo** + **ícone do jogo** (disco giratório estilizado p/ jogos PS/clássicos).
- **Chevron** abre um dropdown com:
  - **Ver perfil** (ícone `person`) → `/profile/:id`
  - **Notificações** (ícone `bell`) + badge de contagem (99+) → `/notifications`
  - **Amigos** (ícone `people`) + badge verde de amigos online → abre **janela de Amigos**
  - separador
  - **Sair** (ícone `sign-out`, estilo "danger")
- Deslogado: clicar abre a **janela de login**.

### 2.2 Menu de navegação principal — `sidebar/routes.tsx`
5 itens fixos (ícone + label). **Esta é a navegação central do app:**
| Rota | Label | Ícone |
|------|-------|-------|
| `/` | Início (home) | `home` |
| `/catalogue` | Catálogo | `apps` |
| `/library` | Biblioteca | `book` |
| `/downloads` | Downloads | `downloads` |
| `/settings` | Configurações | `settings` |
- (Só Linux/Steam Deck) item extra **Instalar/Atualizar plugin Decky** com ícone próprio.

### 2.3 Busca + filtros da biblioteca (dentro da sidebar)
- **Campo de filtro** (texto) — filtra a lista de jogos por título.
- **Botão "somente jogáveis/instalados"** — toggle (ícones `check-circle` / `check-circle-fill`).
- **Menu de filtros** (ícone `sliders`) — `sidebar-filter-menu.tsx`, dropdown com:
  - **Plataformas (categoria):** Todos (`stack`), PC (`device-desktop`), Steam (ícone Steam), Clássicos (ícone controle retrô com gradiente).
  - **Ordenar por:** Favoritos primeiro (checkbox, `heart`), Título A-Z (`sort-desc`), Jogados recentemente (`hourglass`), Mais jogados (`hourglass`), Conquistas (`trophy`).
  - **Consoles** (só na categoria Clássicos): "Todos os consoles" + lista dinâmica de plataformas (PS2, etc.).

### 2.4 Lista de jogos (virtualizada) — `sidebar-game-item.tsx`
- Cada item: ícone/capa do jogo + título. Estados: **baixando (%)**, **na fila**, **pausado**, **favorito**.
- Clique navega para os detalhes do jogo.

---

## 3. HEADER (topo da área de conteúdo)
Arquivo: `components/header/header.tsx`
- **Botão voltar** (`arrow-left`) — habilita quando há histórico.
- **Título da página** (dinâmico conforme a rota / nome do jogo / perfil).
- **Ações (à direita), só na Biblioteca:**
  - **Adicionar jogo customizado** (`plus`) → modal.
  - **Escanear jogos instalados** (`sync`) → modal de scan (só Windows/Linux).
- **Busca global** (`search`): campo com dropdown de sugestões + histórico. Alterna entre buscar na **Biblioteca** (se estiver nela) ou no **Catálogo**. Tem **switch de loja** (Steam etc.) nas sugestões. Botão limpar (`x`).
- **Sub-header de auto-update** (`auto-update-sub-header.tsx`): faixa que avisa "atualização disponível / baixando / reiniciar".

---

## 4. Página INÍCIO (Home)
Arquivo: `pages/home/home.tsx`
- **Hero** (destaque grande no topo — jogo em evidência).
- **Botões de categoria** (abas):
  - **Populares/Hot** (ícone de chama animada 🔥 — `flame-animated.gif`)
  - **Semanais/Weekly**
  - **Conquistas/Achievements**
- **Botão "Surpreenda-me"** (randomizer, ícone de estrelas animadas ✨) → abre um jogo aleatório.
- **Título da seção atual** + **grade de 12 GameCards** (com skeleton de carregamento).

---

## 5. Página CATÁLOGO
Arquivo: `pages/catalogue/catalogue.tsx`
- **Toggle de modo** (`catalogue-mode-toggle.tsx`): **PC** ⇄ **Clássicos**.
- **Painel de filtros** (`filter-section.tsx` + `filter-item.tsx`):
  - **PC:** Gêneros, Tags, Fontes de download, Desenvolvedores, Distribuidoras.
  - **Clássicos:** Plataformas, Gêneros, Desenvolvedores, Distribuidoras, Fontes de download.
  - **Compatibilidade Proton** (`proton-compatibility-section.tsx`, p/ Linux).
  - **Ano de lançamento** (`release-year-section.tsx`).
- **Grade de resultados** (`game-item.tsx` / `game-item-classics.tsx`) + **Paginação** (`pagination.tsx`).

---

## 6. Página BIBLIOTECA
Arquivos: `pages/library/*`, cards em `components/`/`library-game-card-large.tsx`
- Filtro de **categoria** (`category-filter.tsx`): Todos (`stack`), PC (`device-desktop`), Steam, Clássicos (controle retrô gradiente).
- **Filtro de plataforma** (`platform-filter.tsx`) e **filtro instalado** (`installed-filter.tsx`).
- **Opções de ordenação** (`filter-options.tsx`): Título, Jogados recentemente, Mais jogados, Conquistas.
- **Cards de jogo** (grande): capa + título + **badges**: "Pronto"/tamanho, badge de plataforma (PC/Steam/Clássico), **progresso de conquistas**, selo de suporte a conquistas (working/supported/etc.), **destaque de platina**.
- Ações do header: adicionar jogo, escanear (ver seção 3).

---

## 7. Página DOWNLOADS
Arquivo: `pages/downloads/downloads.tsx`
- **3 grupos**: **Em andamento**, **Na fila**, **Concluídos** (`download-group.tsx`).
- Cada item: barra de progresso, velocidade, seeds/peers, botões (pausar/retomar/cancelar, abrir instalador, abrir pasta, excluir).
- **Estado vazio**: ilustração + "Sem downloads".
- Modais: excluir jogo, binário não encontrado, erro ao deletar arquivo.

---

## 8. Página CONFIGURAÇÕES
Arquivo: `pages/settings/settings.tsx` — **sidebar interna com 10 abas** (ícone + label):

| # | Aba | Ícone | Conteúdo |
|---|-----|-------|----------|
| 1 | **Geral** | `settings` | Pasta de downloads, Idioma; Comportamento de inicialização: sair em vez de esconder, esconder na bandeja ao abrir jogo, iniciar com o sistema, iniciar minimizado, abrir direto na Biblioteca; (Linux) auto-install |
| 2 | **Downloads** | `download` | Velocidade máxima, interface de rede, semear após concluir, extrair por padrão, mostrar velocidade em MB, apagar .zip após extrair, criar atalhos ao baixar, **trackers globais** |
| 3 | **Fontes de download** | `link` | Gerenciar fontes/repositórios de download |
| 4 | **Notificações** | `bell` | De biblioteca: download concluído, lista de repacks, pedido de amizade, amigo iniciou jogo; De conquistas: ativar notificações, notificações customizadas + posição na tela |
| 5 | **Conteúdo e Jogabilidade** | `play` | Autoplay de trailers, desativar alerta NSFW, mostrar descrição de conquista oculta, badges de novas opções de download, persistir filtros/ordenação; **Metadados**: souvenirs de conquista, pasta de screenshots; **Aparência da biblioteca**: esconder badges (tamanho, clássicos, steam), esconder progresso de conquista, autoplay de artwork animado; **Aparência clássicos**: esconder marcador, usar layout hero |
| 6 | **Integrações** | `cloud` | Serviços debrid (Real-Debrid, etc.), **Steam** (`settings-steam.tsx`), **RetroAchievements** (`settings-retroachievements.tsx`) |
| 7 | **Compatibilidade** | `Wrench` (lucide) | Prefixo Wine padrão, opções de compat, redistribuíveis comuns (só Win/Linux) |
| 8 | **Conta e Privacidade** | `shield-check` | (só logado) Dados da conta, privacidade |
| 9 | **Big Picture** | `video` | Iniciar em Big Picture, abrir na biblioteca, sons, teclado virtual, diagnóstico + posição |
| 10 | **Emulação** (grupo "Clássicos") | `Gamepad2` (lucide) | RetroArch, cores/consoles, scan de ROMs, setup de emuladores |

---

## 9. Página DETALHES DO JOGO
Arquivos: `pages/game-details/*` (conteúdo em `game-details-content.tsx`)
- **Hero** (arte de fundo + logo do jogo + `CloudSaveWidget` + botão editar arte `pencil`).
- **Barra de ações** (`hero/hero-panel-actions.tsx`):
  - Botão principal dinâmico: **Jogar** (`play`) / **Baixar** (`download`) / **Fechar** (`XCircle`) / **Adicionar à biblioteca** (`plus-circle`) / "Transferindo %".
  - **Favoritar** (`heart`/`heart-fill`).
  - **Fixar** (`pin`/`pin-slash`).
  - **Opções** (`settings`) → abre Modal de Opções (seção 10).
- **DescriptionHeader** (abas de descrição), **GallerySlider** (screenshots/vídeos + lightbox), **Similar Games**, **Game Reviews** (avaliações + responder).
- **Sidebar do jogo** (`game-details/sidebar/sidebar.tsx`):
  - **ProtonDB** (Linux) • **Conquistas** (barra de progresso + lista + taças PSN) • **Banner conectar RetroAchievements** • **Stats** (tempo jogado, jogadores) • **Detalhes Launchbox** (clássicos) • **HowLongToBeat** • **Suporte a controle** • **Requisitos de sistema** • **Idioma do jogo**.

---

## 10. Modal OPÇÕES DO JOGO
Arquivo: `game-details/modals/game-options-modal.tsx` — **sidebar interna com 8 categorias:**
| Categoria | Ícone |
|-----------|-------|
| Geral | `settings` |
| Locais (arquivos/pastas) | `file-directory` |
| Personalização (arte/capa) | `image` |
| Hydra Cloud (cloud save) | `cloud` |
| Hydra Cloud Legacy | `cloud`+`history` |
| Compatibilidade | (Wine) |
| Downloads | `download` |
| Zona de Perigo (excluir etc.) | `alert` |

---

## 11. Página CONQUISTAS DO JOGO
Arquivos: `pages/achievements/achievements.tsx` + `achievement-list.tsx` + `components/trophy-cup/`
- Lista de conquistas com **taças PSN** (bronze/prata/ouro/platina — SVG customizado), **barra de raridade**, ícone desbloqueado/bloqueado, data de desbloqueio.
- **Modo comparação** (com amigo): mostra 2 colunas (você × amigo).
- Conquistas online são filtradas (exclusão para platina offline).

---

## 12. Página PERFIL
Arquivos: `pages/profile/*` (`profile-content.tsx`, `profile-tabs.tsx`)
- **Cabeçalho**: avatar (editável, com crop modal), nome, editar perfil.
- **3 abas**: **Biblioteca** • **Avaliações** (badge de contagem) • **Souvenirs** (badge de contagem).
- Cards de jogo do perfil com **destaque de platina** (`user-library-game-card.tsx`).
- Sub-abas/relatórios: reviews, souvenirs (lightbox), wrapped ("retrospectiva").

---

## 13. Página NOTIFICAÇÕES
Arquivo: `pages/notifications/notifications.tsx`
- Lista de notificações (pedidos de amizade, downloads, conquistas, amigo jogando).

---

## 14. Menu de contexto do JOGO (botão direito)
Arquivo: `components/game-context-menu/game-context-menu.tsx`
- **Jogar/Play**
- **Favoritos** (`heart`)
- **Coleção** (`file-directory`) → adicionar a coleção / criar coleção (`plus`)
- **Atalhos** (`link`) → atalho na área de trabalho / atalho na Steam
- **Gerar conquistas (Goldberg)** (`trophy`) ← recurso novo (só jogos Steam com executável)
- **Opções** (`settings`) → Fixar, Personalizar (`image`), Abrir pasta (`file-directory`), Opções de download (`download`), Local de download, Remover da biblioteca (`x`) / Remover arquivos (`trash`)
- **Propriedades** (`pencil`)

---

## 15. Janelas SEPARADAS (fora da janela principal)
- **Amigos** — `openFriendsWindow()`: lista de amigos, online/offline, pedidos, comparar conquistas.
- **Big Picture** — `openBigPictureWindow()`: modo TV/controle (`pages/settings/settings-context-big-picture` configura; janela própria).
- **Login / Auth** — `openAuthWindow(AuthPage)`: `pages/auth-window/auth-window.tsx`.
- **Game Launcher** — `pages/game-launcher/game-launcher.tsx`: overlay/janela ao abrir um jogo.

---

## 16. ⚠️ SISTEMA DE ÍCONES (ler antes de desenhar!)

**Hoje o app usa 3 fontes de ícones misturadas — unificar no redesign:**
1. **`Icon` customizado** (`components/icon/icon.tsx`): renderiza PNGs de `assets/icons/system/*.png` como **máscara CSS** (herdam a cor via `currentColor`). É o sistema principal (`<Icon name="..." />`).
2. **`@primer/octicons-react`**: usado só nos controles de janela e em `library-tab.tsx`.
3. **`lucide-react`**: usado avulso (`Gamepad2`, `Wrench`, `XCircle`).

**Achado importante:** a pasta `assets/icons/system/` tem só **36 PNGs**:
`arrow-down, arrow-left, arrow-up, book, caret-down, check, chevron-(down/left/right/up), clock, copy, dash, dot, download, file-directory(-fill), file, home, image, kebab-horizontal, minus, monitor, more-vertical, play, plus, reply, report, screen-full, screen-normal, sign-in, sign-out, sort-desc, square, upload, x` (+ `ellipses`).

Porém o código referencia **~70 nomes** via `<Icon name="...">`. Faltam PNG (renderizam vazio) para, entre outros:
`settings, trophy, apps, downloads, cloud, bell, people, person, person-add, heart(-fill), pin, pin-slash, sync, sliders, stack, device-desktop, plus-circle, x-circle, check-circle(-fill), star(-fill), shield-check, alert, link, link-external, gift, globe, history, hourglass, video, package, trash, pencil, eye(-closed), lock, key, mail, code, cpu, database, graph, thumbs-up, tools, unlink, unmute, comment-discussion, ...`

👉 **Para o redesign:** definir **um único conjunto de ícones** (ex.: só Lucide, ou só um pack PNG completo) cobrindo TODOS os ~70 nomes desta lista. É a maior fonte de inconsistência visual atual.

---

## 17. Componentes reutilizáveis (biblioteca de UI)
Pasta `components/`: `Button`, `TextField`, `SelectField`, `CheckboxField`, `Modal`/`ConfirmationModal`, `Avatar`, `Img` (com fallback), `GameCard`, `Hero`, `Badge`, `Toast`, `SearchDropdown`, `BottomPanel`, `trophy-cup` (taças PSN SVG), `achievement-support-badge`, `steam-library-badge`.
- **Estilo atual:** SCSS modular por componente, tema escuro. Skeletons de carregamento (`react-loading-skeleton`, base `#1c1c1c`).

---

## 18. Resumo de navegação (mapa de rotas)
```
/                      Início (Home)
/catalogue             Catálogo
/library               Biblioteca
/downloads             Downloads
/settings              Configurações (10 abas)
/game/:shop/:objectId  Detalhes do jogo
/achievements          Conquistas do jogo (?objectId&shop&title&userId)
/profile/:id           Perfil (3 abas)
/notifications         Notificações
+ janelas separadas: Amigos, Big Picture, Login, Game Launcher
```

---

### Dica para o prompt de redesign
Ao escrever seu prompt, peça para manter TODA a hierarquia acima (mesmas rotas, mesmas abas,
mesmos botões/opções) e só mudar o visual. Liste as 5 rotas da sidebar + as 10 abas de config +
as 8 categorias do modal de opções + o conjunto único de ~70 ícones. Assim o novo dashboard não
perde nenhuma função existente.
