/**
 * Niche "playstyle" affinity layer for the recommender.
 *
 * Coarse Steam genres (Action, RPG, Indie…) can't tell a roguelite from a
 * character-action brawler, so genre-only recommendations feel generic. This
 * module adds a curated set of *playstyle clusters* that capture the niche a
 * player actually gravitates to — the thing that makes "played God of War +
 * Hades" imply "might like Brotato, Ravenswatch (roguelites) AND Metal Gear
 * Rising, DMC5, Evil West (character-action)".
 *
 * How it's used:
 *  - INTEREST is mined from the user's OWNED games, which we already fetch full
 *    details for (title + description text + genres). Descriptions reliably
 *    mention "roguelike", "hack and slash", "soulslike"… so a cluster's
 *    `detect` pattern picks them up even when the coarse genre doesn't.
 *  - DISCOVERY of candidates then queries the catalogue by each active
 *    cluster's real Steam TAG ids (resolved from steam-user-tags.json), so we
 *    surface games actually tagged that way rather than a hand-maintained list.
 *  - Candidate cards can't be re-read for tags (the search result carries only
 *    genres), so a light `titleHints` pattern still catches obvious members.
 *
 * Heavily-online genres are deliberately excluded — this launcher has no
 * live-service/MMO catalogue, so recommending them is noise. Local/couch co-op
 * is fine and intentionally NOT excluded.
 */

export interface PlaystyleCluster {
  id: string;
  /** Human label used in the "why" explanation, e.g. "roguelites". */
  label: string;
  /** Matches owned-game title + description text to detect the user's interest. */
  detect: RegExp;
  /** Steam tag names to resolve → ids for candidate discovery (first that resolves wins ordering). */
  tagNames: string[];
  /** Light title match to catch obvious candidate members lacking tag data. */
  titleHints: RegExp;
}

/**
 * The curated clusters. Kept deliberately tight and high-precision: a false
 * "you like X" is worse than missing one, since genre similarity still carries
 * the baseline. Order is priority for display/query when several are active.
 */
export const PLAYSTYLE_CLUSTERS: PlaystyleCluster[] = [
  {
    id: "character-action",
    label: "character-action games",
    detect:
      /hack (?:and|'?n'?) slash|character action|stylish action|combo|devil may cry|bayonetta|metal gear rising|\bnier\b|ninja gaiden|god of war|\bdmc\b|\bdante\b|kratos/i,
    tagNames: ["Hack and Slash", "Character Action Game", "Beat 'em up"],
    titleHints:
      /devil may cry|bayonetta|metal gear rising|revengeance|\bnier\b|ninja gaiden|god of war|evil west|stellar blade|\bdmc\b|final fantasy vii remake|hi-fi rush|astral chain/i,
  },
  {
    id: "roguelite",
    label: "roguelites",
    detect:
      /rogue-?li(?:ke|te)|run-?based|permadeath|procedurally generated|hades|dead cells|slay the spire|risk of rain|binding of isaac|enter the gungeon|vampire survivors|brotato/i,
    tagNames: ["Roguelite", "Roguelike", "Action Roguelike"],
    titleHints:
      /rogue|hades|dead cells|risk of rain|vampire survivors|enter the gungeon|brotato|ravenswatch|gungeon|isaac|slay the spire|balatro|hellblade|nova drift|noita/i,
  },
  {
    id: "soulslike",
    label: "souls-likes",
    detect:
      /souls-?like|soulsborne|dark souls|elden ring|bloodborne|sekiro|lies of p|nioh|stamina-based|methodical combat/i,
    tagNames: ["Souls-like", "Soulslike"],
    titleHints:
      /dark souls|elden ring|bloodborne|sekiro|lies of p|nioh|lords of the fallen|code vein|mortal shell|the surge|remnant/i,
  },
  {
    id: "metroidvania",
    label: "metroidvanias",
    detect:
      /metroidvania|interconnected map|hollow knight|ori and the|guacamelee|blasphemous|castlevania|backtrack/i,
    tagNames: ["Metroidvania"],
    titleHints:
      /hollow knight|ori and the|guacamelee|blasphemous|castlevania|metroid|axiom verge|bloodstained|grime|ender lilies|prince of persia/i,
  },
  {
    id: "crpg",
    label: "story-rich RPGs",
    detect:
      /\bcrpg\b|party-based|baldur'?s gate|divinity original sin|disco elysium|pillars of eternity|branching narrative|role-?playing/i,
    tagNames: ["CRPG", "Party-Based RPG", "Story Rich"],
    titleHints:
      /baldur'?s gate|divinity|disco elysium|pillars of eternity|pathfinder|wasteland|tyranny|planescape|owlcat|solasta/i,
  },
  {
    id: "cozy",
    label: "cozy games",
    detect:
      /cozy|wholesome|relaxing|farming sim|stardew|animal crossing|life sim|slow-paced|chill/i,
    tagNames: ["Cozy", "Wholesome", "Farming Sim"],
    titleHints:
      /stardew|animal crossing|coral island|spiritfarer|unpacking|potion craft|dorfromantik|a short hike|cozy grove|littlewood/i,
  },
  {
    id: "survival-craft",
    label: "survival-crafting games",
    detect:
      /survival craft|base building|crafting and survival|valheim|terraria|subnautica|gather resources|build a base/i,
    tagNames: ["Survival", "Crafting", "Base Building"],
    titleHints:
      /valheim|terraria|subnautica|grounded|raft|the forest|core keeper|craftopia|palworld|enshrouded|sons of the forest/i,
  },
  {
    id: "twin-stick-couch",
    label: "couch co-op games",
    detect:
      /local co-?op|couch co-?op|shared screen|party game|4 players|local multiplayer/i,
    tagNames: ["Local Co-Op", "Couch Co-Op", "Local Multiplayer"],
    titleHints:
      /overcooked|moving out|it takes two|castle crashers|cuphead|towerfall|gang beasts|lovers in a dangerous|streets of rage|broforce/i,
  },
];

/**
 * Coarse genres and tag names that indicate a heavily-online / live-service
 * game we intentionally never recommend (no such catalogue here). Couch/local
 * co-op is NOT in this list on purpose.
 */
const ONLINE_EXCLUDE_GENRES = new Set(
  [
    "Massively Multiplayer",
    "MMO",
    "MMORPG",
    "MOBA",
    "Battle Royale",
    "Free to Play",
  ].map((s) => s.toLowerCase())
);

/** True when a candidate's genres mark it as a heavily-online game. */
export function isHeavilyOnline(genres: string[] | undefined): boolean {
  return (genres ?? []).some((g) => ONLINE_EXCLUDE_GENRES.has(g.toLowerCase()));
}

/**
 * Detect which playstyle clusters a piece of text (owned game's title +
 * description) belongs to. Returns the cluster ids, most-specific first.
 */
export function detectClusters(text: string): string[] {
  if (!text) return [];
  return PLAYSTYLE_CLUSTERS.filter((c) => c.detect.test(text)).map((c) => c.id);
}

/** Detect clusters a CANDIDATE likely belongs to from its title alone. */
export function detectClustersFromTitle(title: string): string[] {
  if (!title) return [];
  return PLAYSTYLE_CLUSTERS.filter((c) => c.titleHints.test(title)).map(
    (c) => c.id
  );
}

const CLUSTER_BY_ID = new Map(PLAYSTYLE_CLUSTERS.map((c) => [c.id, c]));

export function clusterLabel(id: string): string {
  return CLUSTER_BY_ID.get(id)?.label ?? id;
}

/**
 * Resolve a cluster's Steam tag names to numeric tag ids using the
 * name→id map from steam-user-tags.json. Unknown names are skipped, so a tag
 * that doesn't exist in the dataset simply contributes nothing.
 */
export function clusterTagIds(
  id: string,
  tagNameToId: Map<string, number>
): number[] {
  const cluster = CLUSTER_BY_ID.get(id);
  if (!cluster) return [];
  const ids: number[] = [];
  for (const name of cluster.tagNames) {
    const tagId = tagNameToId.get(name.toLowerCase());
    if (typeof tagId === "number" && !ids.includes(tagId)) ids.push(tagId);
  }
  return ids;
}
