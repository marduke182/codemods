import * as resolve from "resolve";
import * as Path from "path";
import * as Fs from "fs";

export interface FileInfo {
  baseDir: string;
  id: string;
  path: string;
}

export const resolvePaths = (
  paths: string[]
): FileInfo | null => {
  const validPaths = paths.filter(path => {
    const dirName = Path.dirname(path);
    return Fs.existsSync(dirName);
  });

  if (validPaths.length === 0) {
    throw new Error(`No valid folder found for: ${paths}`);
  }
  // @ts-ignore
  const [path] = validPaths;

  const baseDir = Path.dirname(path);
  const id = `./${Path.basename(path)}`;

  const filePath = resolve.sync(id, {
    extensions: [".ts", ".js", ".tsx"],
    basedir: baseDir
  });

  if (!filePath) {
    // Not able to resolve ignore it
    return null;
  }
  if (Path.extname(filePath) === ".json") {
    return null;
  }

  return {
    baseDir: Path.dirname(filePath),
    id: `./${Path.basename(filePath)}`,
    path: filePath
  };
};
