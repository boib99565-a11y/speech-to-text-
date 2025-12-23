
export interface Transcription {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isComplete: boolean;
}

export interface LiveSessionState {
  isActive: boolean;
  isConnecting: boolean;
  error: string | null;
}

export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr'
}
