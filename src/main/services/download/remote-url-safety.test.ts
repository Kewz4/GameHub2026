import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./remote-url-safety.ts";
const {
  assertPublicRemoteUrlSyntax,
  filterPublicLookupAddresses,
  isPublicNetworkAddress,
} = await import(modulePath);

test("accepts public IPv4 and IPv6 while rejecting local and reserved ranges", () => {
  assert.equal(isPublicNetworkAddress("8.8.8.8"), true);
  assert.equal(isPublicNetworkAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicNetworkAddress("127.0.0.1"), false);
  assert.equal(isPublicNetworkAddress("169.254.169.254"), false);
  assert.equal(isPublicNetworkAddress("192.168.1.20"), false);
  assert.equal(isPublicNetworkAddress("::1"), false);
  assert.equal(isPublicNetworkAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicNetworkAddress("fc00::1"), false);
  assert.equal(isPublicNetworkAddress("fe80::1"), false);
  assert.equal(isPublicNetworkAddress("2001:db8::1"), false);
});

test("rejects private literal and local-name remote URLs", () => {
  for (const input of [
    "http://localhost/game.torrent",
    "http://127.0.0.1/game.torrent",
    "http://2130706433/game.torrent",
    "http://[::1]/game.torrent",
    "http://router.local/game.torrent",
    "http://metadata.internal/game.torrent",
  ]) {
    assert.throws(() => assertPublicRemoteUrlSyntax(input), /public internet/);
  }

  assert.equal(
    assertPublicRemoteUrlSyntax(
      "https://example.org/game.torrent#secret"
    ).toString(),
    "https://example.org/game.torrent"
  );
});

test("DNS lookup filtering never returns private rebinding targets", () => {
  assert.deepEqual(
    filterPublicLookupAddresses([
      { address: "10.0.0.2", family: 4 },
      { address: "93.184.216.34", family: 4 },
      { address: "fe80::1", family: 6 },
    ]),
    [{ address: "93.184.216.34", family: 4 }]
  );
});
