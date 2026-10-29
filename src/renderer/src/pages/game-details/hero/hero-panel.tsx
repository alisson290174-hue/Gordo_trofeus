import { useContext } from "react";

import { HeroPanelActions } from "./hero-panel-actions";
import { HeroPanelPlaytime } from "./hero-panel-playtime";

import { gameDetailsContext } from "@renderer/context";
import "./hero-panel.scss";

export function HeroPanel() {
  const { game } = useContext(gameDetailsContext);

  return (
    <div className="hero-panel__container">
      <div className="hero-panel">
        <div className="hero-panel__content">
          {game && <HeroPanelPlaytime />}
        </div>
        <div className="hero-panel__actions">
          <HeroPanelActions />
        </div>
      </div>
    </div>
  );
}
