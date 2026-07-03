/**
 * Detects catalogue entries that are NOT actually games — cheat carts/discs
 * (Action Replay, GameShark, Game Genie, Code Breaker), "Ultimate Codes/Cheats
 * for use with…", multi-game demo/kiosk discs, store demo loops, preview
 * trailers, and service discs. These pollute the Minerva catalogue (Myrient
 * mirrors them alongside real dumps) and must never be surfaced as games.
 *
 * Deliberately conservative: it does NOT filter (Beta)/(Proto)/(Sample) or
 * (Aftermarket) homebrew — those are real, playable games (alternate dumps),
 * only flagged content that is unplayable-as-a-game.
 */

const NON_GAME_TEXT =
  /(\baction replay\b|\bgame ?genie\b|\bgameshark\b|\bcode ?breaker\b|\bpro action replay\b|\bultimate (codes|cheats)\b|\b(codes|cheats) for use\b|interactive multi-?game demo|\bdemo disc\b|tentou demo|\bpreview (trailer|video)\b|\btrailer\b|\bservice (disc|manual)\b)/i;

// Parenthetical No-Intro/Redump tags that mark non-final / non-retail content:
// store/kiosk demos AND unfinished builds (beta/proto/sample/debug). The user
// wants only finished, real games — none of these.
const NON_GAME_TAG =
  /\((Demo|Kiosk|Trade Demo|Tech Demo|Promo|Beta|Proto|Prototype|Sample|Debug|Dev|Test Program|Pre-Release|Preview|Unl|Pirate|Bootleg)\b[^)]*\)/i;

// Re-releases that duplicate a game already present on its native platform.
// The Wii U / 3DS eShops re-hosted games from OTHER consoles (Virtual Console),
// which No-Intro tags with the source console — "Pokemon Snap (USA) (N64)
// (Virtual Console)", "Skyward Sword (Europe) (Wii)" — so those entries pollute
// the Wii U set with duplicates of the native N64/Wii dumps. A bare source-
// console tag only appears in these cross-console collections (a native GBA
// dump is never tagged "(GBA)"), so it's a safe re-release marker. Also drops
// LodgeNet hotel-rental variants.
const RE_RELEASE_TAG =
  /\bVirtual Console\b|\bLodgeNet\b|\((?:Wii(?: U)?|N64|Nintendo 64|NES|Famicom|SNES|Super Famicom|GB|GBC|GBA|Game Boy(?: Color| Advance)?|DS|Genesis|Mega Drive|Master System|Game Gear|TurboGrafx-16|TG-?16|PC Engine|MSX|Neo Geo|Arcade|C64|Commodore 64)\)/i;

/** True when a catalogue entry is a cheat device, demo/kiosk disc, trailer,
 *  or a Virtual Console / LodgeNet re-release of a native-platform game. */
export function isNonGameEntry(
  title: string | null | undefined,
  fileName: string | null | undefined
): boolean {
  const t = title ?? "";
  const f = fileName ?? "";
  return (
    NON_GAME_TEXT.test(t) ||
    NON_GAME_TEXT.test(f) ||
    NON_GAME_TAG.test(f) ||
    NON_GAME_TAG.test(t) ||
    RE_RELEASE_TAG.test(f)
  );
}
