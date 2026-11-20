/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '[\\\\/]src[\\\\/]generated[\\\\/]prisma[\\\\/].+\\.ts$': '<rootDir>/../test/transformers/esm-to-cjs.cjs',
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.jest.json' }],
    '^.+\\.js$': '<rootDir>/../test/transformers/esm-to-cjs.cjs',
  },
  // @nestjs/* is published as ESM, and Prisma's runtime uses dynamic import();
  // everything else in node_modules stays as-is.
  transformIgnorePatterns: ['/node_modules/(?!@nestjs/|@prisma/client/runtime/client\\.js$)'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  collectCoverageFrom: ['**/*.ts', '!generated/**', '!main.ts', '!**/*.module.ts', '!**/index.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
