import { API, ASTPath, ExportNamedDeclaration } from 'jscodeshift';
import * as resolve from 'resolve';
import * as Path from 'path';
import { readFileSync } from 'fs';


export interface Context {
  visited: Set<string>;
}

interface ExportInfo {
  hasDefaultExport: boolean;
  namedExports: string[];
  defaultName: string;
}

function getExportName(path: ASTPath<ExportNamedDeclaration>): string[] {
  const names: string[] = [];
  const declaration = path.value.declaration;
  
  if (declaration) {
    if (
      [
        'ClassDeclaration',
        'FunctionDeclaration',
        'TSInterfaceDeclaration',
        'TSTypeAliasDeclaration',
        'TSEnumDeclaration',
      ].indexOf(declaration.type) !== -1
    ) {
      // @ts-ignore
      names.push(declaration.id.name);
    } else if (declaration.type === 'VariableDeclaration') {
      declaration.declarations.forEach(dec => {
        if (dec.type === 'Identifier') {
          names.push(dec.name);
        } else if (dec.type === 'VariableDeclarator') {
          // @ts-ignore
          names.push(dec.id.name);
        }
      });
    } else if (declaration.type === 'TSInterfaceDeclaration') {
      // @ts-ignore
      names.push(declaration.id.name);
    } else {
      names.push(declaration.id.name);
    }
  }

  const specifiers = path.value.specifiers;
  if (specifiers) {
    specifiers.forEach(specifier => {
      names.push(specifier.exported.name);
    });
  }
  if (names.length === 0) {
    console.log(path.value);
  }
  return names;
}

export const getExportedNames = (api: API, context: Context) => (
  baseDir: string,
  id: string,
): ExportInfo => {
  const exportInfo: ExportInfo = {
    defaultName: '',
    hasDefaultExport: false,
    namedExports: [],
  };
  const j = api.jscodeshift;
  const filePath = resolve.sync(id, {
    extensions: ['.ts', '.js', '.tsx'],
    basedir: baseDir,
  });

  if (!filePath) {
    // Not able to resolve ignore it
    return exportInfo;
  }
  if (Path.extname(filePath) === '.json') {
    return exportInfo;
  }

  if (context.visited.has(filePath)) {
    return exportInfo; // Already visited ignored it
  }
  // Mark as visited
  context.visited.add(filePath);

  try {
    let buffer = readFileSync(filePath);
    const sourceRoot = api.jscodeshift(buffer.toString());
    sourceRoot
      .find(j.ExportNamedDeclaration)
      // .closest(j.VariableDeclarator)
      .forEach(path => {
        getExportName(path).forEach(name => {
          exportInfo.namedExports.push(name);
        });
      });

    sourceRoot.find(j.ExportDefaultDeclaration).forEach(path => {
      exportInfo.hasDefaultExport = true;
      exportInfo.defaultName = Path.basename(filePath).split(
        Path.extname(filePath),
      )[0];
    });

    sourceRoot.find(j.ExportAllDeclaration).forEach(path => {
      const source = path.get('source', 'value').value;

      const exportedNames = getExportedNames(api, context)(
        Path.dirname(filePath),
        source,
      );

      if (exportedNames.hasDefaultExport) {
        exportInfo.namedExports.push(exportedNames.defaultName);
      }

      exportedNames.namedExports.forEach(name => {
        exportInfo.namedExports.push(name);
      });
    });
  } catch (e) {
    console.log(e);
  }

  return exportInfo;
};
