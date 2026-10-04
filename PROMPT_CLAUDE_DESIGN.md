# PROMPT — CLAUDE (Design / Artifact navegável)

> COMO USAR: cole TODO o texto abaixo (a partir de "PAPEL") no Claude. Rode 5 vezes, trocando só
> a linha `TEMA DESTE CONCEITO` por um dos temas abaixo. Assim cada conceito sai completo.
>
> TEMAS FINAIS (um por rodada) — cole a descrição INTEIRA no campo "TEMA DESTE CONCEITO":
>
> 1) ESTILO PLAYSTATION 5 — minimalista escuro e cinematográfico, fundo azul-marinho quase preto com
>    gradiente suave, superfícies em vidro/blur, acento azul PlayStation (#0070f3), navegação horizontal
>    no topo com ícones grandes, hero em tela cheia ao focar um jogo, Central de Controle na barra
>    inferior, tipografia sans fina (tipo SST/SF Pro), transições suaves com blur; tela de troféus
>    idêntica ao padrão PSN: taças bronze/prata/ouro/platina, raridade e porcentagem, platina em destaque.
>
> 2) ESTILO XBOX SERIES — layout em blocos/tiles (bento), fundo preto/cinza muito escuro, acento verde
>    Xbox vibrante (#107c10), tile grande de jogo em destaque + fileira de recentes + blocos de atalho,
>    tipografia sans forte em bold (tipo Segoe), tiles que acendem com glow verde no foco; tela de
>    conquistas no estilo Xbox (pontuação/raridade, total em destaque) mantendo as taças bronze/prata/
>    ouro/platina do produto, no layout de blocos verde.
>
> 3) COFRE DE TROFÉUS — galeria de luxo estilo museu, preto profundo + dourado/âmbar, vitrines de vidro
>    e iluminação de spot, tipografia serifada display + sans limpa, navegação tipo galeria; troféus como
>    peças de exposição, platina sob holofote.
>
> 4) CYBERDECK HOLOGRÁFICO — HUD futurista cyberpunk, glassmorphism translúcido, neon ciano/magenta sobre
>    azul quase preto, scanlines e glow, dock flutuante/radial, tipografia técnica mono; troféus como
>    medalhas holográficas flutuantes.
>
> 5) SYNTHWAVE ARCADE — estética retrô anos 80, grid em perspectiva + sol retrô no horizonte, laranja/
>    rosa/roxo neon, brilho CRT sutil, navegação tipo menu de fliperama, tipografia condensada retrô;
>    troféus como medalhas/fichas de arcade que brilham ao desbloquear.

---

PAPEL
Você é um diretor de arte + designer de produto sênior especializado em apps "gamer premium" para
desktop. Entregue trabalho de portfólio: ousado, coeso e original.

PRODUTO
Balói Launcher — um launcher de jogos para desktop Windows (Electron). A pessoa organiza a biblioteca,
baixa, joga e acompanha conquistas/troféus estilo PlayStation (bronze/prata/ouro/platina). As
conquistas/troféus são o CORAÇÃO do produto: devem ser o elemento mais bonito e valorizado da interface.

TEMA DESTE CONCEITO: {cole aqui a descrição INTEIRA de UM dos 5 temas do topo}

MISSÃO
Crie UM conceito de dashboard com o tema acima, COMPLETAMENTE diferente de um "launcher dark padrão".
Reinvente a navegação, a hierarquia e a linguagem visual. Identidade forte e memorável.

NÃO REPITA O APP ATUAL (fuja disso): sidebar fixa à esquerda + header simples no topo + grade de
cards de capa num fundo cinza-escuro liso, ícones inconsistentes. É genérico. Faça algo diferente.

ENTREGA (formato)
Entregue como UM ÚNICO ARTIFACT HTML navegável (HTML + CSS + JS inline; pode usar Tailwind via CDN).
- Um menu/navegação que alterna entre as 4 telas-chave SEM recarregar: Início, Biblioteca,
  Detalhes do jogo, Conquistas.
- Modo escuro. Responsivo (de janela estreita a ampla). Foco visível e bom contraste.
- Use dados/jogos/artes FICTÍCIOS (não use marcas reais: PlayStation, Steam, Xbox, Epic).
- Ícones: crie um conjunto único e coeso em SVG inline (mesmo estilo/peso) cobrindo as funções.
- No topo do artifact, um pequeno painel "Design tokens" com a paleta (hex), tipografia e os
  estados de troféu (bronze/prata/ouro/platina).

TELAS E O QUE CADA UMA PRECISA MOSTRAR

1) INÍCIO
- Barra de perfil (avatar + nome; atalhos p/ Notificações c/ contador, Amigos c/ online, Sair).
- Área de destaque (hero) de um jogo.
- Categorias: "Em alta", "Semanais", "Conquistas" + botão "Surpreenda-me" (jogo aleatório).
- Grade de jogos recomendados.

2) BIBLIOTECA
- Filtros: categoria (Todos, PC, Steam, Clássicos/retrô), plataforma, "somente instalados".
- Ordenação: Título, Recentes, Mais jogados, Conquistas.
- Cards com badges: instalado/tamanho, plataforma, PROGRESSO DE CONQUISTAS e DESTAQUE DE PLATINA
  (marcar visualmente jogos 100% platinados).
- Ações no topo: adicionar jogo, escanear jogos instalados.

3) DETALHES DO JOGO
- Arte de fundo (hero) + logo do jogo.
- Botões: Jogar, Baixar, Favoritar, Fixar, Opções.
- Abas de descrição; galeria (screenshots/vídeos); avaliações; jogos similares.
- Painel lateral: CONQUISTAS (barra de progresso + prévia da lista com troféus), Stats (tempo
  jogado/jogadores), HowLongToBeat, Suporte a controle, Requisitos, Idioma.

4) CONQUISTAS/TROFÉUS  ← a tela MAIS caprichada (é o foco do produto)
- Lista de conquistas com TAÇAS estilo PSN (bronze/prata/ouro/platina), raridade (%), ícone
  desbloqueado/bloqueado, data de desbloqueio.
- Um modo de COMPARAÇÃO com amigo (você × amigo, lado a lado).
- Resumo no topo: total desbloqueado, progresso, e a PLATINA em destaque.

FUNÇÕES QUE O DESIGN PRECISA ACOMODAR (mostre onde ficariam, mesmo que só como ícone/entrada de menu)
- Navegação principal: Início, Catálogo, Biblioteca, Downloads, Configurações.
- Catálogo: alternância PC ⇄ Clássicos + filtros (gênero, tags, dev, publisher, ano).
- Downloads: grupos Em andamento / Na fila / Concluídos com progresso e controles.
- Menu de contexto do jogo (botão direito): Jogar, Favoritos, Coleções, Atalhos, Gerar conquistas,
  Opções, Propriedades.
- Configurações (10 seções): Geral, Downloads, Fontes de download, Notificações, Conteúdo e
  Jogabilidade, Integrações, Compatibilidade, Conta e Privacidade, Big Picture, Emulação.
- Barra de título (minimizar/maximizar/fechar) e busca global com sugestões.

QUALIDADE
Coerência total entre as telas. Movimento sutil e elegante. Nada de "dark genérico". Capriche na
tela de Conquistas — ela precisa impressionar.
