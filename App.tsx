
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { Transcription, LiveSessionState, VoiceName } from './types';
import { decodeBase64, encodeBase64, decodeAudioData, createPcmBlob } from './utils/audio';
import TranscriptionItem from './components/TranscriptionItem';
import AudioVisualizer from './components/AudioVisualizer';

const App: React.FC = () => {
  const [session, setSession] = useState<LiveSessionState>({
    isActive: false,
    isConnecting: false,
    error: null,
  });
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.Zephyr);
  
  // Refs for audio processing
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const currentSessionRef = useRef<any>(null);

  // Transcription accumulation refs
  const currentInputTextRef = useRef<string>('');
  const currentOutputTextRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions]);

  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach((source) => {
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const handleDisconnect = useCallback(() => {
    stopAllAudio();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (currentSessionRef.current) {
      try {
        currentSessionRef.current.close();
      } catch (e) {}
      currentSessionRef.current = null;
    }
    sessionPromiseRef.current = null;
    setSession({ isActive: false, isConnecting: false, error: null });
  }, [stopAllAudio]);

  const startSession = async () => {
    try {
      setSession({ isActive: false, isConnecting: true, error: null });
      
      // Check for mediaDevices support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support audio recording or is blocking it.");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      // Initialize Audio Contexts
      if (!audioContextInRef.current) {
        audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!audioContextOutRef.current) {
        audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (mediaError: any) {
        if (mediaError.name === 'NotFoundError' || mediaError.name === 'DevicesNotFoundError') {
          throw new Error("No microphone found. Please connect a microphone and try again.");
        } else if (mediaError.name === 'NotAllowedError' || mediaError.name === 'PermissionDeniedError') {
          throw new Error("Microphone access was denied. Please check your browser permissions.");
        } else {
          throw new Error(`Microphone access error: ${mediaError.message || "Unknown device error"}`);
        }
      }
      
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `Task: Accurately convert the following spoken audio into clear, well-structured written text.

Transcription Requirements:
- Transcribe word-for-word, including meaningful pauses, emphasis, and speaker intent.
- Remove filler words such as “um,” “uh,” and “you know” only if they do not affect meaning.
- Correct obvious grammatical mistakes while preserving the original meaning and tone.
- Maintain the speaker’s original phrasing where possible.
- Use proper punctuation, capitalization, and paragraph breaks for readability.

Speaker & Context Handling:
- Identify different speakers if more than one person is speaking (e.g., Speaker 1, Speaker 2).
- Preserve emotional tone (e.g., excitement, seriousness) when it affects meaning.
- If a word or phrase is unclear, mark it as [inaudible] or [uncertain].

Formatting Rules:
- Use paragraphs for natural breaks in speech.
- Do not summarize or interpret—only transcribe.
- Clear, professional, and easy to read. No added commentary.`,
        },
        callbacks: {
          onopen: () => {
            setSession({ isActive: true, isConnecting: false, error: null });

            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              
              sessionPromise.then((sess) => {
                sess.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (message: any) => {
            if (message.serverContent?.inputTranscription) {
              currentInputTextRef.current += message.serverContent.inputTranscription.text;
              updateTranscription('user', currentInputTextRef.current, false);
            }
            
            if (message.serverContent?.outputTranscription) {
              currentOutputTextRef.current += message.serverContent.outputTranscription.text;
              updateTranscription('model', currentOutputTextRef.current, false);
            }

            if (message.serverContent?.turnComplete) {
              updateTranscription('user', currentInputTextRef.current, true);
              updateTranscription('model', currentOutputTextRef.current, true);
              currentInputTextRef.current = '';
              currentOutputTextRef.current = '';
            }

            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              const outCtx = audioContextOutRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              
              const buffer = await decodeAudioData(decodeBase64(audioData), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outCtx.destination);
              
              source.onended = () => activeSourcesRef.current.delete(source);
              activeSourcesRef.current.add(source);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
            }

            if (message.serverContent?.interrupted) {
              stopAllAudio();
            }
          },
          onerror: (err) => {
            console.error('Session Error:', err);
            setSession(prev => ({ ...prev, error: 'A connection error occurred. Please check your internet and try again.' }));
            handleDisconnect();
          },
          onclose: () => {
            handleDisconnect();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;
      currentSessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error('Failed to start session:', err);
      setSession({ isActive: false, isConnecting: false, error: err.message || 'An unexpected error occurred.' });
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  };

  const updateTranscription = (role: 'user' | 'model', text: string, isComplete: boolean) => {
    setTranscriptions(prev => {
      const lastIdx = prev.length - 1;
      const lastItem = prev[lastIdx];
      
      if (lastItem && lastItem.role === role && !lastItem.isComplete) {
        const updated = [...prev];
        updated[lastIdx] = { ...lastItem, text, isComplete };
        return updated;
      } else {
        return [...prev, {
          id: Math.random().toString(36).substring(7),
          role,
          text,
          timestamp: new Date(),
          isComplete
        }];
      }
    });
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200">
      <header className="flex items-center justify-between px-8 py-4 bg-slate-900/50 border-b border-slate-800 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Gemini Transcribe</h1>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${session.isActive ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></span>
              <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">
                {session.isActive ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex flex-col items-end">
            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Voice Profile</label>
            <select 
              value={selectedVoice} 
              onChange={(e) => setSelectedVoice(e.target.value as VoiceName)}
              disabled={session.isActive}
              className="bg-slate-800 border-none text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 transition-all outline-none disabled:opacity-50 cursor-pointer"
            >
              {Object.values(VoiceName).map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <button
            onClick={session.isActive ? handleDisconnect : startSession}
            disabled={session.isConnecting}
            className={`px-6 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg hover:scale-[1.02] active:scale-95 disabled:opacity-50 ${
              session.isActive 
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/20' 
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20'
            }`}
          >
            {session.isConnecting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Connecting...
              </>
            ) : session.isActive ? (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                Stop Session
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
                Start Gemini
              </>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <aside className="w-full md:w-80 bg-slate-900/30 border-r border-slate-800 p-6 flex flex-col gap-8">
          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Input Status</h3>
            <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-300">Microphone</span>
                <AudioVisualizer isActive={session.isActive} />
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {session.isActive 
                  ? 'Capturing real-time audio and streaming to Gemini Flash 2.5.' 
                  : 'Start a session to enable high-quality transcription.'}
              </p>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Session Statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                <div className="text-xl font-bold text-white">{transcriptions.filter(t => t.role === 'user').length}</div>
                <div className="text-[10px] text-slate-500 font-bold uppercase">Sentences</div>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                <div className="text-xl font-bold text-white">{transcriptions.filter(t => t.role === 'model').length}</div>
                <div className="text-[10px] text-slate-500 font-bold uppercase">Responses</div>
              </div>
            </div>
          </section>

          {session.error && (
            <div className="mt-auto bg-rose-900/20 border border-rose-500/30 rounded-xl p-4 flex gap-3 animate-pulse">
              <svg className="w-5 h-5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-rose-400 uppercase tracking-tighter mb-1">Hardware Error</span>
                <span className="text-xs text-rose-200">{session.error}</span>
              </div>
            </div>
          )}
        </aside>

        <section className="flex-1 flex flex-col relative">
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 py-8 md:px-12 scroll-smooth"
          >
            {transcriptions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-40 max-w-md mx-auto">
                <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center mb-6">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold mb-2">Voice Transcription</h2>
                <p className="text-sm">Talk naturally. Gemini will follow strict professional transcription standards.</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {transcriptions.map((t) => (
                  <TranscriptionItem key={t.id} item={t} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="px-6 py-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-widest z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600">Model:</span>
            <span className="text-blue-500">Gemini 2.5 Flash Native Audio</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600">Status:</span>
            <span>{session.isActive ? 'Receiving Audio' : 'Ready'}</span>
          </div>
        </div>
        <div className="hidden sm:block">
          Optimized Professional Transcription Mode
        </div>
      </footer>
    </div>
  );
};

export default App;
