import { useEffect, useState } from "react";
import { Modal } from "@renderer/components/modal/modal";
import { Button } from "@renderer/components";
import { CHANGELOG } from "./changelog";
import "./whats-new-modal.scss";

const SEEN_KEY = "baloi:lastSeenVersion";

const readSeen = () => {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};

const markSeen = (version: string) => {
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Storage unavailable: the summary just shows again next time.
  }
};

/** "Novidades": a short summary of what changed, shown once after each update. */
export function WhatsNewModal() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    window.electron
      .getVersion()
      .then((current: string) => {
        // Nothing recorded (first run, or an update from a version without this summary): show it once.
        const seen = readSeen();
        if (
          seen !== current &&
          CHANGELOG.some((entry) => entry.version === current)
        ) {
          setVersion(current);
        }
      })
      .catch(() => {});
  }, []);

  const entry = CHANGELOG.find((item) => item.version === version);
  if (!entry) return null;

  const close = () => {
    markSeen(entry.version);
    setVersion(null);
  };

  return (
    <Modal
      visible
      title={`Novidades da versão ${entry.version}`}
      description={entry.date}
      onClose={close}
    >
      <ul className="whats-new__list">
        {entry.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="whats-new__actions">
        <Button theme="primary" onClick={close}>
          Entendi
        </Button>
      </div>
    </Modal>
  );
}
