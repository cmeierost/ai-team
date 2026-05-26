import { describe, expect, it } from 'vitest';

import {
  workflowDefinitionJsonToYaml,
  workflowDefinitionYamlToJson,
  type WorkflowDefinitionObject,
} from './definition-format.js';

describe('workflow definition format', () => {
  it('serializes JSON definition to YAML', () => {
    const definition: WorkflowDefinitionObject = {
      format: 'workflow/v1',
      id: 'example-flow',
      initial: 'start',
      states: {
        start: {
          transitions: [{ event: 'always', target: 'done' }],
        },
        done: {
          type: 'final',
          transitions: [],
        },
      },
    };

    const yaml = workflowDefinitionJsonToYaml(definition);

    expect(yaml).toContain('format: workflow/v1');
    expect(yaml).toContain('id: example-flow');
    expect(yaml).toContain('initial: start');
    expect(yaml).toContain('states:');
    expect(yaml).toContain('- event: always');
  });

  it('parses YAML definition to JSON object', () => {
    const yaml = `format: workflow/v1
id: config-flow
initial: ask
states:
  ask:
    transitions:
      - event: always
        target: done
  done:
    type: final
    transitions: []
`;

    const parsed = workflowDefinitionYamlToJson(yaml);

    expect(parsed).toMatchObject({
      format: 'workflow/v1',
      id: 'config-flow',
      initial: 'ask',
    });
  });
});
