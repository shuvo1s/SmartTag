/**
 * @smarttag/expression-core
 *
 * The variable-data expression language (`concat("SIZE: ", size)`, `is_sustainable == true`) and
 * safe text patterns for validation rules. Expressions are parsed into plain syntax trees,
 * type-checked against a data schema and evaluated by a small interpreter over a closed set of
 * functions. There is no eval, no Function constructor and no access to globals, the host,
 * the network, the file system, time or randomness, so evaluation is deterministic and safe for
 * untrusted input in browsers, API requests and batch workers alike.
 *
 * This package has no dependencies and knows nothing about documents, canvases or frameworks.
 */
export * from './analyze';
export * from './ast';
export * from './decimal';
export * from './evaluate';
export { EXPRESSION_FUNCTIONS, findFunction, type FunctionInfo } from './functions';
export { tokenize, type Token, type TokenKind } from './lexer';
export * from './limits';
export * from './parser';
export * from './pattern';
export * from './rename';
export * from './types';
export * from './values';
