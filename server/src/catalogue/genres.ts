/**
 * Steam returns genre names in whatever language the request used, so the catalogue ended up
 * with both "Action" and "Ação". Everything is normalized to the pt-BR names Steam itself uses.
 */
const EN_TO_PT: Record<string, string> = {
  Action: "Ação",
  Adventure: "Aventura",
  "Early Access": "Acesso Antecipado",
  "Free To Play": "Gratuitos para Jogar",
  "Free to Play": "Gratuitos para Jogar",
  Racing: "Corrida",
  Simulation: "Simulação",
  Sports: "Esportes",
  Strategy: "Estratégia",
  "Massively Multiplayer": "Multijogador Massivo",
  Violent: "Violência",
  Gore: "Violência detalhada",
  Nudity: "Nudez",
  "Sexual Content": "Conteúdo sexual",
  "Animation & Modeling": "Animação e modelagem",
  "Audio Production": "Produção de áudio",
  "Design & Illustration": "Design e ilustração",
  Education: "Educação",
  "Game Development": "Desenvolvimento de jogos",
  "Photo Editing": "Edição de fotos",
  "Software Training": "Software de treinamento",
  Utilities: "Utilitários",
  "Video Production": "Produção de vídeo",
  "Web Publishing": "Publicação para web",
  Accounting: "Contabilidade",
  Movie: "Filme",
  Documentary: "Documentário",
  Episodic: "Episódico",
  Short: "Curta",
  "360 Video": "Vídeo em 360º",
  // LaunchBox (PS2 index) genres
  Shooter: "Tiro",
  "Visual Novel": "Romance visual",
  "Role-Playing": "RPG",
  Fighting: "Luta",
  Music: "Música",
  Platform: "Plataforma",
  Casino: "Cassino",
  Puzzle: "Quebra-cabeça",
  "Board Game": "Tabuleiro",
  "Beat 'em Up": "Briga de rua",
  Compilation: "Coletânea",
  Horror: "Terror",
  "Flight Simulator": "Simulador de voo",
  Stealth: "Furtividade",
  "Construction and Management Simulation": "Construção e gerenciamento",
  "Life Simulation": "Simulação de vida",
  Quiz: "Perguntas e respostas",
  Party: "Festa",
  "Vehicle Simulation": "Simulação de veículos",
  Sandbox: "Mundo aberto",
  Pinball: "Pinball",
  MMO: "Multijogador massivo",
};

export const normalizeGenre = (genre: string): string => EN_TO_PT[genre.trim()] ?? genre.trim();

export const normalizeGenres = (genres: string[]): string[] => [
  ...new Set(genres.map(normalizeGenre).filter(Boolean)),
];

/** Every stored spelling of a (normalized) genre, so filters also match rows saved in English. */
export const genreAliases = (genre: string): string[] => {
  const normalized = normalizeGenre(genre);
  const aliases = new Set([normalized]);
  for (const [en, pt] of Object.entries(EN_TO_PT)) if (pt === normalized) aliases.add(en);
  return [...aliases];
};
