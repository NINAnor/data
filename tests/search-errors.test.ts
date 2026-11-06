import assert from "node:assert/strict";
import test from "node:test";
import { EndpointError } from "@camptocamp/ogc-client";
import { apiErrorMessage, isCrossOriginError } from "../src/lib/search-errors";

test("preserves OGC API validation errors instead of classifying them as CORS", () => {
  const message = apiErrorMessage(
    JSON.stringify({
      code: "InvalidParameterValue",
      description: "CQL parsing error: unexpected encoded space",
    }),
    400,
    "Bad Request",
  );

  assert.equal(message, "InvalidParameterValue: CQL parsing error: unexpected encoded space");
  assert.equal(isCrossOriginError(new EndpointError(message, 400, false)), false);
});

test("classifies only explicitly identified endpoint CORS errors as CORS", () => {
  assert.equal(isCrossOriginError(new EndpointError("CORS blocked", 0, true)), true);
  assert.equal(isCrossOriginError(new TypeError("Failed to fetch")), false);
});
