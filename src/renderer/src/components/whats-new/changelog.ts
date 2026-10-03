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
