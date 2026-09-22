import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@renderer/components/icon/icon";

import { useTranslation } from "react-i18next";

import "./toast.scss";
import cn from "classnames";

export interface ToastProps {
  visible: boolean;
  title: string;
  message?: string;
  type: "success" | "error" | "warning";
  duration?: number;
  onClose: () => void;
}

const INITIAL_PROGRESS = 100;

export function Toast({
  visible,
  title,
  message,
  type,
  duration = 2500,
  onClose,
}: Readonly<ToastProps>) {
  const { t } = useTranslation();
  const [isClosing, setIsClosing] = useState(false);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);

  const closingAnimation = useRef(-1);
  const progressAnimation = useRef(-1);

  const startAnimateClosing = useCallback(() => {
    setIsClosing(true);
    const zero = performance.now();

    closingAnimation.current = requestAnimationFrame(
      function animateClosing(time) {
        if (time - zero <= 150) {
          closingAnimation.current = requestAnimationFrame(animateClosing);
        } else {
          onClose();
        }
      }
    );
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      const zero = performance.now();
      progressAnimation.current = requestAnimationFrame(
        function animateProgress(time) {
          const elapsed = time - zero;
          const progress = Math.min(elapsed / duration, 1);
          const currentValue =
            INITIAL_PROGRESS + (0 - INITIAL_PROGRESS) * progress;
          setProgress(currentValue);
          if (progress < 1) {
            progressAnimation.current = requestAnimationFrame(animateProgress);
          } else {
            cancelAnimationFrame(progressAnimation.current);
            startAnimateClosing();
          }
        }
      );

      return () => {
        setProgress(INITIAL_PROGRESS);
        cancelAnimationFrame(closingAnimation.current);
        cancelAnimationFrame(progressAnimation.current);
        setIsClosing(false);
      };
    }
    return () => {};
  }, [startAnimateClosing, duration, visible]);

  if (!visible) return null;

  return (
    <div
      className={cn("toast", {
        "toast--closing": isClosing,
      })}
    >
      <div className="toast__content">
        <div className="toast__message-container">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: `8px`,
            }}
          >
            {type === "success" && (
              <Icon name="check-circle-fill" className="toast__icon--success" />
            )}

            {type === "error" && (
              <Icon name="x-circle-fill" className="toast__icon--error" />
            )}

            {type === "warning" && (
              <Icon name="alert" className="toast__icon--warning" />
            )}

            <span style={{ fontWeight: "bold", flex: 1 }}>{title}</span>

            <button
              type="button"
              className="toast__close-button"
              onClick={startAnimateClosing}
              aria-label={t("catalogue.close", { defaultValue: "Close" })}
            >
              <Icon name="x"  />
            </button>
          </div>

          {message && <p>{message}</p>}
        </div>
      </div>

      <progress className="toast__progress" value={progress} max={100} />
    </div>
  );
}
