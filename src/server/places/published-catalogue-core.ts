import {
  type ValidatedCatalogue,
  canonicalJson,
  catalogueManifestSchema,
  catalogueSnapshotId,
  sha256,
} from './catalogue-artifact';
import { parseCoverageGeometry } from './coverage';

export type PublishedCatalogue = Pick<
  ValidatedCatalogue,
  'manifest' | 'coverage'
>;

export function validatePublishedCatalogue(
  input: PublishedCatalogue,
): PublishedCatalogue {
  const manifest = catalogueManifestSchema.parse(input.manifest);
  const coverage = parseCoverageGeometry(input.coverage);
  if (
    manifest.catalogue_snapshot_id !== catalogueSnapshotId(manifest) ||
    manifest.coverage.sha256 !== sha256(`${canonicalJson(coverage)}\n`)
  )
    throw new Error('Published catalogue metadata failed integrity validation');
  return { manifest, coverage };
}
