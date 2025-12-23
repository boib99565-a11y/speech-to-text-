
import React from 'react';
import { Transcription } from '../types';

interface Props {
  item: Transcription;
}

const TranscriptionItem: React.FC<Props> = ({ item }) => {
  const isUser = item.role === 'user';
  
  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start animate-fade-in'}`}>
      <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-5 py-4 shadow-xl border ${
        isUser 
          ? 'bg-blue-600 border-blue-500 text-white rounded-tr-none' 
          : 'bg-slate-800 border-slate-700 text-slate-100 rounded-tl-none'
      }`}>
        <div className="flex items-center gap-2 mb-1 opacity-60 text-xs font-medium uppercase tracking-wider">
          <span>{isUser ? 'You' : 'Gemini'}</span>
          <span>•</span>
          <span>{item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
          {item.text || (item.isComplete ? '[Silence]' : '...')}
          {!item.isComplete && <span className="inline-block w-1.5 h-4 ml-1 bg-current animate-pulse align-middle" />}
        </p>
      </div>
    </div>
  );
};

export default TranscriptionItem;
