import type {
  EmulationCloudSave,
  EmulationSaveEmulator,
  EmulationSavePlatform,
} from "@types";

export interface UploadEmulationSaveOptions {
  platform: EmulationSavePlatform;
  emulator: EmulationSaveEmulator;
  shop: string | null;
  objectId: string | null;
  saveIdentity: string;
  fileName: string;
  label: string;
  localLastModifiedAt: string;
  buffer: Buffer;
}

export const uploadEmulationSave = async (
  _options: UploadEmulationSaveOptions
): Promise<EmulationCloudSave> => {
  throw new Error("uploadEmulationSave not implemented");
};

export const toEmulationSaveEmulator = (
  _binary: string
): EmulationSaveEmulator => {
  throw new Error("toEmulationSaveEmulator not implemented");
};

export const readSaveContents = async (
  _cardFilePath: string,
  _folderName: string
): Promise<Buffer | null> => null;

export const buildPsuBuffer = (_contents: Buffer): Buffer => _contents;

export const readPs1SaveContents = async (
  _cardFilePath: string,
  _folderName: string
): Promise<Buffer | null> => null;

export const buildMcsBuffer = (_contents: Buffer): Buffer => _contents;

export const buildPathToTitleIdIndex = (
  _entries: Map<string, string>
): Map<string, string> => new Map();

export const readGamesYml = async (
  _executablePath: string | null
): Promise<Map<string, string>> => new Map();

export const mergeWriteGamesYml = async (
  _executablePath: string | null,
  _entries: Map<string, string>
): Promise<void> => {};
