const ts = require("typescript");

/**
 * ts-jest transformer that rewrites `import.meta.url` to a helper that derives
 * the current module URL using CommonJS primitives. This prevents Jest's CJS
 * runtime from choking on `import.meta`.
 */
function importMetaToFileUrlTransformer() {
  return (context) => {
    const { factory } = context;

    return (sourceFile) => {
      let replaced = false;

      const visitor = (node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isMetaProperty(node.expression) &&
          node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
          node.name.text === "url"
        ) {
          replaced = true;
          return factory.createCallExpression(
            factory.createIdentifier("__jestImportMetaUrl"),
            undefined,
            [],
          );
        }

        return ts.visitEachChild(node, visitor, context);
      };

      const visitedSourceFile = ts.visitEachChild(sourceFile, visitor, context);

      if (!replaced) {
        return visitedSourceFile;
      }

      const helperFunction = factory.createFunctionDeclaration(
        undefined,
        undefined,
        "__jestImportMetaUrl",
        undefined,
        [],
        undefined,
        factory.createBlock(
          [
            factory.createVariableStatement(
              undefined,
              factory.createVariableDeclarationList(
                [
                  factory.createVariableDeclaration(
                    factory.createObjectBindingPattern([
                      factory.createBindingElement(
                        undefined,
                        undefined,
                        factory.createIdentifier("pathToFileURL"),
                        undefined,
                      ),
                    ]),
                    undefined,
                    undefined,
                    factory.createCallExpression(
                      factory.createIdentifier("require"),
                      undefined,
                      [factory.createStringLiteral("node:url")],
                    ),
                  ),
                ],
                ts.NodeFlags.Const,
              ),
            ),
            factory.createReturnStatement(
              factory.createPropertyAccessExpression(
                factory.createCallExpression(
                  factory.createIdentifier("pathToFileURL"),
                  undefined,
                  [factory.createIdentifier("__filename")],
                ),
                factory.createIdentifier("href"),
              ),
            ),
          ],
          true,
        ),
      );

      return factory.updateSourceFile(visitedSourceFile, [
        helperFunction,
        ...visitedSourceFile.statements,
      ]);
    };
  };
}

module.exports = {
  factory: importMetaToFileUrlTransformer,
  name: "import-meta-to-fileurl",
  version: 1,
};
