import { builtinModules } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ignoredDirectories = new Set([".git", ".next", ".turbo", "coverage", "dist", "node_modules"]);
const sourceExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);

function isTestFile(filePath) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

function isDevelopmentFile(filePath) {
  return isTestFile(filePath) || /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(filePath);
}

function packageNameForSpecifier(specifier) {
  if (!specifier.startsWith("@")) return specifier.split("/", 1)[0];
  return specifier.split("/", 2).join("/");
}

export function packageNameFromSpecifier(specifier) {
  return packageNameForSpecifier(specifier);
}

export function importSpecifiers(contents) {
  const specifiers = new Set();
  const fromPattern = /\b(?:import|export)\s+(?:(?!;).)*?\sfrom\s+["']([^"']+)["']/gs;
  const sideEffectPattern = /\bimport\s*["']([^"']+)["']/g;
  for (const match of contents.matchAll(fromPattern)) specifiers.add(match[1]);
  for (const match of contents.matchAll(sideEffectPattern)) specifiers.add(match[1]);
  return [...specifiers].sort();
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name))
        files.push(...(await collectSourceFiles(path.join(directory, entry.name))));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(path.join(directory, entry.name));
  }
  return files.sort();
}

async function discoverPackages(root) {
  const packages = [];
  for (const directory of ["apps", "packages"]) {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relativePath = path.join(directory, entry.name);
      const packagePath = path.join(root, relativePath);
      packages.push({
        name: JSON.parse(await readFile(path.join(packagePath, "package.json"), "utf8")).name,
        path: relativePath,
        root: packagePath,
        manifest: JSON.parse(await readFile(path.join(packagePath, "package.json"), "utf8")),
      });
    }
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

function dependencyNames(manifest, section) {
  return new Set(Object.keys(manifest[section] ?? {}));
}

function isBuiltinSpecifier(specifier) {
  return specifier.startsWith("node:") || builtinModules.includes(specifier);
}

function isTypeOnlyImport(contents, specifier) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bimport\\s+type\\b[\\s\\S]{0,400}?from\\s+["']${escaped}["']`).test(contents);
}

export function dependencyViolationsForSource({
  packageName,
  filePath,
  contents,
  runtimeDependencies,
  developmentDependencies,
  peerDependencies,
  workspaceNames,
  rootDevelopmentDependencies = new Set(),
  forbiddenImports = {},
}) {
  const violations = [];
  const developmentFile = isDevelopmentFile(filePath);
  const declaredRuntime = new Set([...runtimeDependencies, ...peerDependencies]);
  const declaredForTests = new Set([...declaredRuntime, ...developmentDependencies, ...rootDevelopmentDependencies]);
  const forbidden = new Set(forbiddenImports[packageName] ?? []);

  for (const specifier of importSpecifiers(contents)) {
    if (specifier.startsWith(".") || specifier.startsWith("/") || isBuiltinSpecifier(specifier)) continue;
    const dependencyName = packageNameForSpecifier(specifier);
    if (forbidden.has(dependencyName)) {
      violations.push(`${filePath}: ${packageName} may not import ${dependencyName}`);
    }

    const declared = developmentFile ? declaredForTests.has(dependencyName) : declaredRuntime.has(dependencyName);
    const typePackageDeclared =
      isTypeOnlyImport(contents, specifier) &&
      developmentDependencies.has(`@types/${dependencyName.replace(/^@/, "").replace("/", "__")}`);
    if (!declared && !typePackageDeclared) {
      const kind = workspaceNames.has(dependencyName) ? "workspace dependency" : "dependency";
      violations.push(`${filePath}: ${packageName} imports undeclared ${kind} ${dependencyName}`);
    }
  }
  return violations;
}

export async function findDependencyPolicyViolations(root = repositoryRoot) {
  const policy = JSON.parse(await readFile(path.join(root, "config/dependency-policy.json"), "utf8"));
  const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const rootDevelopmentDependencies = new Set(Object.keys(rootManifest.devDependencies ?? {}));
  const packages = await discoverPackages(root);
  const workspaceNames = new Set(packages.map((packageRecord) => packageRecord.name));
  const violations = [];

  for (const packageRecord of packages) {
    const files = await collectSourceFiles(packageRecord.root);
    const runtimeDependencies = dependencyNames(packageRecord.manifest, "dependencies");
    const developmentDependencies = dependencyNames(packageRecord.manifest, "devDependencies");
    const peerDependencies = dependencyNames(packageRecord.manifest, "peerDependencies");
    for (const filePath of files) {
      const contents = await readFile(filePath, "utf8");
      violations.push(
        ...dependencyViolationsForSource({
          packageName: packageRecord.name,
          filePath: path.relative(root, filePath),
          contents,
          runtimeDependencies,
          developmentDependencies,
          peerDependencies,
          workspaceNames,
          rootDevelopmentDependencies,
          forbiddenImports: policy.forbiddenImports,
        }),
      );
    }
  }

  return violations.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await findDependencyPolicyViolations();
  if (violations.length > 0) {
    console.error("Dependency policy: failed");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log("Dependency policy: passed");
  }
}
