import { API, ASTPath, Transform, ImportDeclaration } from "jscodeshift";
import { ConfigLoaderSuccessResult, loadConfig } from "tsconfig-paths";
import * as Path from "path";
import { FileInfo, resolvePaths } from "./utils/resolvePath";
import { getExportedNames } from "./utils/get-export-names";
import { readFileSync } from "fs";
import {
  ExportNamespaceSpecifier,
  ExportSpecifier,
  File, ImportDefaultSpecifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
} from 'jscodeshift/src/core';

let entryPoints: Set<string>;
let namesEntryPointOwner: Map<string, string>;

interface NameInfo {
  isDefault: boolean;
  localName: string;
  importedName: string;
}

interface ExporteNameInfo {
  specifier: ExportNamespaceSpecifier | ExportSpecifier;
  path: string;
  local?: string;
  exported: string;
}

class EntryPoints {
  private api: API;
  private rootInfo: {
    packageName: string;
    baseDir?: string;
    id?: string;
    path?: string;
  };

  private readonly pathsToEntryPoint = new Map<string, string>();
  private readonly entryPointInfo = new Map<string, FileInfo>();
  private readonly entryPointExportedNames = new Map<
    string,
    Map<string, ExporteNameInfo>
  >();
  private readonly exportedNamesToEntryPoint = new Map<string, string>();

  constructor(packageName: string, api: API) {
    this.rootInfo = { packageName };
    this.api = api;
  }

  private getEntryPointInfo(
    entryPoint: string,
    candidatePaths: string[],
    tsConfig: ConfigLoaderSuccessResult
  ): FileInfo {
    const fileInfo = resolvePaths(
      candidatePaths.map(path => {
        return Path.resolve(tsConfig.absoluteBaseUrl, path);
      })
    );

    if (!fileInfo) {
      throw new Error(`No valid path for ${entryPoint}`);
    }

    return fileInfo;
  }

  private registerEntryPoint(entryPoint: string, fileInfo: FileInfo) {
    this.pathsToEntryPoint.set(fileInfo.path, entryPoint);
    this.entryPointInfo.set(entryPoint, fileInfo);
    this.entryPointExportedNames.set(
      entryPoint,
      new Map<string, ExporteNameInfo>()
    );
  }

  private *exportedNames(): Iterable<ExporteNameInfo> {
    const j = this.api.jscodeshift;
    if (!this.rootInfo.path) {
      throw new Error("No root file info");
    }

    let buffer = readFileSync(this.rootInfo.path);
    const sourceRoot = j(buffer.toString());

    const exportedNameDeclarations = sourceRoot.find(j.ExportNamedDeclaration);

    for (const exportNamedDeclaration of exportedNameDeclarations.nodes()) {
      // We dont care declarations exports only source ones.
      if (!exportNamedDeclaration.source) {
        continue;
      }
      let fileInfo: FileInfo;
      try {
        fileInfo = resolvePaths([
          Path.resolve(
            this.rootInfo.baseDir,
            exportNamedDeclaration.source.value as string
          )
        ]);
      } catch (e) {
        // If no found ignore it.
        continue;
      }
      // It's not an entry point ignore it
      if (!this.pathsToEntryPoint.has(fileInfo.path)) {
        continue;
      }

      const { specifiers } = exportNamedDeclaration;
      if (specifiers) {
        for (const [, specifier] of specifiers.entries()) {
          // @ts-ignore
          if (specifier.type === "ExportNamespaceSpecifier") {
            // do something
            yield {
              path: fileInfo.path,
              exported: specifier.exported.name,
              specifier
            };
            continue;
          }

          yield {
            specifier,
            path: fileInfo.path,
            local: specifier.local.name,
            exported: specifier.exported.name
          };
        }
      }
    }
  }

  loadEntryPoints(tsConfig: ConfigLoaderSuccessResult) {
    Object.entries(tsConfig.paths)
      // Get only the entry points related to root
      .filter(
        ([entryPoint]) => entryPoint.indexOf(this.rootInfo.packageName) !== -1
      )
      .forEach(([entryPoint, validPaths]) => {
        const fileInfo = this.getEntryPointInfo(
          entryPoint,
          validPaths,
          tsConfig
        );
        if (entryPoint === this.rootInfo.packageName) {
          // This is the root package, let's get the path
          this.rootInfo = {
            ...this.rootInfo,
            ...fileInfo
          };
          return;
        }
        // Its an entryPoint
        this.registerEntryPoint(entryPoint, fileInfo);
      });

    for (const exportedNameInfo of this.exportedNames()) {
      const entryPoint = this.pathsToEntryPoint.get(exportedNameInfo.path);

      this.exportedNamesToEntryPoint.set(exportedNameInfo.exported, entryPoint);
      this.entryPointExportedNames
        .get(entryPoint)
        .set(exportedNameInfo.exported, exportedNameInfo);
    }

    console.log(this.exportedNamesToEntryPoint)
  }
  replaceImportDeclaration(path: ASTPath<ImportDeclaration>): void {
    const j = this.api.jscodeshift;
    const groupByEntryPoint = new Map<
      string,
      Array<ImportSpecifier | ImportNamespaceSpecifier | ImportDefaultSpecifier>
    >();
    const rootExport: Array<ImportSpecifier | ImportNamespaceSpecifier> = [];
    // initialize
    this.entryPointInfo.forEach((_, entryPoint) => {
      groupByEntryPoint.set(entryPoint, []);
    });

    const specifiers = path.value.specifiers;
    if (specifiers) {
      for (const [, specifier] of specifiers.entries()) {
        if (
          specifier.type === "ImportNamespaceSpecifier" ||
          specifier.type === "ImportDefaultSpecifier"
        ) {
          // TODO: let's take care of this later
          continue;
        }
        const importedName = specifier.imported.name;
        const entryPoint = this.exportedNamesToEntryPoint.get(importedName);
        if (!entryPoint) {
          // Do nothing if the import value is not coming from an entry point
          rootExport.push(specifier);
          continue;
        }
        const exportNameInfo = this.entryPointExportedNames
          .get(entryPoint)
          .get(importedName);

        if (!exportNameInfo) {
          throw new Error("Should not happen");
        }

        if (exportNameInfo.specifier.type === "ExportNamespaceSpecifier") {
          const name = specifier.local
            ? specifier.local.name
            : exportNameInfo.exported;
          groupByEntryPoint
            .get(entryPoint)
            .push(j.importNamespaceSpecifier(j.identifier(name)));
        } else {
          const imported = exportNameInfo.local
            ? exportNameInfo.local
            : exportNameInfo.exported;
          const local = specifier.local ? specifier.local.name : undefined;

          if (imported === 'default' && local) {
            groupByEntryPoint
              .get(entryPoint)
              .push(
                j.importDefaultSpecifier(
                  j.identifier(local)
                )
              );

          } else {
            groupByEntryPoint
              .get(entryPoint)
              .push(
                j.importSpecifier(
                  j.identifier(imported),
                  local ? j.identifier(local) : undefined
                )
              );
          }


        }
      }
    }

    const entryPointImportDeclarations: ImportDeclaration[] = [];
    if (rootExport.length > 0) {
      entryPointImportDeclarations.push(
        j.importDeclaration(
          rootExport,
          j.stringLiteral(this.rootInfo.packageName)
        )
      );
    }

    groupByEntryPoint.forEach((importNames, entryPoint) => {
      if (importNames.length === 0) {
        return; // do nothing
      }
      entryPointImportDeclarations.push(
        j.importDeclaration(importNames, j.stringLiteral(entryPoint))
      );
    });

    path.replace(...entryPointImportDeclarations);
  }
}

let newEntryPoints: EntryPoints;

const initializeEntryPointNames = (
  api: API,
  tsConfigPath: string,
  packageName: string
) => {
  if (newEntryPoints) {
    return;
  }

  // Load tsconfig, we assume that ts config path is already a full path.
  const tsConfig = loadConfig(tsConfigPath);

  if (tsConfig.resultType !== "success") {
    throw new Error(tsConfig.message);
  }

  /**
   * Pseudo Algorithm to create entry point meta data
   * 1. Get all entry points file path and root file path
   * 2. Parse root file
   *    i. Iterate for each export with an specifier (these are the once that can reexport from entrypoints)
   *    ii. Check resolved file path with the stored entry points, if it is an entry point then:
   *      a. Store name information (We need to keep renames to used it later, AKA `default as` or `name as`)
   */
  newEntryPoints = new EntryPoints(packageName, api);

  newEntryPoints.loadEntryPoints(tsConfig);
};

const transform: Transform = (fileInfo, api, options) => {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  if (!options.tsConfigPath || !options.packageName) {
    throw new Error("Need to specified as tsconfig path and the package name");
  }

  initializeEntryPointNames(api, options.tsConfigPath, options.packageName);

  root
    .find(j.ImportDeclaration, {
      source: {
        type: "StringLiteral",
        value: options.packageName
      }
    })
    .forEach((path: ASTPath<ImportDeclaration>, i: number) => {
      newEntryPoints.replaceImportDeclaration(path);
    });

  return root.toSource({ quote: "single" });
};

export default transform;
