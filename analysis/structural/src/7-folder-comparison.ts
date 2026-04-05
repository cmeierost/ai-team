/**
 * @aspect/engine — Step 7: Folder comparison
 *
 * For each directory that contains code files, computes how focused
 * it is. A folder is "focused" when its files belong to the same
 * cluster and serve the same role.
 *
 * Scattered folders suggest the directory structure doesn't match
 * the actual code relationships.
 */

import type {
  StructuralFileInfo, FileCluster,
  FolderFocus, FolderAssessment,
} from './types.js';
import { round3, parentDir, buildFileClusterIndex } from './types.js';

/**
 * Analyse folder focus for all directories containing code files.
 */
export function analyseFolderFocus(
  files: StructuralFileInfo[],
  clusters: FileCluster[],
): FolderFocus[] {
  const fileToCluster = buildFileClusterIndex(clusters);

  const folderFiles = new Map<string, StructuralFileInfo[]>();
  for (const f of files) {
    if (f.category !== 'code') continue;
    const folder = parentDir(f.filePath);
    let list = folderFiles.get(folder);
    if (!list) { list = []; folderFiles.set(folder, list); }
    list.push(f);
  }

  const results: FolderFocus[] = [];
  for (const [folderPath, dirFiles] of folderFiles) {
    if (dirFiles.length <= 1) {
      results.push({
        folderPath, fileCount: dirFiles.length,
        clusterCount: 0, roleCount: 0,
        roleMix: {}, clusterMix: {},
        unclusteredCount: dirFiles.length,
        focusScore: 1.0, assessment: 'trivial',
      });
      continue;
    }

    const clusterMix: Record<string, number> = {};
    const roleMix: Record<string, number> = {};
    let unclustered = 0;

    for (const f of dirFiles) {
      const cIds = fileToCluster.get(f.fileId);
      if (cIds && cIds.length > 0) {
        for (const cId of cIds) {
          clusterMix[cId] = (clusterMix[cId] ?? 0) + 1;
        }
      } else {
        unclustered++;
      }
      const role = f.contentRole ?? 'unknown';
      roleMix[role] = (roleMix[role] ?? 0) + 1;
    }

    const clusterCount = Object.keys(clusterMix).length;
    const roleCount = Object.keys(roleMix).length;
    const fileCount = dirFiles.length;

    const clusterFocus = clusterCount <= 1 ? 1.0 : 1.0 / clusterCount;
    const roleFocus = roleCount <= 1 ? 1.0 : 1.0 / roleCount;
    const focusScore = round3(clusterFocus * 0.7 + roleFocus * 0.3);

    const assessment = assessFolder(clusterCount, roleCount, unclustered, fileCount);

    results.push({
      folderPath, fileCount, clusterCount, roleCount,
      roleMix, clusterMix, unclusteredCount: unclustered,
      focusScore, assessment,
    });
  }

  results.sort((a, b) => a.focusScore - b.focusScore);
  return results;
}

export function assessFolder(
  clusterCount: number,
  roleCount: number,
  unclustered: number,
  total: number,
): FolderAssessment {
  if (total <= 1) return 'trivial';
  if (unclustered === total) return 'unclustered';

  const multiCluster = clusterCount > 1;
  const multiRole = roleCount > 2;

  if (multiCluster && multiRole) return 'mixed';
  if (multiCluster) return 'cluster-scattered';
  if (multiRole) return 'role-mixed';
  return 'focused';
}
