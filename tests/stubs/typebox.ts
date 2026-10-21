// Minimal stand-in for @sinclair/typebox: any schema builder call returns an
// empty schema object, which is all the tool-registration code needs in tests.
const schema = (): Record<string, unknown> => ({});

export const Type: any = new Proxy({}, { get: () => schema });
