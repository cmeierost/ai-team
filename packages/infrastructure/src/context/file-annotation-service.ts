import { normalizePath } from 'fs-context';
import type { AnnotatedFile, IFileAnnotationService, PermissionConfig } from '@ai-team/core';
import { AgentRuntimeFactory } from './permission-services.js';

export class FileAnnotationServiceImpl implements IFileAnnotationService {
  getAnnotatedFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): AnnotatedFile[] {
    const runtimeFactory = new AgentRuntimeFactory(workspaceRoot);
    const runtime = runtimeFactory.create('__ctx', permissions, allFiles);
    return allFiles.map((filePath) => {
      const rel = normalizePath(filePath, workspaceRoot);
      return {
        path: filePath,
        readable: runtime.canRead('__ctx', rel),
        listable: runtime.canList('__ctx', rel),
        writable: runtime.canWrite('__ctx', rel),
      };
    });
  }

  getWritableFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): string[] {
    const runtimeFactory = new AgentRuntimeFactory(workspaceRoot);
    const runtime = runtimeFactory.create('__ctx', permissions, allFiles);
    return allFiles.filter((f) => runtime.canWrite('__ctx', normalizePath(f, workspaceRoot)));
  }

  getReadableFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): string[] {
    const runtimeFactory = new AgentRuntimeFactory(workspaceRoot);
    const runtime = runtimeFactory.create('__ctx', permissions, allFiles);
    return allFiles.filter((f) => runtime.canRead('__ctx', normalizePath(f, workspaceRoot)));
  }
}
