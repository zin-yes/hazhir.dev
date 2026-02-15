export type MeditationSessionId = string;

export type MeditationSessionRecord = {
  id: MeditationSessionId;
  userId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  preset: string | null;
  inhaleSeconds: number | null;
  holdSeconds: number | null;
  exhaleSeconds: number | null;
  switchSeconds: number | null;
  targetMinutes: number | null;
  roundCount: number | null;
};

export type MeditationListResult = {
  sessions: MeditationSessionRecord[];
};

export type SaveMeditationSessionParams = {
  userId: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  preset?: string | null;
  inhaleSeconds?: number | null;
  holdSeconds?: number | null;
  exhaleSeconds?: number | null;
  switchSeconds?: number | null;
  targetMinutes?: number | null;
  roundCount?: number | null;
};
