
import React from 'react';

interface Props {
  isActive: boolean;
}

const AudioVisualizer: React.FC<Props> = ({ isActive }) => {
  return (
    <div className="flex items-center gap-1.5 h-8">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-full bg-blue-400 transition-all duration-300 ${
            isActive ? 'animate-pulse' : 'h-1 opacity-20'
          }`}
          style={{
            height: isActive ? `${Math.random() * 100 + 20}%` : '4px',
            animationDelay: `${i * 0.1}s`,
            animationDuration: '0.6s'
          }}
        />
      ))}
    </div>
  );
};

export default AudioVisualizer;
