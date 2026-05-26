import { describe, it, expect } from 'vitest';
import { parseStylesheet } from './css-parser.js';

describe('parseStylesheet', () => {
  it('parses basic CSS file with selectors → file entity + selector-rule entities + contain relationships', () => {
    const css = `
.user-card {
  color: red;
}
#main header {
  font-size: 16px;
}
`.trim();

    const result = parseStylesheet('test.css', css, 'src/styles/main.css');

    // File entity + 2 selector-rule entities
    expect(result.entities).toHaveLength(3);

    const fileEntity = result.entities.find((e) => e.kind === 'file');
    expect(fileEntity).toBeDefined();
    expect(fileEntity!.id).toBe('file:src/styles/main.css');
    expect(fileEntity!.hierarchyKind).toBe('root');
    expect(fileEntity!.entityDepth).toBe(0);

    const selectorRules = result.entities.filter((e) => e.kind === 'selector-rule');
    expect(selectorRules).toHaveLength(2);
    expect(selectorRules[0].name).toBe('.user-card');
    expect(selectorRules[1].name).toBe('#main header');

    // Each selector should have a contain relationship
    const containRels = result.relationships.filter((r) => r.kind === 'contain');
    expect(containRels).toHaveLength(2);
    expect(containRels[0].sourceEntityId).toBe(fileEntity!.id);
    expect(containRels[0].targetEntityId).toBe(selectorRules[0].id);
  });

  it('extracts custom properties → custom-property entities', () => {
    const css = `
:root {
  --color-primary: #007bff;
  --spacing-lg: 24px;
}
`.trim();

    const result = parseStylesheet('vars.css', css, 'src/vars.css');

    const customProps = result.entities.filter((e) => e.kind === 'custom-property');
    expect(customProps).toHaveLength(2);
    expect(customProps[0].id).toBe('css-var:src/vars.css:--color-primary');
    expect(customProps[0].name).toBe('--color-primary');
    expect(customProps[1].id).toBe('css-var:src/vars.css:--spacing-lg');
    expect(customProps[1].name).toBe('--spacing-lg');

    // Should have contain relationships
    const containRels = result.relationships.filter(
      (r) => r.kind === 'contain' && r.targetEntityId?.startsWith('css-var:'),
    );
    expect(containRels).toHaveLength(2);
  });

  it('extracts @keyframes → keyframes entity', () => {
    const css = `
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
`.trim();

    const result = parseStylesheet('anim.css', css, 'src/anim.css');

    const keyframes = result.entities.filter((e) => e.kind === 'keyframes');
    expect(keyframes).toHaveLength(1);
    expect(keyframes[0].id).toBe('css-keyframes:src/anim.css:fade-in');
    expect(keyframes[0].name).toBe('fade-in');
    expect(keyframes[0].entityDepth).toBe(1);
    expect(keyframes[0].parentEntityId).toBe('file:src/anim.css');

    // Contain relationship from file to keyframes
    const containRels = result.relationships.filter(
      (r) => r.kind === 'contain' && r.targetEntityId?.startsWith('css-keyframes:'),
    );
    expect(containRels).toHaveLength(1);
  });

  it('extracts @import → import relationship', () => {
    const css = `
@import "variables.css";
@import url("reset.css");
.body { margin: 0; }
`.trim();

    const result = parseStylesheet('main.css', css, 'src/main.css');

    const importRels = result.relationships.filter((r) => r.kind === 'import');
    expect(importRels).toHaveLength(2);

    expect(importRels[0].sourceEntityId).toBe('file:src/main.css');
    expect(importRels[0].targetEntityId).toBe('file:variables.css');
    expect(importRels[0].targetFilePath).toBe('variables.css');
    expect(importRels[0].crossModule).toBe(true);

    expect(importRels[1].targetEntityId).toBe('file:reset.css');
  });

  it('extracts url() → reference relationship to asset', () => {
    const css = `
.hero {
  background: url("../images/hero.png");
}
.icon {
  background-image: url(icons/arrow.svg);
}
`.trim();

    const result = parseStylesheet('styles.css', css, 'src/styles.css');

    const refRels = result.relationships.filter((r) => r.kind === 'reference');
    expect(refRels).toHaveLength(2);

    expect(refRels[0].targetEntityId).toBe('file:../images/hero.png');
    expect(refRels[0].targetFilePath).toBe('../images/hero.png');
    expect(refRels[0].resolutionKind).toBe('proxy');

    expect(refRels[1].targetEntityId).toBe('file:icons/arrow.svg');
  });

  it('extracts var() → use relationship to custom property', () => {
    const css = `
:root {
  --color-primary: #007bff;
}
.btn {
  color: var(--color-primary);
  margin: var(--spacing-md, 16px);
}
`.trim();

    const result = parseStylesheet('theme.css', css, 'src/theme.css');

    const useRels = result.relationships.filter((r) => r.kind === 'use');
    expect(useRels).toHaveLength(2);

    expect(useRels[0].targetEntityId).toBe('css-var:src/theme.css:--color-primary');
    expect(useRels[0].kind).toBe('use');

    expect(useRels[1].targetEntityId).toBe('css-var:src/theme.css:--spacing-md');
  });

  it('handles SCSS @mixin → mixin entity', () => {
    const scss = `
@mixin flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}
@mixin responsive($breakpoint) {
  @media (max-width: $breakpoint) { @content; }
}
`.trim();

    const result = parseStylesheet('mixins.scss', scss, 'src/mixins.scss');

    const mixins = result.entities.filter((e) => e.kind === 'mixin');
    expect(mixins).toHaveLength(2);
    expect(mixins[0].id).toBe('css-mixin:src/mixins.scss:flex-center');
    expect(mixins[0].name).toBe('flex-center');
    expect(mixins[1].id).toBe('css-mixin:src/mixins.scss:responsive');
    expect(mixins[1].name).toBe('responsive');

    // Contain relationships
    const containRels = result.relationships.filter(
      (r) => r.kind === 'contain' && r.targetEntityId?.startsWith('css-mixin:'),
    );
    expect(containRels).toHaveLength(2);
  });

  it('handles SCSS @import/@use → import relationships', () => {
    const scss = `
@import "variables";
@use "mixins";
.container { width: 100%; }
`.trim();

    const result = parseStylesheet('app.scss', scss, 'src/app.scss');

    const importRels = result.relationships.filter((r) => r.kind === 'import');
    expect(importRels).toHaveLength(2);

    expect(importRels[0].sourceEntityId).toBe('file:src/app.scss');
    expect(importRels[0].targetEntityId).toBe('file:variables');
    expect(importRels[0].resolutionKind).toBe('proxy');

    expect(importRels[1].targetEntityId).toBe('file:mixins');
  });

  it('entity IDs are deterministic', () => {
    const css = `
.card { padding: 8px; }
:root { --gap: 4px; }
@keyframes spin { to { transform: rotate(360deg); } }
`.trim();

    const result1 = parseStylesheet('f.css', css, 'src/f.css');
    const result2 = parseStylesheet('f.css', css, 'src/f.css');

    expect(result1.entities.map((e) => e.id)).toEqual(result2.entities.map((e) => e.id));
  });

  it('empty CSS file → produces only file entity', () => {
    const result = parseStylesheet('empty.css', '', 'src/empty.css');

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].kind).toBe('file');
    expect(result.entities[0].id).toBe('file:src/empty.css');
    expect(result.relationships).toHaveLength(0);
  });
});
