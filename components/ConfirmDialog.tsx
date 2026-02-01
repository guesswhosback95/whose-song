"use client";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "OK",
  cancelText = "Abbrechen",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="ws-confirm-backdrop">
      <div className="ws-confirm-card">
        <div className="ws-confirm-title">{title}</div>
        <div className="ws-confirm-message">{message}</div>

        <div className="ws-confirm-actions">
          <button className="ws-btn ws-btn--ghost" onClick={onCancel}>
            {cancelText}
          </button>
          <button className="ws-btn" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
