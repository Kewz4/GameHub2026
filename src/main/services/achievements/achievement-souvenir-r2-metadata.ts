import type { AchievementSouvenirRecord, GameShop } from "@types";

type SouvenirR2Metadata = Record<string, string | undefined>;

const decodeMetadataValue = (value: string | undefined) => {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    return value ?? "";
  }
};

const encodeMetadataValue = (
  value: string | null | undefined,
  maxLength = 240
) => encodeURIComponent((value ?? "").slice(0, maxLength));

export function achievementSouvenirMetadataFromRecord(
  record: AchievementSouvenirRecord
): Record<string, string> {
  return {
    schema: "1",
    ownerid: encodeMetadataValue(record.ownerId, 512),
    shop: encodeMetadataValue(record.shop, 32),
    objectid: encodeMetadataValue(record.objectId, 1_024),
    achievementname: encodeMetadataValue(record.achievementName, 512),
    achievementdisplayname: encodeMetadataValue(record.achievementDisplayName),
    achievementdescription: encodeMetadataValue(
      record.achievementDescription,
      1_024
    ),
    achievementiconurl: encodeMetadataValue(record.achievementIconUrl, 1_024),
    gametitle: encodeMetadataValue(record.gameTitle),
    gameiconurl: encodeMetadataValue(record.gameIconUrl, 512),
    unlocktime: String(record.unlockTime),
    updatedat: String(record.updatedAt),
  };
}

export function achievementSouvenirRecordFromMetadata(
  metadata: SouvenirR2Metadata,
  r2Key: string,
  fallbackUpdatedAt: number
): AchievementSouvenirRecord {
  const updatedAt = Number(metadata.updatedat);

  return {
    schemaVersion: 1,
    ownerId: decodeMetadataValue(metadata.ownerid),
    shop: decodeMetadataValue(metadata.shop) as GameShop,
    objectId: decodeMetadataValue(metadata.objectid),
    achievementName: decodeMetadataValue(metadata.achievementname),
    achievementDisplayName: decodeMetadataValue(
      metadata.achievementdisplayname
    ),
    achievementDescription:
      decodeMetadataValue(metadata.achievementdescription) || null,
    achievementIconUrl:
      decodeMetadataValue(metadata.achievementiconurl) || null,
    gameTitle: decodeMetadataValue(metadata.gametitle),
    gameIconUrl: decodeMetadataValue(metadata.gameiconurl) || null,
    unlockTime: Number(metadata.unlocktime),
    localPath: null,
    r2Key,
    status: "synced",
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : fallbackUpdatedAt,
  };
}
