import { API, ASTPath, Transform, ImportDeclaration } from "jscodeshift";
import { loadConfig } from "tsconfig-paths";
import * as Path from "path";
import { resolvePaths } from "./utils/resolvePath";
import { getExportedNames } from "./utils/get-export-names";

let entryPoints: Set<string>;
let namesEntryPointOwner: Map<string, string>;

const initializeEntryPointNames = (
  api: API,
  tsConfigPath: string,
  packagePath: string
) => {
  if (entryPoints) {
    return;
  }
  const tsConfig = loadConfig(tsConfigPath);

  if (tsConfig.resultType !== "success") {
    throw new Error(tsConfig.message);
  }

  entryPoints = new Set<string>();
  namesEntryPointOwner = new Map<string, string>();

  // @ts-ignore
  for (const [entryPoint, paths] of Object.entries(tsConfig.paths)) {
    if (entryPoint.indexOf(packagePath) === -1 || entryPoint === packagePath) {
      // Ignore not needed package
      continue;
    }
    const filePath = resolvePaths(
      paths.map(path => {
        return Path.resolve(tsConfig.absoluteBaseUrl, path);
      })
    );

    if (!filePath) {
      throw new Error(`No valid path for ${entryPoint}`);
    }

    const exportInfo = getExportedNames(api, { visited: new Set<string>() })(
      filePath.baseDir,
      filePath.id
    );

    entryPoints.add(entryPoint);
    exportInfo.namedExports.forEach(namedExport => {
      namesEntryPointOwner.set(namedExport, entryPoint);
    });
  }
};

interface ImportName {
  local: string | null;
  imported: string | null;
  isDefault: boolean;
}

const replaceImportForEntryPoints = (api: API, rootPath: string) => (
  path: ASTPath<ImportDeclaration>,
  i: number
) => {
  const j = api.jscodeshift;

  const groupByEntryPoint = new Map<string, ImportName[]>();
  const rootExport: ImportName[] = [];
  // initialize
  entryPoints.forEach(entryPoint => {
    groupByEntryPoint.set(entryPoint, []);
  });

  const namesUsed: ImportName[] = [];
  const specifiers = path.value.specifiers;
  if (specifiers) {
    specifiers.forEach(specifier => {
      namesUsed.push({
        imported: specifier.imported ? specifier.imported.name : null,
        local: specifier.local ? specifier.local.name : null,
        isDefault:
          specifier.type === "ImportDefaultSpecifier" ||
          (specifier.imported && specifier.imported.name === "default")
      });
    });
  }
  if (!entryPoints) {
    throw new Error("Entry points not created");
  }

  for (const importName of namesUsed) {
    const entryPoint = namesEntryPointOwner.get(importName.imported);
    if (entryPoint) {
      groupByEntryPoint.get(entryPoint)!.push(importName);
    } else {
      rootExport.push(importName);
    }
  }

  // console.log(groupByEntryPoint);
  // console.log(rootExport);
  const entryPointImportDeclarations: ImportDeclaration[] = [];
  if (rootExport.length > 0) {
    entryPointImportDeclarations.push(j.importDeclaration(
      rootExport.map(name => {
        return j.importSpecifier(
          j.identifier(name.imported),
          name.local ? j.identifier(name.local) : undefined
        );
      }),
      j.stringLiteral(rootPath)
    ))
  }

  groupByEntryPoint.forEach((importNames, entryPoint) => {
    if (importNames.length === 0) {
      return; // do nothing
    }
    entryPointImportDeclarations.push(
      j.importDeclaration(
        importNames.map(name => {
          return j.importSpecifier(
            j.identifier(name.imported),
            name.local ? j.identifier(name.local) : undefined
          );
        }),
        j.stringLiteral(entryPoint)
      )
    );
  });

  path.replace(...entryPointImportDeclarations);
};

const transform: Transform = (fileInfo, api, options) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  if (!options.tsConfigPath || !options.packagePath) {
    throw new Error("Need to specified as tsconfig path and the package name");
  }

  initializeEntryPointNames(api, options.tsConfigPath, options.packagePath);

  root
    .find(j.ImportDeclaration, {
      source: {
        type: "StringLiteral",
        value: options.packagePath
      }
    })
    .forEach(replaceImportForEntryPoints(api, options.packagePath));

  return root.toSource({ quote: "single" });
};

export default transform;
