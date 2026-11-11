/** When an account's library was last reconciled with the provider's list. */
export interface SummaryReconciliationRepository {
  lastCompletedAt(athleteId: number): Promise<Date | null>;
}
