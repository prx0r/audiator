export type ScoreDimension = 'technical' | 'communication' | 'callControl' | 'professionalism';

export interface CustomerDecision {
  primaryIntent: string;
  customerResponseText: string;
  evidenceTags: string[];
  scoreSignals: Partial<Record<ScoreDimension, number>>;
  issueResolved: boolean;
}

export interface RouteEvent {
  turnId: string;
  candidateText: string;
  customerResponseText: string;
  evidenceTags: string[];
  scoreSignals: Partial<Record<ScoreDimension, number>>;
  createdAt: string;
}
