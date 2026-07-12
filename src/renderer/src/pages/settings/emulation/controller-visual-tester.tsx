import { useMemo } from "react";
import type { EmulatorBinary } from "@types";
import "./controller-visual-tester.scss";

/**
 * The standalone tester page (bundled under resources/controller-testers and
 * served by the `controller-tester://` protocol) that best matches each
 * emulator's controller. Cemu emulates the Wii U, whose Pro Controller maps
 * onto the Switch Pro layout.
 */
const PAGE_FOR_BINARY: Partial<Record<EmulatorBinary, string>> = {
  cemu: "switch-pro-controller-test.html",
  dolphin: "switch-pro-controller-test.html",
};

export interface ControllerVisualTesterProps {
  binary: EmulatorBinary;
}

export function ControllerVisualTester({
  binary,
}: Readonly<ControllerVisualTesterProps>) {
  const page = PAGE_FOR_BINARY[binary];
  const src = useMemo(
    () => (page ? `controller-tester://host/${page}` : null),
    [page]
  );

  if (!src) return null;

  return (
    <div className="controller-visual-tester">
      <iframe
        className="controller-visual-tester__frame"
        src={src}
        title="Controller tester"
        // The page reads the Web Gamepad API directly; allow it inside the
        // frame so live input lights up the diagram.
        allow="gamepad *;"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
