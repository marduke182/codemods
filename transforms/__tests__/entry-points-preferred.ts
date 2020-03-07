import { defineTest } from 'jscodeshift/src/testUtils';
import { resolve } from 'path';


describe("entry-points-preferred", () => {
  defineTest(
    __dirname,
    "entry-points-preferred",
    { packageName: '@marduke182/fake-package', tsConfigPath: resolve(__dirname, '..', '__testfixtures__/entry-points-preferred/tsconfig.json')},
    `entry-points-preferred/basic`,
    { parser: "ts"}
  );
});
