import { API, ASTPath, ExportAllDeclaration, ExportSpecifier, Transform } from 'jscodeshift';
import * as Path from 'path';
import { Context, getExportedNames } from './utils/get-export-names';

const replaceAllExportForNamedExport = (
  api: API,
  filePath: string,
  context: Context
) => (path: ASTPath<ExportAllDeclaration>, i: number) => {
  const j = api.jscodeshift;
  const source = path.get("source", "value").value;

  const exportedNames = getExportedNames(api, context)(
    Path.dirname(filePath),
    source
  );

  let exports: ExportSpecifier[] = [];

  if (exportedNames.hasDefaultExport) {
    exports.push(
      j.exportSpecifier(
        j.identifier("default"),
        j.identifier(exportedNames.defaultName)
      )
    );
  }

  exports = exports.concat(
    exportedNames.namedExports
      .sort((a: string, b: string) => {
        if (a > b) {
          return 1;
        }
        if (a < b) {
          return -1;
        }
        return 0;
      })
      .map(name => {
        return j.exportSpecifier(j.identifier(name), j.identifier(name));
      })
  );

  path.replace(
    j.exportDeclaration(false, null, exports, j.stringLiteral(source))
  );
};


const transform: Transform = (fileInfo, api) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const context: Context = {
    visited: new Set()
  };
  root
    .find(j.ExportAllDeclaration)
    .forEach(replaceAllExportForNamedExport(api, fileInfo.path, context));

  return root.toSource();
};

export default transform;
