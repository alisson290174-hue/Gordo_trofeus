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
    version: "1.0.33",
    date: "03/10/2026",
    items: [
      "Traduções para N64, DS, GBA, SNES, PSP, PS1, PS2, GameCube e Wii: o Balói aplica o patch (.bps/.xdelta) numa cópia do jogo e ela aparece como \"PT-BR\" na biblioteca — a original continua lá, com os troféus.",
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
      "3DS: quando o mesmo jogo tem uma cópia criptografada e outra que funciona, o Balói abre a que funciona.",
    ],
  },
  {
    version: "1.0.29",
    date: "03/10/2026",
    items: [
      "Troféus de PS3: o Balói lê os troféus que o RPCS3 registra (platina, ouro, prata e bronze de verdade, com os ícones do jogo) e mostra no seu perfil.",
      "O troféu aparece com pop-up assim que você fecha o jogo.",
    ],
  },
  {
    version: "1.0.28",
    date: "03/10/2026",
    items: [
      "Login mais estável: se o servidor trocar a chave de segurança ou reiniciar, o Balói renova a sessão sozinho em vez de pedir login de novo.",
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
      "Traduções online: ao sincronizar Switch ou 3DS, o Balói procura a tradução PT-BR dos jogos que ainda não têm, baixa do repositório do João13 (arquivo conferido) e instala.",
      "Jogos de Switch com português oficial (Mario Galaxy, Mario Party Jamboree, Kirby…) agora abrem em PT-BR: o Eden fica configurado em Português (Brasil).",
      "Novas traduções instaladas: Xenoblade Chronicles 3 e Final Fantasy Tactics.",
    ],
  },
  {
    version: "1.0.24",
    date: "03/10/2026",
    items: [
      "Traduções automáticas: deixe uma pasta \"traducoes\" ao lado da pasta de ROMs de Switch ou 3DS e o Balói instala cada tradução no jogo certo ao sincronizar.",
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
