type DesiredSource = { version: number; deleted: boolean };

export function supersedes(
  incoming: DesiredSource,
  prior: DesiredSource | null,
) {
  return (
    !prior ||
    incoming.version > prior.version ||
    (incoming.version === prior.version && incoming.deleted && !prior.deleted)
  );
}
