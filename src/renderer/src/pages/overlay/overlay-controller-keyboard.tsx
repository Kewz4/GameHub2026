import {
  ArrowLeft,
  ArrowRight,
  CaseUpper,
  Check,
  Delete,
  Hash,
  Keyboard,
  Space,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  deleteOverlayKeyboardText,
  insertOverlayKeyboardText,
  moveOverlayKeyboardCursor,
} from "./overlay-controller";

type OverlayControllerKeyboardProps = {
  label: string;
  multiline: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
};

const ALPHA_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;
const SYMBOL_ROWS = ["1234567890", "@#$%&*()-+", "!?/:;'\"_,."] as const;

export function OverlayControllerKeyboard({
  label,
  multiline,
  value,
  onChange,
  onClose,
}: OverlayControllerKeyboardProps) {
  const [shifted, setShifted] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [cursor, setCursor] = useState(value.length);
  const rows = useMemo(
    () =>
      (symbols ? SYMBOL_ROWS : ALPHA_ROWS).map((row) =>
        [...row].map((character) =>
          shifted ? character.toLocaleUpperCase() : character
        )
      ),
    [shifted, symbols]
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          "#overlay-controller-keyboard [data-controller-default]"
        )
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const append = (character: string) => {
    const edit = insertOverlayKeyboardText(value, cursor, character);
    onChange(edit.value);
    setCursor(edit.cursor);
    if (shifted && !symbols) setShifted(false);
  };

  const deleteBeforeCursor = () => {
    const edit = deleteOverlayKeyboardText(value, cursor);
    onChange(edit.value);
    setCursor(edit.cursor);
  };

  return (
    <div className="overlay-controller-keyboard-backdrop">
      <section
        id="overlay-controller-keyboard"
        className="overlay-controller-keyboard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overlay-controller-keyboard-title"
        data-controller-scope="true"
      >
        <header className="overlay-controller-keyboard__header">
          <Keyboard size={20} aria-hidden="true" />
          <div>
            <h2 id="overlay-controller-keyboard-title">{label}</h2>
            <p>A selects · B closes · D-pad or stick moves</p>
          </div>
        </header>

        <div
          className="overlay-controller-keyboard__preview"
          aria-label={`${label} text preview`}
        >
          {value.slice(0, cursor)}
          <span
            className="overlay-controller-keyboard__caret"
            aria-hidden="true"
          />
          {value.slice(cursor)}
          {!value && <span className="is-placeholder">Start typing…</span>}
        </div>

        <div className="overlay-controller-keyboard__keys">
          {rows.map((row, rowIndex) => (
            <div
              key={`${symbols ? "symbols" : "letters"}-${rowIndex}`}
              className="overlay-controller-keyboard__row"
            >
              {row.map((character, characterIndex) => (
                <button
                  key={characterIndex}
                  type="button"
                  data-controller-default={
                    rowIndex === 0 && characterIndex === 0 ? "true" : undefined
                  }
                  aria-label={`Type ${character}`}
                  onClick={() => append(character)}
                >
                  {character}
                </button>
              ))}
            </div>
          ))}

          <div className="overlay-controller-keyboard__row overlay-controller-keyboard__row--actions">
            <button
              type="button"
              aria-pressed={shifted}
              onClick={() => setShifted((active) => !active)}
            >
              <CaseUpper size={16} aria-hidden="true" />
              Shift
            </button>
            <button
              type="button"
              aria-pressed={symbols}
              onClick={() => setSymbols((active) => !active)}
            >
              <Hash size={16} aria-hidden="true" />
              {symbols ? "ABC" : "123"}
            </button>
            <button
              type="button"
              className="overlay-controller-keyboard__space"
              onClick={() => append(" ")}
            >
              <Space size={16} aria-hidden="true" />
              Space
            </button>
            {multiline && (
              <button
                type="button"
                aria-label="Insert line break"
                onClick={() => append("\n")}
              >
                Line break
              </button>
            )}
            <button
              type="button"
              aria-label="Move text cursor left"
              disabled={cursor <= 0}
              onClick={() =>
                setCursor((position) =>
                  moveOverlayKeyboardCursor(value, position, -1)
                )
              }
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Move text cursor right"
              disabled={cursor >= value.length}
              onClick={() =>
                setCursor((position) =>
                  moveOverlayKeyboardCursor(value, position, 1)
                )
              }
            >
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Delete character before cursor"
              onClick={deleteBeforeCursor}
            >
              <Delete size={16} aria-hidden="true" />
              Delete
            </button>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setCursor(0);
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="overlay-controller-keyboard__done"
              onClick={onClose}
            >
              <Check size={16} aria-hidden="true" />
              Done
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
