import { configureStore } from "@reduxjs/toolkit";
import {
  windowSlice,
  librarySlice,
  userPreferencesSlice,
  toastSlice,
  userDetailsSlice,
  gameRunningSlice,
  subscriptionSlice,
  collectionsSlice,
  classicsScanSlice,
  gameDeletionSlice,
  retroarchScanSlice,
} from "@renderer/features";

export const store = configureStore({
  reducer: {
    window: windowSlice.reducer,
    library: librarySlice.reducer,
    userPreferences: userPreferencesSlice.reducer,
    toast: toastSlice.reducer,
    userDetails: userDetailsSlice.reducer,
    gameRunning: gameRunningSlice.reducer,
    subscription: subscriptionSlice.reducer,
    collections: collectionsSlice.reducer,
    classicsScan: classicsScanSlice.reducer,
    gameDeletion: gameDeletionSlice.reducer,
    retroarchScan: retroarchScanSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
