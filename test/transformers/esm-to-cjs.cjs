/**
 * Jest transformer for the ESM-only packages this project depends on
 * (the @nestjs/* scope). Jest 30 can require() native ESM only on Node 24.9+,
 * and this environment is Node 22, so those packages are downleveled to
 * CommonJS for the test run. Application source keeps its own tsconfig.
 *
 * It also compiles the generated Prisma client (src/generated/prisma): under
 * `module: nodenext` its `await import(...)` of the query-compiler WASM stays
 * a dynamic import, which Jest's VM only supports with --experimental-vm-modules.
 * CommonJS emit turns those into require() calls.
 */
const crypto = require('crypto');
const ts = require('typescript');

const VERSION = '2';

function prepare(source) {
  // These packages alias `require` to createRequire(import.meta.url). CommonJS
  // already has `require`, and the downlevel emit declares it too, so keeping
  // the alias produces "Identifier 'require' has already been declared".
  const withoutRequireAlias = source.replace(
    /^[ \t]*const require = createRequire\(import\.meta\.url\);?[ \t]*\r?\n/gm,
    '',
  );
  return withoutRequireAlias.replace(
    /\bimport\.meta\.url\b/g,
    'require("node:url").pathToFileURL(__filename).href',
  );
}

module.exports = {
  process(sourceText, sourcePath) {
    const result = ts.transpileModule(prepare(sourceText), {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        sourceMap: true,
      },
    });

    return {
      code: result.outputText,
      map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
    };
  },

  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash('sha1')
      .update(VERSION)
      .update(sourcePath)
      .update(sourceText)
      .digest('hex');
  },
};
