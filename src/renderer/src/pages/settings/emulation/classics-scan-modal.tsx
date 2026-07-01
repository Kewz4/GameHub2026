import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button, Modal } from "@renderer/components";
import { useClassicsScan } from "@renderer/hooks";

import { SetupStepScanning } from "./setup/setup-step-scanning";

import "./setup/setup-shell.scss";

export function ClassicsScanModal() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const { scan, closeModal, cancel } = useClassicsScan();

  if (!scan.modalVisible || !scan.system) return null;

  const systemLabel = scan.system.toUpperCase();
  const isDone = scan.phase === "done";

  return (
    <Modal
      visible
      title={
        <div className="setup-modal__header">
          <h2 className="setup-modal__header-title">
            {t("setup_modal_title", { system: systemLabel })}
          </h2>
        </div>
      }
      onClose={closeModal}
      clickOutsideToClose={false}
    >
      <div className="setup-modal">
        <div className="setup-modal__body">
          <SetupStepScanning
            systemLabel={systemLabel}
            phase={scan.phase}
            processed={scan.processed}
            total={scan.total}
            percent={scan.percent}
            currentFile={scan.currentFile}
            status={scan.status}
            discovered={scan.discovered}
            matched={scan.matched}
            sizeBytes={scan.sizeBytes}
            unmatchedFiles={scan.result?.unmatchedFiles ?? []}
          />
        </div>

        <div className="setup-modal__footer">
          <div className="setup-modal__footer-side" />
          <div className="setup-modal__footer-side setup-modal__footer-side--end">
            {scan.active && (
              <>
                <button
                  type="button"
                  className="setup-modal__ghost-button"
                  onClick={cancel}
                >
                  {t("setup_cancel_scan")}
                </button>
                <Button theme="outline" onClick={closeModal}>
                  {t("setup_run_in_background")}
                </Button>
              </>
            )}
            {isDone && (
              <>
                <Button theme="outline" onClick={closeModal}>
                  {t("setup_continue")}
                </Button>
                <Button
                  theme="primary"
                  onClick={() => {
                    const system = scan.system;
                    closeModal();
                    localStorage.setItem("library-category", "classics");
                    navigate(
                      system ? `/library?console=${system}` : "/library"
                    );
                  }}
                >
                  {t("setup_browse_games", { defaultValue: "Browse games" })}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
