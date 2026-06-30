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

// Parenthetical No-Intro/Redump tags that mark non-final, non-game content.
const NON_GAME_TAG = /\((Demo|Kiosk|Trade Demo|Tech Demo|Promo)\)/i;

/** True when a catalogue entry is a cheat device, demo/kiosk disc, trailer, etc. */
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
    NON_GAME_TAG.test(t)
  );
}
