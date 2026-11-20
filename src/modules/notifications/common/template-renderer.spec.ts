import {
  extractPlaceholders,
  renderText,
  validateDefinitions,
  validateVariables,
  type VariableDefinition,
} from './template-renderer';

const defs: VariableDefinition[] = [
  { name: 'fullName', type: 'string', required: true },
  { name: 'count', type: 'number', required: false },
  { name: 'dueDate', type: 'date', required: false },
];

describe('template renderer', () => {
  it('extracts unique placeholders in order', () => {
    expect(extractPlaceholders('Hi {{fullName}}, {{ count }} and {{fullName}}')).toEqual([
      'fullName',
      'count',
    ]);
  });

  describe('validateDefinitions', () => {
    it('accepts text whose placeholders are all defined', () => {
      expect(validateDefinitions(defs, ['Hi {{fullName}}', 'Due {{dueDate}}'])).toEqual([]);
    });

    it('reports undefined, malformed and unmatched placeholders and duplicates', () => {
      const problems = validateDefinitions(
        [...defs, { name: 'fullName', type: 'string', required: false }],
        ['{{missing}} {{bad name}} {{ }}', 'broken {{fullName'],
      );
      expect(problems).toEqual(
        expect.arrayContaining([
          'Variable "fullName" is defined twice',
          'Placeholder "{{missing}}" has no variable definition',
          'Placeholder "{{bad name}}" is not valid',
          'Text contains an unmatched "{{" or "}}"',
        ]),
      );
    });

    it('rejects invalid variable names', () => {
      expect(validateDefinitions([{ name: '1bad', type: 'string', required: true }], [])).toEqual([
        'Variable name "1bad" is not valid',
      ]);
    });
  });

  describe('validateVariables', () => {
    it('requires required variables and checks types', () => {
      expect(validateVariables(defs, {}, { allowExtra: false })).toEqual([
        'Variable "fullName" is required',
      ]);
      expect(
        validateVariables(
          defs,
          { fullName: 5, count: 'x', dueDate: 'nope' },
          { allowExtra: false },
        ),
      ).toEqual([
        'Variable "fullName" must be text',
        'Variable "count" must be a number',
        'Variable "dueDate" must be a date',
      ]);
    });

    it('rejects unknown variables unless extras are allowed', () => {
      const values = { fullName: 'A', other: 'x' };
      expect(validateVariables(defs, values, { allowExtra: false })).toEqual([
        'Unknown variable "other"',
      ]);
      expect(validateVariables(defs, values, { allowExtra: true })).toEqual([]);
    });

    it('enforces maximum string length', () => {
      const short: VariableDefinition[] = [
        { name: 'n', type: 'string', required: true, maxLength: 3 },
      ];
      expect(validateVariables(short, { n: 'abcd' }, { allowExtra: false })).toEqual([
        'Variable "n" is too long',
      ]);
    });
  });

  describe('renderText', () => {
    it('substitutes values and formats numbers and dates', () => {
      const text = renderText('{{fullName}}: {{count}} due {{dueDate}}', defs, {
        fullName: 'Aline',
        count: 3,
        dueDate: new Date('2026-12-01T10:00:00Z'),
      });
      expect(text).toBe('Aline: 3 due 2026-12-01');
    });

    it('renders absent optional variables as empty text', () => {
      expect(renderText('A{{count}}B', defs, {})).toBe('AB');
    });

    it('never interprets placeholders or control characters inside values', () => {
      const text = renderText('Hi {{fullName}}!', defs, { fullName: 'x {{count}}\nHACK\u0000' });
      expect(text).toBe('Hi x {{count}} HACK!');
    });
  });
});
