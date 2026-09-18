import type { FontEmbeddingPermission, FontFaceDto } from '@smarttag/shared-types';

export interface FontFamilyGroup {
  readonly familyName: string;
  readonly faces: readonly FontFaceDto[];
  readonly restrictedCount: number;
  readonly formats: readonly string[];
}

export function filterFontFaces(
  faces: readonly FontFaceDto[],
  search: string,
  embeddingPermission: FontEmbeddingPermission | 'ALL',
): FontFaceDto[] {
  const needle = search.trim().toLowerCase();
  return faces.filter((face) => {
    if (embeddingPermission !== 'ALL' && face.embeddingPermission !== embeddingPermission) {
      return false;
    }
    if (!needle) return true;
    return [
      face.familyName,
      face.subfamilyName,
      face.fullName,
      face.postscriptName,
      face.filename,
      face.format,
    ].some((value) => value.toLowerCase().includes(needle));
  });
}

export function groupFontFaces(faces: readonly FontFaceDto[]): FontFamilyGroup[] {
  const groups = new Map<string, FontFaceDto[]>();
  for (const face of faces) {
    const current = groups.get(face.familyName) ?? [];
    current.push(face);
    groups.set(face.familyName, current);
  }
  return [...groups.entries()]
    .map(([familyName, familyFaces]) => {
      familyFaces.sort(
        (a, b) =>
          a.weight - b.weight ||
          a.style.localeCompare(b.style) ||
          a.subfamilyName.localeCompare(b.subfamilyName),
      );
      return {
        familyName,
        faces: familyFaces,
        restrictedCount: familyFaces.filter(
          (face) => face.embeddingPermission === 'RESTRICTED',
        ).length,
        formats: [...new Set(familyFaces.map((face) => face.format))].sort(),
      };
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function faceLabel(face: FontFaceDto): string {
  return `${face.subfamilyName} · ${face.weight}${face.style === 'ITALIC' ? ' italic' : ''}`;
}
