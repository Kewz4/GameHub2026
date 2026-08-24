import path from "node:path";

import type {
  OverlayChildCreationBackend,
  OverlayInputBackend,
} from "./overlay-input-capability-contract";
import type { OverlayRenderBackend } from "./overlay-render-capability-contract";

export interface OverlayStaticImport {
  module: string;
  symbol: string | null;
  delayLoaded?: boolean;
}

export interface OverlayStaticImageInventory {
  canonicalPath: string;
  contentSha256: string;
  architecture: "x86" | "x64";
  completeImportSnapshot: boolean;
  imports: readonly OverlayStaticImport[];
  referencedSymbols?: readonly string[];
  embeddedInterfaceRevisions?: readonly string[];
  embeddedInterfaceTokens?: readonly string[];
}

export interface OverlayStaticTargetInventory {
  launchImage: OverlayStaticImageInventory;
  renderImage: OverlayStaticImageInventory;
  completeAdjacentModuleSnapshot: boolean;
  adjacentModules: readonly string[];
  /** Retained proof from the constructor-owned exact schema verifier. */
  hidReportSchemaDigest?: string;
  /** Retained proof from the constructor-owned exact libScePad ABI verifier. */
  libScePadAbiDigest?: string;
}

export type OverlayStaticTargetBlocker =
  | "incomplete-launch-import-snapshot"
  | "incomplete-render-import-snapshot"
  | "incomplete-adjacent-module-snapshot"
  | "architecture-mismatch"
  | "render-backend-unresolved"
  | "child-creation-route-unresolved"
  | "hid-report-schema-unverified"
  | "steam-interface-revision-unresolved"
  | "libscepad-abi-unverified";

export interface OverlayStaticTargetCapabilityProfile {
  requiresChildPropagation: boolean;
  requiredInputBackends: readonly OverlayInputBackend[];
  requiredChildRoutes: readonly OverlayChildCreationBackend[];
  candidateRenderBackends: readonly OverlayRenderBackend[];
  observedSteamInterfaceRevisions: readonly string[];
  blockers: readonly OverlayStaticTargetBlocker[];
}

const BASE_INPUT_BACKENDS = [
  "win32-keyboard",
  "raw-input",
  "late-module-resolution",
] as const satisfies readonly OverlayInputBackend[];

const STEAM_INPUT_REVISIONS = new Set(["steaminput006", "steamcontroller008"]);
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/u;

const normalizeModule = (value: string) =>
  path.win32.basename(value.trim()).toLowerCase();

const normalizeSymbol = (value: string | null) =>
  value?.trim().toLowerCase() ?? "";

const samePath = (left: string, right: string) =>
  path.win32.normalize(left).toLowerCase() ===
  path.win32.normalize(right).toLowerCase();

const addInContractOrder = <T extends string>(
  destination: Set<T>,
  orderedValues: readonly T[]
) => orderedValues.filter((value) => destination.has(value));

const symbolsFor = (image: OverlayStaticImageInventory) =>
  new Set([
    ...image.imports.map((item) => normalizeSymbol(item.symbol)),
    ...(image.referencedSymbols ?? []).map((item) => item.toLowerCase()),
  ]);

const modulesFor = (image: OverlayStaticImageInventory) =>
  new Set(image.imports.map((item) => normalizeModule(item.module)));

const hasSymbol = (symbols: ReadonlySet<string>, pattern: RegExp) =>
  [...symbols].some((symbol) => pattern.test(symbol));

const classifyChildRoutes = (
  launchImage: OverlayStaticImageInventory
): Set<OverlayChildCreationBackend> => {
  const symbols = symbolsFor(launchImage);
  const routes = new Set<OverlayChildCreationBackend>();
  if (hasSymbol(symbols, /^createprocess[wa]$/u)) {
    routes.add("create-process-w-a");
  }
  if (hasSymbol(symbols, /^createprocessasuser[wa]$/u)) {
    routes.add("create-process-as-user");
  }
  if (hasSymbol(symbols, /^createprocesswithtokenw$/u)) {
    routes.add("create-process-with-token");
  }
  if (hasSymbol(symbols, /^shellexecute(?:ex)?[wa]$/u)) {
    routes.add("shell-execute");
  }
  if (hasSymbol(symbols, /^ntcreateuserprocess$/u)) {
    routes.add("nt-create-user-process");
  }
  return routes;
};

const classifyRenderBackends = (
  image: OverlayStaticImageInventory
): Set<OverlayRenderBackend> => {
  const modules = modulesFor(image);
  const symbols = symbolsFor(image);
  const backends = new Set<OverlayRenderBackend>();
  if (
    modules.has("d3d12.dll") ||
    [...modules].some((module) => module.includes("dx12")) ||
    hasSymbol(symbols, /(?:^|[^a-z])d3d12|fromd3d12device/u)
  ) {
    backends.add("dxgi-d3d12");
  }
  if (
    modules.has("d3d11.dll") ||
    [...modules].some((module) => module.includes("d3d11")) ||
    hasSymbol(symbols, /(?:^|[^a-z])d3d11/u)
  ) {
    backends.add("dxgi-d3d11");
  }
  return backends;
};

const classifyInputBackends = (
  image: OverlayStaticImageInventory,
  adjacentModules: ReadonlySet<string>
): Set<OverlayInputBackend> => {
  const modules = modulesFor(image);
  const symbols = symbolsFor(image);
  const interfaceTokens = new Set(
    (image.embeddedInterfaceTokens ?? []).map((value) =>
      value.trim().toLowerCase()
    )
  );
  const backends = new Set<OverlayInputBackend>(BASE_INPUT_BACKENDS);
  const xinputModules = new Map<string, OverlayInputBackend>([
    ["xinput1_1.dll", "xinput-1.1"],
    ["xinput1_2.dll", "xinput-1.2"],
    ["xinput1_3.dll", "xinput-1.3"],
    ["xinput1_4.dll", "xinput-1.4"],
    ["xinput9_1_0.dll", "xinput-9.1.0"],
    ["xinputuap.dll", "xinput-uap"],
  ]);
  for (const [module, backend] of xinputModules) {
    if (modules.has(module)) backends.add(backend);
  }
  if (modules.has("dinput.dll")) backends.add("direct-input-legacy");
  if (modules.has("dinput8.dll")) backends.add("direct-input-8");
  if (
    modules.has("gameinput.dll") ||
    hasSymbol(symbols, /^gameinputcreate$/u) ||
    interfaceTokens.has("gameinputcreate")
  ) {
    backends.add("game-input");
  }
  if (
    [...modules].some((module) => module.includes("windows.gaming.input")) ||
    hasSymbol(symbols, /^rogetactivationfactory$/u) ||
    interfaceTokens.has("windows.gaming.input")
  ) {
    backends.add("wgi-gamepad");
    backends.add("wgi-raw-game-controller");
    backends.add("wgi-racing-wheel");
    backends.add("wgi-flight-stick");
    backends.add("wgi-arcade-stick");
    backends.add("wgi-ui-navigation");
  }
  if (
    hasSymbol(
      symbols,
      /^hidd_get(?:feature|inputreport|preparseddata)$|^hidp_get(?:data|usages|usagesex|usagesvalue|usagevalue|usagevaluearray)$/u
    ) ||
    (modules.has("setupapi.dll") &&
      hasSymbol(
        symbols,
        /^setupdi(?:getclassdevs|enumdeviceinterfaces|getdeviceinterfacedetail)[wa]?$/u
      ) &&
      hasSymbol(symbols, /^createfile[wa]$/u) &&
      hasSymbol(symbols, /^readfile$/u)) ||
    [...modules].some((module) => module.includes("hidapi"))
  ) {
    backends.add("hid-input-reports");
  }
  if ([...modules].some((module) => /^steam_api(?:64)?\.dll$/u.test(module))) {
    backends.add("steam-input-interface-revisions");
  }
  if (adjacentModules.has("libscepad.dll")) backends.add("libscepad");
  if (
    [...adjacentModules].some((module) =>
      /(?:dualsense|dualshock|ds4|dualsensex)/u.test(module)
    )
  ) {
    backends.add("ds4-dualsense-middleware");
  }
  return backends;
};

export const evaluateOverlayStaticTargetCapabilities = (
  inventory: OverlayStaticTargetInventory
): OverlayStaticTargetCapabilityProfile => {
  const blockers = new Set<OverlayStaticTargetBlocker>();
  if (!inventory.launchImage.completeImportSnapshot) {
    blockers.add("incomplete-launch-import-snapshot");
  }
  if (!inventory.renderImage.completeImportSnapshot) {
    blockers.add("incomplete-render-import-snapshot");
  }
  if (!inventory.completeAdjacentModuleSnapshot) {
    blockers.add("incomplete-adjacent-module-snapshot");
  }
  if (
    inventory.launchImage.architecture !== inventory.renderImage.architecture
  ) {
    blockers.add("architecture-mismatch");
  }

  const adjacentModules = new Set(
    inventory.adjacentModules.map(normalizeModule)
  );
  const renderBackends = classifyRenderBackends(inventory.renderImage);
  if (renderBackends.size === 0) blockers.add("render-backend-unresolved");

  const requiresChildPropagation = !samePath(
    inventory.launchImage.canonicalPath,
    inventory.renderImage.canonicalPath
  );
  const childRoutes = requiresChildPropagation
    ? classifyChildRoutes(inventory.launchImage)
    : new Set<OverlayChildCreationBackend>();
  if (requiresChildPropagation && childRoutes.size === 0) {
    blockers.add("child-creation-route-unresolved");
  }

  const inputBackends = classifyInputBackends(
    inventory.renderImage,
    adjacentModules
  );
  const revisions = new Set(
    (inventory.renderImage.embeddedInterfaceRevisions ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => STEAM_INPUT_REVISIONS.has(value))
  );
  if (
    inputBackends.has("hid-input-reports") &&
    !LOWERCASE_SHA256.test(inventory.hidReportSchemaDigest ?? "")
  ) {
    blockers.add("hid-report-schema-unverified");
  }
  if (
    inputBackends.has("steam-input-interface-revisions") &&
    revisions.size === 0
  ) {
    blockers.add("steam-interface-revision-unresolved");
  }
  if (
    inputBackends.has("libscepad") &&
    !LOWERCASE_SHA256.test(inventory.libScePadAbiDigest ?? "")
  ) {
    blockers.add("libscepad-abi-unverified");
  }

  return Object.freeze({
    requiresChildPropagation,
    requiredInputBackends: Object.freeze(
      addInContractOrder(inputBackends, [
        ...BASE_INPUT_BACKENDS,
        "xinput-1.1",
        "xinput-1.2",
        "xinput-1.3",
        "xinput-1.4",
        "xinput-9.1.0",
        "xinput-uap",
        "direct-input-legacy",
        "direct-input-8",
        "wgi-gamepad",
        "wgi-raw-game-controller",
        "wgi-racing-wheel",
        "wgi-flight-stick",
        "wgi-arcade-stick",
        "wgi-ui-navigation",
        "game-input",
        "steam-input-interface-revisions",
        "libscepad",
        "ds4-dualsense-middleware",
        "hid-input-reports",
      ])
    ),
    requiredChildRoutes: Object.freeze(
      addInContractOrder(childRoutes, [
        "create-process-w-a",
        "create-process-as-user",
        "create-process-with-token",
        "shell-execute",
        "nt-create-user-process",
      ])
    ),
    candidateRenderBackends: Object.freeze(
      addInContractOrder(renderBackends, ["dxgi-d3d11", "dxgi-d3d12"])
    ),
    observedSteamInterfaceRevisions: Object.freeze([...revisions].sort()),
    blockers: Object.freeze([...blockers]),
  });
};
