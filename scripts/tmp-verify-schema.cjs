const path = require('node:path');
const s = require(path.join(__dirname, '..', 'analysis', 'contracts', 'schemas', 'signals', 'reference-graph.schema.json'));
console.log('Title:', s.title);
console.log('Required:', s.required.join(', '));
console.log('Edge kinds:', s.$defs.referenceEdge.properties.kind.enum.join(', '));
console.log('Scopes:', s.$defs.referenceEdge.properties.scope.enum.join(', '));
console.log('Source tool const:', s.properties.source.properties.tool.const);