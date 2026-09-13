export function shouldReconnectDownloadAfterNetworkStatus(input: {
  wasOnline: boolean;
  online: boolean;
  forceReconnect?: boolean;
}) {
  if (!input.online) return false;
  return !input.wasOnline || input.forceReconnect === true;
}
