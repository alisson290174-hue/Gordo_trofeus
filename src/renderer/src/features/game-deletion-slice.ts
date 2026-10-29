import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface GameDeletionState {
  gamesWithDeletionInProgress: string[];
}

const initialState: GameDeletionState = {
  gamesWithDeletionInProgress: [],
};

export const gameDeletionSlice = createSlice({
  name: "gameDeletion",
  initialState,
  reducers: {
    setGameDeleting: (state, action: PayloadAction<string>) => {
      if (!state.gamesWithDeletionInProgress.includes(action.payload)) {
        state.gamesWithDeletionInProgress.push(action.payload);
      }
    },
    removeGameFromDeleting: (state, action: PayloadAction<string>) => {
      state.gamesWithDeletionInProgress =
        state.gamesWithDeletionInProgress.filter((id) => id !== action.payload);
    },
  },
});

export const { setGameDeleting, removeGameFromDeleting } =
  gameDeletionSlice.actions;
