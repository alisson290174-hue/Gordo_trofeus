/**
 * What each update changed, in the user's words. Add an entry for every release: the newest one is
 * shown once after the app updates to it.
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.40",
    date: "04/10/2026",
    items: [
      "RetroAchievements em todos os emuladores de uma vez: Configurações → Emulação → \"RetroAchievements nos emuladores\" (a senha não é guardada).",
      "Big Picture: o direcional para a esquerda e para cima voltou a funcionar na aba Início.",
      "Fechar um jogo não abre mais o Big Picture sozinho.",
      "Select + Start também fecha jogos de PC que abrem por um launcher.",
      "Busca de traduções mais certeira (não confunde mais jogo 1 com jogo 2).",
      "Capas maiores na tela Início e capas de PS2/PS3 recortadas no padrão.",
      "Big Picture: Configurações, Catálogo e Downloads não ficam mais escondidos atrás da barra de cima.",
    ],
  },
  {
    version: "1.0.39",
    date: "03/10/2026",
    items: [
      "Select + Start agora fecha o jogo de verdade (o atalho não iniciava em alguns PCs).",
      "Controle no app normal: o direcional não ficava preso numa janela escondida — agora navega por todas as telas.",
      "Big Picture: o botão Start abre o menu rápido.",
      "Jogos de PS4 aparecem como \"PS4\" (não mais como PS1) e não tentam buscar conquistas de PS1.",
      "Jogos da Steam sem capa ganham uma capa automaticamente.",
    ],
  },
  {
    version: "1.0.38",
    date: "03/10/2026",
    items: [
      "Big Picture: página do jogo nova — arte em tela cheia, console, estúdio e ano, botões grandes para o controle e cartões de tempo de jogo, troféus e tradução.",
      "Big Picture: selos coloridos dos consoles (PS2, Switch, PS4…) em todas as telas.",
    ],
  },
  {
    version: "1.0.37",
    date: "03/10/2026",
    items: [
      "PlayStation 4 no Opus: o shadPS4 é instalado e atualizado sozinho, e os jogos extraídos (pasta com eboot.bin e sce_sys) aparecem com nome, ícone e fundo do próprio jogo.",
      "Conquistas repaginada no padrão da Biblioteca: filtros (Platinados, Em andamento, Não iniciados), busca e selo do console em cada jogo.",
    ],
  },
  {
    version: "1.0.36",
    date: "03/10/2026",
    items: [
      "Select + Start no controle fecha o jogo e volta para o Opus (vale também no Big Picture).",
      "Controle funcionando no app normal: direcional/analógico move, A abre, B volta, LB/RB trocam de aba, Start abre o Big Picture.",
      "PS1 e PS2: controle ligado pelo XInput — não perde mais o mapeamento quando outro dispositivo é conectado.",
      "Botão direito em qualquer jogo → \"Baixar tradução\": o Opus procura na internet e instala sozinho, ou avisa que não há tradução.",
      "Emulação: \"Baixar\" e \"Configurar\" separados em cada emulador, \"Verificar atualizações\" e \"Baixar traduções online\". Os emuladores agora se atualizam sozinhos.",
      "Biblioteca separada por console (PS2, Switch, SNES…), do lado de Steam, Epic e Torrent.",
      "Conquistas abre bem mais rápido e não fica pulando enquanto carrega.",
      "Troféus do RetroAchievements aparecem na hora, durante o jogo.",
      "Suas configurações ficam salvas no servidor: ao reinstalar o Opus, elas voltam sozinhas.",
      "Big Picture novo: seções no topo com LB/RB, Início estilo PS5, biblioteca por console e menu rápido no Start.",
    ],
  },
  {
    version: "1.0.35",
    date: "03/10/2026",
    items: [
      "O Balói agora se chama Opus Launcher — de obra-prima: cada jogo é parte da sua coleção.",
      "Ícone novo: o direcional em relevo, em roxo, azul e verde.",
      "Sua biblioteca, login, emuladores e conquistas continuam exatamente onde estavam.",
    ],
  },
  {
    version: "1.0.34",
    date: "03/10/2026",
    items: [
      "Capas do Início padronizadas: PS2, N64, GameCube, Wii, DS e PS3 usam a arte da caixa recortada, sem faixas do console nem imagens em branco.",
      "PS3: capa da caixa baixada pelo código do jogo.",
      "Só aponte a pasta dos jogos: BIOS do PS1/PS2 e chaves/firmware do Switch guardadas perto dos jogos são encontradas e configuradas sozinhas.",
      "PS2: patches de tela cheia (16:9) e sem entrelaçamento ligados na primeira configuração.",
      "Capas da Epic carregam mais rápido.",
    ],
  },
  {
    version: "1.0.33",
    date: "03/10/2026",
    items: [
      "Traduções para N64, DS, GBA, SNES, PSP, PS1, PS2, GameCube e Wii: o Opus aplica o patch (.bps/.xdelta) numa cópia do jogo e ela aparece como \"PT-BR\" na biblioteca — a original continua lá, com os troféus.",
      "Busca online dessas traduções ao sincronizar, com arquivos conferidos.",
      "GameCube/Wii em .rvz reconhecidos com nome, console e capa; PSP com capa.",
    ],
  },
  {
    version: "1.0.32",
    date: "03/10/2026",
    items: ["Artes dos jogos maiores na faixa do Início."],
  },
  {
    version: "1.0.31",
    date: "03/10/2026",
    items: [
      "Nintendo DS: núcleo melonDS DS no RetroArch (sem BIOS). Coloque os .nds em uma pasta, vincule e jogue com o controle.",
      "Jogos de emulador sem descrição não mostram mais \"Não foi possível obter os detalhes da loja\".",
    ],
  },
  {
    version: "1.0.30",
    date: "03/10/2026",
    items: [
      "3DS: quando o mesmo jogo tem uma cópia criptografada e outra que funciona, o Opus abre a que funciona.",
    ],
  },
  {
    version: "1.0.29",
    date: "03/10/2026",
    items: [
      "Troféus de PS3: o Opus lê os troféus que o RPCS3 registra (platina, ouro, prata e bronze de verdade, com os ícones do jogo) e mostra no seu perfil.",
      "O troféu aparece com pop-up assim que você fecha o jogo.",
    ],
  },
  {
    version: "1.0.28",
    date: "03/10/2026",
    items: [
      "Login mais estável: se o servidor trocar a chave de segurança ou reiniciar, o Opus renova a sessão sozinho em vez de pedir login de novo.",
      "Troféus do RetroAchievements para PS1, SNES, NES, N64, Game Boy, GBC e GBA.",
    ],
  },
  {
    version: "1.0.27",
    date: "03/10/2026",
    items: [
      "Troféus do RetroAchievements também para PS1, SNES, NES, N64, Game Boy, GBC e GBA (antes só PS2). Jogos traduzidos só ganham troféus se o RetroAchievements reconhecer aquela versão.",
      "Conquistas ligadas sozinhas no RetroArch e no DuckStation (entre na sua conta RetroAchievements uma vez dentro do emulador).",
      "Jogos de PS1/PS2 com o arquivo .cue apontando para um nome errado são consertados ao sincronizar (o original fica como .cue.bak).",
    ],
  },
  {
    version: "1.0.26",
    date: "03/10/2026",
    items: [
      "Pente fino: uma pasta de tradução sem nome reconhecível não é mais instalada no jogo errado.",
      "Controle no 3DS funciona também em instalações novas do Azahar.",
      "O resumo de novidades aparece mesmo para quem atualiza de versões antigas.",
      "Pastas de tradução do Switch com nome sem acento, e o Big Picture não faz mais consultas de Linux no Windows.",
    ],
  },
  {
    version: "1.0.25",
    date: "03/10/2026",
    items: [
      "Traduções online: ao sincronizar Switch ou 3DS, o Opus procura a tradução PT-BR dos jogos que ainda não têm, baixa do repositório do João13 (arquivo conferido) e instala.",
      "Jogos de Switch com português oficial (Mario Galaxy, Mario Party Jamboree, Kirby…) agora abrem em PT-BR: o Eden fica configurado em Português (Brasil).",
      "Novas traduções instaladas: Xenoblade Chronicles 3 e Final Fantasy Tactics.",
    ],
  },
  {
    version: "1.0.24",
    date: "03/10/2026",
    items: [
      "Traduções automáticas: deixe uma pasta \"traducoes\" ao lado da pasta de ROMs de Switch ou 3DS e o Opus instala cada tradução no jogo certo ao sincronizar.",
      "Configurações → Emulação ganhou \"Traduções de uma pasta\" para instalar todas de uma vez.",
      "Gráficos ajustados à sua placa de vídeo: PS1, PS2, GameCube/Wii e 3DS em alta resolução em PCs mais fortes (só onde você não mudou nada).",
      "Jogos de Switch com o ID da atualização no nome (ex.: Luigi's Mansion 3) voltam a aparecer na biblioteca.",
      "Este resumo de novidades a cada atualização.",
    ],
  },
  {
    version: "1.0.23",
    date: "03/10/2026",
    items: [
      "Um botão \"Instalar e configurar\" para cada emulador.",
      "Controle de Xbox mapeado sozinho em todos os emuladores.",
      "\"Instalar tradução…\" no menu dos jogos de 3DS e Switch.",
      "Capas de SNES, N64, PS1, GBA e 3DS no padrão do Início.",
    ],
  },
];
