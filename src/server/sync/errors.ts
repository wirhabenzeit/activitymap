/** A repository/bridge cannot serve this cursor from its retained history. */
export class SyncRebootstrapRequiredError extends Error {
  constructor() {
    super('The requested cursor is older than the retained change history.');
    this.name = 'SyncRebootstrapRequiredError';
  }
}
