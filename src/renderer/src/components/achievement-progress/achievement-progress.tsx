import { isGameCompleted } from "@renderer/helpers";
import { Icon } from "@renderer/components/icon/icon";
import { ProgressBar } from "../progress-bar/progress-bar";

interface AchievementProgressProps {
  achievementCount: number;
  unlockedAchievementCount: number;
  classNamePrefix: string;
  label: string;
  trophyIconSize?: number;
}

export function AchievementProgress({
  achievementCount,
  unlockedAchievementCount,
  classNamePrefix,
  label,
  trophyIconSize = 13,
}: Readonly<AchievementProgressProps>) {
  const isCompleted = isGameCompleted(
    achievementCount,
    unlockedAchievementCount
  );
  const safeMax = achievementCount || 1;
  const percentage = Math.round((unlockedAchievementCount / safeMax) * 100);

  const percentageClassName = `${classNamePrefix}__achievement-percentage`;
  const completedClassName = `${percentageClassName}--completed`;
  const className = isCompleted
    ? `${percentageClassName} ${completedClassName}`
    : percentageClassName;

  return (
    <div className={`${classNamePrefix}__achievements`}>
      <div className={`${classNamePrefix}__achievement-header`}>
        <div className={`${classNamePrefix}__achievements-gap`}>
          {!isCompleted && (
            <Icon
              name="trophy"
              size={trophyIconSize}
              className={`${classNamePrefix}__achievement-trophy`}
            />
          )}
          <span className={`${classNamePrefix}__achievement-count`}>
            {unlockedAchievementCount} / {achievementCount}
          </span>
        </div>
        <span className={className}>
          {isCompleted ? (
            <Icon name="trophy" size={trophyIconSize} />
          ) : (
            <>{percentage}%</>
          )}
        </span>
      </div>
      <ProgressBar
        now={unlockedAchievementCount}
        max={safeMax}
        label={label}
        completed={isCompleted}
        trackClassName={`${classNamePrefix}__achievement-progress`}
        barClassName={`${classNamePrefix}__achievement-bar`}
      />
    </div>
  );
}
