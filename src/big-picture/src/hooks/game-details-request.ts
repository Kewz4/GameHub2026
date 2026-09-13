export interface GameDetailsRequestToken {
  id: number;
  identity: string;
}

/**
 * A result may update the page only while it is still the newest request for
 * the route that created it. The identity check closes the small interval
 * between a route render and the next effect starting its replacement request.
 */
export function isCurrentGameDetailsRequest(
  latestRequestId: number,
  currentIdentity: string,
  request: GameDetailsRequestToken
) {
  return request.id === latestRequestId && request.identity === currentIdentity;
}
