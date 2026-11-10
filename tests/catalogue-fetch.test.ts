import assert from "node:assert/strict";
import test from "node:test";
import { catalogueFetchOptions } from "../src/lib/catalogue-fetch";

test("adds the CI auth header only for the configured catalogue origin", () => {
  const options = catalogueFetchOptions(
    "https://csw.nina.no/collections?f=json",
    "https://csw.nina.no",
    "test-secret",
    "application/json",
  );

  assert.deepEqual(options.headers, {
    Accept: "application/json",
    "x-nina-e2e-token": "test-secret",
  });
  assert.equal(options.redirect, "error");
});

test("does not send the CI auth header to a linked external origin", () => {
  const options = catalogueFetchOptions(
    "https://external.example/metadata.xml",
    "https://csw.nina.no",
    "test-secret",
    "application/xml",
  );

  assert.deepEqual(options.headers, { Accept: "application/xml" });
  assert.equal(options.redirect, undefined);
});
