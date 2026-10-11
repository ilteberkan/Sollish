import test from "node:test";
import assert from "node:assert/strict";
import { chatText, classifySequence, parseClientFrame, parsePublicEvent, publicKey } from "../src/index.ts";
const event = { v: 1, stream: "lobby", id: "cd06c820-86c0-4266-85b0-20953c37af9c", seq: 1, occurredAt: "2026-10-01T00:00:00Z", kind: "chat.message", payload: { id: "cd06c820-86c0-4266-85b0-20953c37af9c", wallet: "11111111111111111111111111111111", body: "hello", createdAt: "2026-10-01T00:00:00Z" } };
test("strict public event allowlist excludes financial/secret fields and unknown versions", () => {
  assert.ok(parsePublicEvent(event));
  for (const bad of [{ ...event, v: 2 }, { ...event, payload: { ...event.payload, randomness: "secret" } }, { ...event, secret: true }, { ...event, seq: Number.MAX_SAFE_INTEGER + 1 }]) assert.equal(parsePublicEvent(bad), null);
});
test("chat commands cannot choose wallet/role and bytes/control characters are bounded", () => {
  const cmd = { v: 1, type: "chat.send", client_id: event.id, body: "hello" };
  assert.ok(parseClientFrame(JSON.stringify(cmd)));
  assert.equal(parseClientFrame(JSON.stringify({ ...cmd, wallet: event.payload.wallet })), null);
  assert.equal(chatText("x\u0000"), false); assert.equal(chatText("😀".repeat(501)), false); assert.equal(chatText(" padded "), false);
  assert.equal(publicKey("1".repeat(31)), false);
});
test("reconnect cursor distinguishes duplicate, exact next and missing interval", () => {
  const valid = parsePublicEvent(event)!;
  assert.equal(classifySequence(0, valid), "next"); assert.equal(classifySequence(1, valid), "duplicate"); assert.equal(classifySequence(0, { ...valid, seq: 3 }), "gap");
});
