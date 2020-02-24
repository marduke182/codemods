import { defineTest } from 'jscodeshift/src/testUtils';

describe("all-export-to-named-export", () => {
  defineTest(
    __dirname,
    "all-export-to-named-export",
    null,
    `all-export-to-named-export/basic`,
    { parser: "ts" }
  );
});
