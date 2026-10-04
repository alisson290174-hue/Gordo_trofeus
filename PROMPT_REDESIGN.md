# Prompt pronto — Redesign do Dashboard (vários conceitos)

> Copie o bloco abaixo (entre as linhas `====`) e cole numa IA de design/geração de UI
> (v0, Lovable, Claude, Figma AI, etc.). Ele pede VÁRIOS conceitos bem diferentes do app atual,
> mantendo todas as funções. Ajuste o número de conceitos e a ferramenta se quiser.

====================================================================

# PAPEL
Você é um **diretor de arte + designer de produto sênior** especializado em aplicativos "gamer premium"
para desktop (estilo PlayStation, Steam, Xbox, Epic). Entregue trabalho de portfólio: ousado,
coeso e original.

# PRODUTO
**Balói Launcher** — um launcher de jogos para **desktop Windows (Electron)**. É um app onde a
pessoa organiza a biblioteca de jogos, baixa, joga e — o mais importante — **acompanha conquistas e
troféus estilo PlayStation (bronze/prata/ouro/platina)**. As conquistas/troféus são o **coração do
produto**: precisam ser o elemento mais bonito e valorizado de toda a interface.

# MISSÃO
Crie **5 conceitos de dashboard COMPLETAMENTE DIFERENTES entre si e MUITO diferentes do app atual**.
Cada conceito deve ter identidade visual própria e forte (não podem parecer variações do mesmo tema).
Quero comparar direções distintas e escolher a que mais gosto.

# O QUE JÁ EXISTE HOJE (NÃO REPETIR — quero fugir disso)
O app atual é um layout genérico "dark padrão": **sidebar fixa à esquerda** (perfil no topo + 5 links
+ lista de jogos), **header simples no topo** (voltar + título + busca) e **grade de cards de capa**
num fundo cinza-escuro liso. Ícones inconsistentes. É funcional, mas comum e sem personalidade.
**Não entregue nada parecido com isso.** Reinvente a navegação, a hierarquia e a linguagem visual.

# EIXOS DE VARIAÇÃO (use para garantir que os 5 conceitos sejam bem diferentes)
Faça cada conceito variar fortemente em pelo menos 3 destes eixos:
- **Navegação:** sidebar vertical / barra inferior / topo horizontal / dock flutuante / radial / sem chrome (imersivo).
- **Layout:** grade de capas / lista densa / mosaico bento / carrosséis / hero cinematográfico em tela cheia / dashboard com widgets.
- **Densidade:** minimalista com muito respiro / denso "power user" / híbrido.
- **Cor:** dark premium com neon / dark sóbrio elegante / claro/light gamer / vidro (glassmorphism) / brutalista de alto contraste / colorido vibrante.
- **Tipografia:** display grande e expressiva / técnica/mono / editorial serifada / condensada esportiva.
- **Motion/profundidade:** flat 2D / camadas com parallax / 3D sutil / efeitos de foco cinematográfico.

Sugestões de temas (misture/crie os seus, um por conceito):
1. **"Troféus em destaque"** — a vitrine de conquistas/platina é o centro do app (estante de troféus 3D).
2. **"Console de TV / Big Picture"** — imersivo, tela cheia, navegável por controle.
3. **"Editorial / revista de games"** — tipografia forte, hero cinematográfico, curadoria.
4. **"Bento minimalista"** — cartões modulares, muito respiro, elegante.
5. **"Neon arcade / cyber"** — vibrante, energético, com brilho e movimento.

# REQUISITOS FUNCIONAIS OBRIGATÓRIOS (manter TUDO — só mude o visual e a organização)
O novo dashboard precisa acomodar **todas** estas áreas e funções:

**Navegação principal (5 destinos):** Início, Catálogo, Biblioteca, Downloads, Configurações.

**Perfil do usuário:** avatar + nome; acesso a Ver perfil, Notificações (com contador), Amigos
(com contador de online), Sair. Estado deslogado → "Entrar".

**Início:** área de destaque (hero), categorias "Populares/Em alta", "Semanais", "Conquistas", botão
"Surpreenda-me" (jogo aleatório) e grade de jogos recomendados.

**Catálogo:** alternância PC ⇄ Clássicos (retrô/emulação); filtros por Gêneros, Tags, Desenvolvedores,
Distribuidoras, Fontes de download, Ano de lançamento; grade paginada.

**Biblioteca:** filtros por categoria (Todos, PC, Steam, Clássicos), plataforma e "somente instalados";
ordenação (Título, Recentes, Mais jogados, Conquistas). Cards com badges: instalado/tamanho,
plataforma, **progresso de conquistas** e **destaque de platina** (jogos 100% platinados). Ações:
adicionar jogo, escanear jogos instalados.

**Downloads:** 3 grupos — Em andamento, Na fila, Concluídos — com progresso, velocidade, seeds e
controles (pausar/retomar/cancelar/abrir pasta/excluir). Estado vazio ilustrado.

**Detalhes do jogo:** arte de fundo (hero) + logo; botões Jogar / Baixar / Fechar / Adicionar à
biblioteca, Favoritar, Fixar, Opções; abas de descrição; galeria (screenshots/vídeos); avaliações;
jogos similares; painel lateral com: **Conquistas (barra de progresso + lista com troféus)**,
RetroAchievements, Stats (tempo jogado/jogadores), HowLongToBeat, Suporte a controle, Requisitos,
Idioma, ProtonDB.

**⭐ Conquistas/Troféus (foco do produto):** tela dedicada com lista de conquistas mostrando
**taças estilo PSN (bronze/prata/ouro/platina)**, raridade, ícone desbloqueado/bloqueado, data e
**modo de comparação com amigo** (você × amigo, lado a lado). Deve ser a tela mais impressionante.

**Perfil:** cabeçalho editável + 3 abas: Biblioteca, Avaliações, Souvenirs; destaque para jogos
platinados; retrospectiva ("wrapped").

**Menu de contexto do jogo (botão direito):** Jogar, Favoritos, Coleções, Atalhos (desktop/Steam),
Gerar conquistas, Opções (fixar, personalizar arte, abrir pasta, opções de download, remover), Propriedades.

**Modal de opções do jogo (8 seções):** Geral, Locais/arquivos, Personalização de arte, Cloud Save,
Cloud Save Legacy, Compatibilidade, Downloads, Zona de Perigo.

**Configurações (10 seções):** Geral, Downloads, Fontes de download, Notificações, Conteúdo e
Jogabilidade, Integrações (Steam/RetroAchievements/debrid), Compatibilidade, Conta e Privacidade,
Big Picture, Emulação (RetroArch/consoles).

**Extras:** busca global com sugestões e histórico; barra de título com minimizar/maximizar/fechar;
faixa de auto-atualização; notificações; janelas de Amigos, Big Picture, Login e "jogo iniciando".

# SISTEMA DE ÍCONES (importante)
Proponha **um único conjunto de ícones coeso** (mesmo estilo, peso e grade) cobrindo TODAS as funções
acima — cerca de 70 ícones, incluindo: início, catálogo/apps, biblioteca/livro, downloads, config,
troféu, nuvem, sino, pessoas/amigos, coração, fixar, sincronizar, filtros, monitor/PC, Steam,
controle retrô, play, estrela, escudo, alerta, link, presente, globo, histórico, ampulheta, vídeo,
lixeira, lápis, cadeado, chave, e-mail, etc. Mostre a folha de ícones do conceito.

# REQUISITOS TÉCNICOS E DE QUALIDADE
- Desktop primeiro (janela redimensionável), mas responsivo (funciona de janela estreita a ampla).
- **Modo escuro obrigatório**; ofereça também variação clara quando fizer sentido.
- Acessível: bom contraste, foco visível, alvos clicáveis confortáveis.
- Defina tokens: paleta (base, superfícies, texto, acento, estados de troféu bronze/prata/ouro/platina),
  tipografia (fontes + escala), espaçamento, raios, sombras/brilhos, e um princípio de movimento.
- Coerência total entre todas as telas do mesmo conceito.

# O QUE ENTREGAR (para CADA um dos 5 conceitos)
1. **Nome + conceito** (1 parágrafo: personalidade e por que é diferente).
2. **Moodboard/direção**: paleta (hex), tipografia, texturas/efeitos, princípio de layout e de motion.
3. **Folha de ícones** no estilo do conceito.
4. **Mockups em alta fidelidade** das 4 telas-chave, no mínimo:
   - Início (dashboard)
   - Biblioteca (com badges de conquista/platina)
   - Detalhes do jogo (hero + painel de conquistas)
   - **Tela de Conquistas/Troféus** (a mais caprichada, com taças PSN)
   - (Bônus) Configurações e Perfil.
5. **Notas de layout**: como a navegação e a hierarquia funcionam.

Apresente os 5 conceitos lado a lado / em sequência clara, para comparação. Seja ousado — quero ver
direções realmente distintas e memoráveis, nada de "dark padrão genérico".

# RESTRIÇÕES
- Não copie marcas registradas (não use logos/nomes de PlayStation, Steam, Xbox, Epic). Pode se
  INSPIRAR na linguagem "gamer premium", mas crie identidade própria do Balói.
- Nada de conteúdo enganoso; use jogos/artes fictícios ou genéricos nos mockups.

====================================================================
